// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {EthTransactionPolicy} from "../EthTransactionPolicy.sol";
import {IEncumberedWallet} from "../../IEncumberedWallet.sol";
import {IEncumbrancePolicy} from "../../IEncumbrancePolicy.sol";
import {Type2TxMessage, Type2TxMessageSigned} from "../../../parsing/EthereumTransaction.sol";
import {TransactionSerializer} from "../../../parsing/TransactionSerializer.sol";
import {TransactionProof} from "../../../proveth/ProvethVerifier.sol";

/**
 * @title Test Transaction Sub-Policy
 * @notice A minimal transaction sub-policy used for testing transaction encumbrance. This
 * contract does not perform any kind of authentication and therefore should not be used
 * outside a testing environment.
 */
contract TestTransactionSubPolicy is IEncumbrancePolicy {
    /// @notice The encumbered wallet contract that this policy trusts
    EthTransactionPolicy public txPolicyContract;
    /// @notice The owner of the contract who is granted the ability to sign messages from the
    /// encumbered accounts that enroll in this policy.
    address public owner;

    uint256 ethTestChainId = 30_121;

    /**
     * @dev Constructor
     * @param parentPolicy The parent Ethereum transaction policy contract that this sub-policy trusts
     */
    constructor(EthTransactionPolicy parentPolicy) {
        txPolicyContract = parentPolicy;
        owner = msg.sender;
    }

    /**
     * @dev Called by the parent policy when an account is enrolled in this policy
     * @param expiration The time at which the enrollment expires
     */
    function notifyEncumbranceEnrollment(
        address,
        address,
        bytes32[] calldata,
        uint256 expiration,
        bytes calldata
    ) public view {
        require(msg.sender == address(txPolicyContract), "Not wallet contract");
        require(expiration >= block.timestamp, "Expiration is in the past");
    }

    /**
     * @notice Gets the balance of the sub-policy
     * @param wallet The wallet address
     * @param chainId The chain id
     * @return The balance of the sub-policy
     */
    function getSubPolicyBalance(address wallet, uint256 chainId) public view returns (uint256) {
        return txPolicyContract.getEthBalance(wallet, chainId);
    }

    /**
     * @notice Commits to a transaction. Needed when the superPolicy requires commitments
     * @param account The account that is committing to the transaction
     * @param transaction The transaction that is being committed to
     */
    function commitToTransaction(address account, Type2TxMessage memory transaction) public {
        require(msg.sender == owner, "You are not the owner of the sub-policy");
        txPolicyContract.commitToTransaction(account, transaction);
    }

    /**
     * @notice Lets the contract owner sign an Ethereum message on behalf of an encumbered account
     * @param account The account that is signing the transaction
     * @param transaction The transaction that is being signed
     */
    function signOnBehalf(address account, Type2TxMessage memory transaction) public view returns (bytes memory) {
        require(msg.sender == owner, "You are not the owner of the sub-policy");
        return txPolicyContract.signTransaction(account, transaction);
    }

    /**
     * @notice Commits to a deposit to claim the deposited funds
     * @param transactionHash The hash of the transaction that is being committed to
     */
    function commitToDeposit(bytes32 transactionHash) public {
        txPolicyContract.commitToDeposit(transactionHash);
    }

    /**
     * @notice Deposits funds into the encumbered wallet
     * @param account The account that is depositing the funds
     * @param amount The amount of funds being deposited
     */
    function depositLocalFunds(address account, uint256 amount) public payable {
        txPolicyContract.depositLocalFunds{value: msg.value}(account, amount);
    }

    /**
     * @notice Finalizes the deposit of funds into the encumbered wallet
     * @param account The account that is finalizing the deposit
     * @param amount The amount of funds being finalized
     */
    function finalizeLocalFunds(address account, uint256 amount) public {
        txPolicyContract.finalizeLocalFunds(account, amount);
    }

    /**
     * @notice Signs a transaction if includedTx is included in the transaction list
     * @param account The account that is signing the transaction
     * @param transaction The transaction that is being signed
     * @param includedTx The transaction that needs to be included
     * @return The signed transaction
     */
    function signIfTransactionIsIncluded(
        address account,
        Type2TxMessage memory transaction,
        Type2TxMessage memory includedTx
    ) public view returns (bytes memory) {
        require(msg.sender == owner, "You are not the owner of the sub-policy");
        bytes32[] memory includedTxs = txPolicyContract.getSignedIncludedTransactions(account);
        bool isTxIncluded = false;
        bytes32 txHash = keccak256(TransactionSerializer.serializeTransaction(includedTx));
        for (uint256 i = 0; i < includedTxs.length; i++) {
            if (includedTxs[i] == txHash) {
                isTxIncluded = true;
                break;
            }
        }
        require(isTxIncluded, "Transaction is not included");
        return txPolicyContract.signTransaction(account, transaction);
    }

    /**
     * @notice Accepts a deposit
     * @param signedTx The signed transaction
     * @param inclusionProof The inclusion proof
     */
    function acceptDeposit(Type2TxMessageSigned calldata signedTx, TransactionProof memory inclusionProof) public {
        txPolicyContract.depositFunds(signedTx, inclusionProof);
    }
}
