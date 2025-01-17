// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IEncumbrancePolicy} from "../IEncumbrancePolicy.sol";
import {IEncumberedWallet} from "../IEncumberedWallet.sol";
import {TransactionSerializer} from "../../parsing/TransactionSerializer.sol";
import {Type2TxMessage, Type2TxMessageSigned} from "../../parsing/EthereumTransaction.sol";
import {StorageProof, ProvethVerifier, TransactionProof} from "../../proveth/ProvethVerifier.sol";
import {IBlockHashOracle} from "../IBlockHashOracle.sol";
import "solidity-rlp/contracts/RLPReader.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title Example Encumbrance Policy
 * @notice Policy that handles logic for controlling subpolicies that require Ethereum transaction signatures.
 */
contract EthTransactionPolicy is IEncumbrancePolicy, EIP712 {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    bytes32 public constant DEPOSIT_COMMITMENT_PROOF_TYPEHASH =
        keccak256("DepositCommitmentProof(address account,bytes32 txHash)");

    struct DestinationAsset {
        uint256 chainId;
        address to;
    }

    struct Wallets {
        address account;
        uint256 chainId;
        uint256 walletBalance;
    }

    struct Commitment {
        uint256 blockNumber;
        address subPolicy;
    }

    struct PendingBalance {
        uint256 amount;
        uint256 blockNumber;
    }

    struct DepositCommitment {
        address account;
        uint256 timestamp;
    }

    struct DepositCommitmentProof {
        address account;
        bytes32 txHash;
    }

    /// @notice The owner of the policy
    address walletOwner;
    /// @notice The encumbered wallet contract that this policy trusts
    IEncumberedWallet walletContract;
    /// @notice Trusted oracle for block hashes from Ethereum
    IBlockHashOracle public ethBlockHashOracle;
    /// @notice Library for verifying transaction inclusion and state proofs
    ProvethVerifier public stateVerifier;
    /// @notice policy address => encumbered address => chain ID => balance
    /// ETH balances allocated to each sub-policy on each chain
    mapping(address => mapping(address => mapping(uint256 => uint256))) private subPolicyEthBalance;
    /// @notice Mapping from encumbered address and asset to the sub-policy contract
    mapping(address => mapping(bytes32 => IEncumbrancePolicy)) private encumbranceSubContract;
    /// @notice Mapping from encumbered address and asset to the expiry time
    mapping(address => mapping(bytes32 => uint256)) private encumbranceExpiry;
    /// @notice Account nonce mapping: encumbered address => chain ID => transaction count
    mapping(address => mapping(uint256 => uint256)) transactionCounts;
    /// @notice Tracks deposit transaction commitments
    mapping(bytes32 => DepositCommitment) private depositTransactions;
    /// @notice Tracks deposit transactions that have been included
    mapping(bytes32 => bool) public depositTransactionsSeen;
    /// @notice Expiration time for this contract on a particular encumbered account
    mapping(address => uint256) private ourExpiration;
    /// @notice Manager for a particular encumbered account
    mapping(address => address) private manager;
    /// @notice Mapping of committed transactions. Transaction commitments are required
    /// after a sub-policy enrolls until the nonce increases to prevent a previous sub-policy
    /// from spending the new sub-policy's funds.
    mapping(address => mapping(bytes32 => Commitment)) private committedTransactions;
    /// @notice Stores all signed transactions by account and sub-policy
    mapping(address => mapping(address => bytes32[])) private signedIncludedTransactions;
    /// @notice Tracks whether a sub-policy requires deposit control
    mapping(address => bool) private depositControl;
    /// @notice Tracks the balance of the sub-policy on the TEE blockchain
    mapping(address => mapping(address => mapping(uint256 => uint256))) private subPolicyLocalBalanceFinalized;
    /// @notice Tracks the pending balance of the sub-policy on the TEE blockchain
    mapping(address => mapping(address => mapping(uint256 => PendingBalance))) private subPolicyLocalBalancePending;
    /// @notice Tracks the last sub-policy that interacted with a transaction: account => chainId => subpolicy
    mapping(address => mapping(uint256 => mapping(address => address))) private lastUnlimitedSigner;

    /**
     * @notice Construct a new EthTransactionPolicy
     * @param encumberedWallet The encumbered wallet contract that acts as the super-policy
     * @param _ethBlockHashOracle Trusted oracle for block hashes
     * @param _stateVerifier Library for verifying transaction inclusion and state proofs
     */
    constructor(
        IEncumberedWallet encumberedWallet,
        IBlockHashOracle _ethBlockHashOracle,
        ProvethVerifier _stateVerifier
    ) EIP712("EthTransactionPolicy", "1") {
        walletContract = encumberedWallet;
        ethBlockHashOracle = _ethBlockHashOracle;
        stateVerifier = _stateVerifier;
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    /**
     * @notice Get the asset ID of a transaction
     * @param transaction The transaction to examine
     * @return asset The asset ID
     */
    function findAssetFromTx(Type2TxMessage memory transaction) public pure returns (bytes32 asset) {
        return
            getEncodedAsset(
                DestinationAsset({chainId: transaction.chainId, to: address(bytes20(transaction.destination))})
            );
    }

    /**
     * @notice Estimate the gas cost of submitting an inclusion proof
     * @param length The length of the transaction, in bytes
     * @return cost The estimated gas cost of the transaction
     */
    function estimateInclusionProofCost(uint256 length) public pure returns (uint256) {
        return ((length / 1024) * 86853 + 289032) * 100 * 1e9;
    }

    /**
     * @notice Encodes the given asset into a bytes32
     * @param asset The asset to encode
     * @return encodedAsset The encoded asset as a bytes32
     */
    function getEncodedAsset(DestinationAsset memory asset) public pure returns (bytes32 encodedAsset) {
        return keccak256(abi.encode(asset.chainId, asset.to));
    }

    /**
     * @notice Get the maximum cost of a transaction
     * @param transaction The transaction to get the cost of
     * @return cost The cost of the transaction
     */
    function getMaxTransactionCost(Type2TxMessage memory transaction) public pure returns (uint256 cost) {
        cost = transaction.amount + transaction.gasLimit * transaction.maxFeePerGas;
    }

    /**
     * @notice Commits to a deposit to claim the funds submitted by it
     * @param signedTxHash The hash of the signed transaction that deposits funds into the account
     */
    function commitToDeposit(bytes32 signedTxHash) public {
        // TODO: The following check may be hidden via ORAM
        require(depositTransactions[signedTxHash].account == address(0), "Transaction already committed");
        depositTransactions[signedTxHash] = DepositCommitment({account: msg.sender, timestamp: block.timestamp});
    }

    /**
     * @notice Verifies that a deposit has been committed
     * @param commitmentProof The proof of the deposit commitment
     * @param signature The signature of the deposit commitment
     * @return isValid Whether the deposit commitment is valid
     */
    function isDepositCommitted(
        DepositCommitmentProof memory commitmentProof,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(DEPOSIT_COMMITMENT_PROOF_TYPEHASH, commitmentProof.account, commitmentProof.txHash))
        );
        require(ECDSA.recover(digest, signature) == walletOwner, "Invalid signature");
        return depositTransactions[commitmentProof.txHash].account == commitmentProof.account;
    }

    /**
     * @notice Get the balance of an account that is controlled by a given sub-policy
     * @dev This function is only callable by an enrolled sub-policy
     * @param account The account to get the balance for
     * @param chainId The chain ID to get the balance for
     * @return balance The balance owned by the sub-policy
     */
    function getEthBalance(address account, uint256 chainId) public view returns (uint256) {
        // Prevent leaking which accounts are not encumbered (thwarting deniability) using the zero address's balance
        require(msg.sender != address(0), "Authentication required");
        return subPolicyEthBalance[msg.sender][account][chainId];
    }

    /**
     * @notice Get the balance owned by a sub-policy on the TEE blockchain
     * @param account The account to get the local balance for
     * @param chainId The chain ID to get the local balance for
     * @return balance The local balance owned by the sub-policy on the TEE blockchain
     */
    function getSubpolicyLocalBalance(address account, uint256 chainId) public view returns (uint256) {
        return subPolicyLocalBalanceFinalized[msg.sender][account][chainId];
    }

    /**
     * @notice Get all the signed transactions included in the chain for a specific sub-policy
     * @dev We expect msg.sender to be a sub-policy
     * @param account The account to get the signed transactions for
     */
    function getSignedIncludedTransactions(address account) public view returns (bytes32[] memory) {
        return signedIncludedTransactions[account][msg.sender];
    }

    /**
     * @dev NOTE: This function will leak the transaction in question via depositTransactionsSeen storage access.
     * This may be mitigated by requiring authentication to *some* enrolled sub-policy when accessing
     * confidential storage slots (e.g., in commitToDeposit), at the cost of deniability. Alternatively,
     * with no such mitigation, non-encumbered transactions may have their transactions committed and "deposited"
     * to no real effect as a distraction, adding deniability.
     * @notice Deposits funds that have been committed into the account
     * @param signedTx The signed transaction that has been used to deposit funds into the account
     * @param inclusionProof The inclusion proof of the transaction
     */
    function depositFunds(Type2TxMessageSigned calldata signedTx, TransactionProof memory inclusionProof) public {
        // Verify that the transaction has been included in the chain
        Type2TxMessageSigned memory signedTxCopy = signedTx;
        signedTxCopy.v -= 27;
        bytes memory includedTx = stateVerifier.validateTxProof(inclusionProof);
        bytes32 signedTxHash = keccak256(TransactionSerializer.serializeSignedTransaction(signedTxCopy));

        // Authenticate
        bool isZero = msg.sender == address(0);
        bool isDepositorAccount = msg.sender == depositTransactions[signedTxHash].account;
        require(!isZero && isDepositorAccount, "Unauthenticated or not depositor");

        require(depositTransactionsSeen[signedTxHash] == false, "Transaction already seen");
        require(keccak256(includedTx) == signedTxHash, "Inclusion proof of an incorrect or absent transaction");

        // If the account requires deposit control, make sure that the depositFunds call is made by the sub-policy
        if (depositControl[msg.sender]) {
            uint256 BLOCK_TIMESTAMP_INDEX = 9;
            RLPReader.RLPItem[] memory blockHeader = inclusionProof.rlpBlockHeader.toRlpItem().toList();
            uint256 blockTimestamp = blockHeader[BLOCK_TIMESTAMP_INDEX].toUint();
            require(
                blockTimestamp >= depositTransactions[signedTxHash].timestamp,
                "Commitment was after the deposit was submitted."
            );
        }

        // Calculate signer address
        bytes memory unsignedTxData = TransactionSerializer.serializeTransaction(signedTx.transaction);
        bytes32 unsignedTxHash = keccak256(unsignedTxData);
        bytes memory signature = bytes.concat(bytes32(signedTx.r), bytes32(signedTx.s), bytes1(uint8(signedTx.v)));
        (, ECDSA.RecoverError error, ) = ECDSA.tryRecover(unsignedTxHash, signature);
        require(error == ECDSA.RecoverError.NoError, "Invalid signature");

        // Update account balances
        uint256 chainId = signedTx.transaction.chainId;
        address destination = address(bytes20(signedTx.transaction.destination));
        uint256 amount = signedTx.transaction.amount;
        subPolicyEthBalance[depositTransactions[signedTxHash].account][destination][chainId] += amount;
        depositTransactionsSeen[signedTxHash] = true;
    }

    /**
     * @notice Finalizes the local funds of a sub-policy and empties the pending balance
     * @param account The account to finalize the funds for
     * @param chainId The chain ID to finalize the funds for
     */
    function finalizeLocalFunds(address account, uint256 chainId) public {
        address subPolicy = msg.sender;
        require(subPolicyLocalBalancePending[subPolicy][account][chainId].blockNumber != 0, "No pending balance.");
        require(
            subPolicyLocalBalancePending[subPolicy][account][chainId].blockNumber < block.number,
            "Need to wait for another block before finalizing."
        );
        subPolicyLocalBalanceFinalized[subPolicy][account][chainId] += subPolicyLocalBalancePending[subPolicy][account][
            chainId
        ].amount;
        subPolicyLocalBalancePending[subPolicy][account][chainId] = PendingBalance({amount: 0, blockNumber: 0});
    }

    /**
     * @notice Deposits funds into the local balance of a sub-policy
     * @param account The account to deposit the funds into
     * @param chainId The chain ID to deposit the funds into
     */
    function depositLocalFunds(address account, uint256 chainId) public payable {
        address subPolicy = msg.sender;
        require(msg.value > 0, "No funds to deposit");
        if (subPolicyLocalBalancePending[subPolicy][account][chainId].blockNumber != 0) {
            if (subPolicyLocalBalancePending[subPolicy][account][chainId].blockNumber < block.number) {
                finalizeLocalFunds(account, chainId);
                subPolicyLocalBalancePending[subPolicy][account][chainId] = PendingBalance({
                    amount: msg.value,
                    blockNumber: block.number
                });
            } else {
                subPolicyLocalBalancePending[subPolicy][account][chainId].amount += msg.value;
            }
        } else {
            subPolicyLocalBalancePending[subPolicy][account][chainId] = PendingBalance({
                amount: msg.value,
                blockNumber: block.number
            });
        }
    }

    /**
     * @dev Called by the key-encumbered wallet contract when an account is enrolled in this policy
     * @notice Notifies the policy that encumbrance has begun
     * @param account The address of the account that is being encumbered
     * @param assets The assets that the account is enrolled in
     * @param expiration The expiration time of the encumbrance
     * @param data This should include the managerAddress in address format
     */
    function notifyEncumbranceEnrollment(
        address owner,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata data
    ) public {
        // Ensure the sender is a wallet linked to this policy
        require(msg.sender == address(walletContract), "Not a wallet contract under this policy");
        require(expiration >= block.timestamp, "Expiration is in the past");
        bool correctAsset = false;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == bytes32(uint256(0x02))) {
                correctAsset = true;
            }
        }
        require(correctAsset, "Ethereum transaction asset is required");
        ourExpiration[account] = expiration;
        address managerAddr = abi.decode(data, (address));
        manager[account] = managerAddr;
        walletOwner = owner;
    }

    /**
     * @notice Enrolls an sub-policy in an encumbrance contract via this policy
     * @param account The encumbered account that the sub-policy will gain control over
     * @param destinations The destination assets that will be enrolled
     * @param subPolicy The sub-policy that is being enrolled
     * @param expiry The expiry time of the sub-policy controll over the encumbered account
     * @param data This should include a bool pair with the first bool indicating whether signature commitments are required
     * and the second bool indicating whether deposit control is required
     */
    function enterEncumbranceContract(
        address account,
        DestinationAsset[] calldata destinations,
        IEncumbrancePolicy subPolicy,
        uint256 expiry,
        bytes calldata data
    ) public {
        require(block.timestamp < expiry, "Already expired");
        require(address(subPolicy) != address(0), "Policy not specified");
        require(msg.sender == manager[account], "Not encumbered account's tx manager");
        require(expiry <= ourExpiration[account], "Expiry is after account's encumbrance expires");
        bytes32[] memory assets = new bytes32[](destinations.length);
        for (uint256 i = 0; i < destinations.length; i++) {
            bytes32 asset = getEncodedAsset(destinations[i]);
            uint256 previousExpiry = encumbranceExpiry[account][asset];
            require(previousExpiry == 0 || previousExpiry < block.timestamp, "Already encumbered");
            encumbranceSubContract[account][asset] = subPolicy;
            encumbranceExpiry[account][asset] = expiry;
            assets[i] = asset;
        }

        (bool sigCommitmentsRequired, bool usesDepositControl) = abi.decode(data, (bool, bool));
        if (!sigCommitmentsRequired) {
            for (uint256 i = 0; i < destinations.length; i++) {
                lastUnlimitedSigner[account][destinations[i].chainId][destinations[i].to] = address(subPolicy);
            }
        }
        depositControl[address(subPolicy)] = usesDepositControl;

        // Notify the policy that encumbrance has begun
        subPolicy.notifyEncumbranceEnrollment(
            msg.sender,
            address(this),
            assets,
            expiry,
            abi.encode(sigCommitmentsRequired)
        );
    }

    /**
     * @notice Proves the inclusion of a transaction on the other chain
     * @param signedTx The signed transaction to prove inclusion of
     * @param inclusionProof The inclusion proof of the transaction
     * @param proofBlockNumber The number of the block where the transaction was included
     */
    function proveTransactionInclusion(
        Type2TxMessageSigned calldata signedTx,
        TransactionProof memory inclusionProof,
        uint256 proofBlockNumber
    ) public {
        uint256 chainId = signedTx.transaction.chainId;

        // Calculate signer address
        bytes memory unsignedTxData = TransactionSerializer.serializeTransaction(signedTx.transaction);
        address signerAccount;
        bytes32 unsignedTxHash = keccak256(unsignedTxData);
        {
            bytes memory signature = bytes.concat(bytes32(signedTx.r), bytes32(signedTx.s), bytes1(uint8(signedTx.v)));
            ECDSA.RecoverError error;
            (signerAccount, error, ) = ECDSA.tryRecover(unsignedTxHash, signature);
            require(error == ECDSA.RecoverError.NoError, "Invalid signature");
        }

        // Prove inclusion
        require(
            keccak256(inclusionProof.rlpBlockHeader) == ethBlockHashOracle.getBlockHash(proofBlockNumber),
            "Block hash incorrect or not found in oracle"
        );

        Type2TxMessageSigned memory signedTxCopy = signedTx;
        signedTxCopy.v -= 27;
        bytes memory includedTx = stateVerifier.validateTxProof(inclusionProof);
        bytes32 signedTxHash = keccak256(TransactionSerializer.serializeSignedTransaction(signedTxCopy));
        require(keccak256(includedTx) == signedTxHash, "Inclusion proof of an incorrect or absent transaction");

        // Update nonce
        require(signedTx.transaction.nonce == transactionCounts[signerAccount][chainId], "Proof out of order");
        transactionCounts[signerAccount][chainId] += 1;
        // Update account balances
        // TODO: Could use receipt to update gas cost.
        bytes32 asset = getEncodedAsset(
            DestinationAsset({
                chainId: signedTx.transaction.chainId,
                to: address(bytes20(signedTx.transaction.destination))
            })
        );

        address subPolicy = address(encumbranceSubContract[signerAccount][asset]);

        // If signature commitments are required and the transaction is not committed, means that the sub-policy that signed it is expired.
        // The balance should be subtracted from that expired sub-policy.
        if (
            lastUnlimitedSigner[signerAccount][chainId][address(bytes20(signedTx.transaction.destination))] != subPolicy
        ) {
            if (committedTransactions[signerAccount][unsignedTxHash].subPolicy == address(0)) {
                subPolicy = lastUnlimitedSigner[signerAccount][chainId][
                    address(bytes20(signedTx.transaction.destination))
                ];
            } else {
                subPolicy = committedTransactions[signerAccount][unsignedTxHash].subPolicy;
            }
        }
        uint256 policyEthBalance = subPolicyEthBalance[subPolicy][signerAccount][chainId];
        uint256 cost = getMaxTransactionCost(signedTx.transaction);

        uint256 newBalance = policyEthBalance > cost ? policyEthBalance - cost : 0;
        subPolicyEthBalance[subPolicy][signerAccount][chainId] = newBalance;

        lastUnlimitedSigner[signerAccount][chainId][address(bytes20(signedTx.transaction.destination))] = address(
            encumbranceSubContract[signerAccount][asset]
        );

        // Record the transaction as signed
        signedIncludedTransactions[signerAccount][address(subPolicy)].push(unsignedTxHash);

        // Pay for the gas cost
        uint256 transferAmount = min(
            estimateInclusionProofCost(signedTx.transaction.payload.length),
            subPolicyLocalBalanceFinalized[address(subPolicy)][signerAccount][chainId]
        );
        payable(msg.sender).transfer(transferAmount);
        subPolicyLocalBalanceFinalized[address(subPolicy)][signerAccount][chainId] -= transferAmount;
    }

    /**
     * @notice It removes the commitment requirement for a specific sub-policy
     * @param account The account to remove the commitment requirement for
     * @param destAsset The destination asset to remove the commitment requirement for
     */
    function releaseCommitmentRequirement(address account, DestinationAsset calldata destAsset) public {
        require(msg.sender == manager[account], "Not encumbered account's tx manager");

        bytes32 asset = getEncodedAsset(destAsset);
        address subPolicy = address(encumbranceSubContract[account][asset]);
        require(address(encumbranceSubContract[account][asset]) == subPolicy, "Not the enrolled subpolicy");
        require(block.timestamp < encumbranceExpiry[account][asset], "Subpolicy lease expired");

        lastUnlimitedSigner[account][destAsset.chainId][destAsset.to] = subPolicy;
    }

    /**
     * @notice Commit to a transaction. Required after enrollment until the account's nonce
     * increases to prevent a previous sub-policy from spending your funds.
     * @param account The encumbered account
     * @param transaction The transaction to commit
     */
    function commitToTransaction(address account, Type2TxMessage memory transaction) public {
        bytes32 asset = findAssetFromTx(transaction);
        require(address(encumbranceSubContract[account][asset]) == msg.sender, "Not the enrolled subpolicy");
        require(block.timestamp < encumbranceExpiry[account][asset], "Subpolicy lease expired");
        // Update nonce to correct nonce and store commitment
        transaction.nonce = transactionCounts[account][transaction.chainId];
        committedTransactions[account][
            keccak256(TransactionSerializer.serializeTransaction(transaction))
        ] = Commitment({subPolicy: msg.sender, blockNumber: block.number});
    }

    /**
     * @notice Signs a transaction off-chain using the encumbered account's key
     * @param account The encumbered account which which signs the transaction
     * @param transaction The transaction to sign
     */
    function signTransaction(address account, Type2TxMessage memory transaction) public view returns (bytes memory) {
        require(
            estimateInclusionProofCost(transaction.payload.length) <=
                subPolicyLocalBalanceFinalized[msg.sender][account][transaction.chainId],
            "Insufficient balance to pay for gas cost later during transaction Inclusion proof"
        );
        if (
            lastUnlimitedSigner[account][transaction.chainId][address(bytes20(transaction.destination))] != msg.sender
        ) {
            bytes32 txHash = keccak256(TransactionSerializer.serializeTransaction(transaction));
            require(committedTransactions[account][txHash].subPolicy == msg.sender, "Transaction not committed");
            require(block.number > committedTransactions[account][txHash].blockNumber, "Need to wait for next block.");
        }
        bytes32 asset = findAssetFromTx(transaction);
        require(address(encumbranceSubContract[account][asset]) == msg.sender, "Not the enrolled subpolicy");
        require(block.timestamp < encumbranceExpiry[account][asset], "Subpolicy lease expired");
        require(transaction.nonce == transactionCounts[account][transaction.chainId], "Incorrect nonce");
        require(
            subPolicyEthBalance[msg.sender][account][transaction.chainId] >= getMaxTransactionCost(transaction),
            "Insufficient balance to send this transaction"
        );

        // Update nonce to correct nonce of transaction and return the signed message
        return walletContract.signMessage(account, TransactionSerializer.serializeTransaction(transaction));
    }
}
