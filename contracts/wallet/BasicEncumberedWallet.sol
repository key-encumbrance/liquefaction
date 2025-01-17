// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";
import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";

import "./IEncumbrancePolicy.sol";
import "./IEncumberedWallet.sol";

import {EIP712DomainParams, EIP712Utils} from "../parsing/EIP712Utils.sol";

struct EncumberedAccount {
    address owner;
    uint256 index;
}

contract BasicEncumberedWallet is IEncumberedWallet {
    // Mapping to wallets; access must always be authorized
    mapping(address => mapping(uint256 => bytes)) private privateKeys;
    mapping(address => mapping(uint256 => bytes)) private publicKeys;
    mapping(address => mapping(uint256 => address)) private addresses;
    mapping(address => EncumberedAccount) private accounts;
    mapping(address => mapping(bytes32 => IEncumbrancePolicy)) private encumbranceContract;
    mapping(address => mapping(bytes32 => uint256)) private encumbranceExpiry;

    /**
     * @notice Create a new wallet
     * @param index Index of the new wallet. This number should be randomly
     * sampled to protect against certain privacy-related side channel attacks.
     * @return true If a new wallet was created
     */
    function createWallet(uint256 index) public returns (bool) {
        // Ensure that an existing wallet is not overwritten
        if (publicKeys[msg.sender][index].length > 0) {
            return false;
        }
        bytes memory empty;
        bytes memory seed = Sapphire.randomBytes(32, empty);
        bytes memory publicKey;
        bytes memory privateKey;
        (publicKey, privateKey) = Sapphire.generateSigningKeyPair(
            Sapphire.SigningAlg.Secp256k1PrehashedKeccak256,
            seed
        );
        require(publicKey.length > 0, "Public key length is 0");
        publicKeys[msg.sender][index] = publicKey;
        privateKeys[msg.sender][index] = privateKey;
        address addr = EthereumUtils.k256PubkeyToEthereumAddress(publicKey);
        addresses[msg.sender][index] = addr;
        accounts[addr] = EncumberedAccount({owner: msg.sender, index: index});
        return true;
    }

    /**
     * @notice Get the public key of a wallet
     * @param walletIndex Index of the wallet
     */
    function getPublicKey(uint256 walletIndex) public view returns (bytes memory) {
        bytes memory publicKey = publicKeys[msg.sender][walletIndex];
        return publicKey;
    }

    /**
     * @notice Get the address of a wallet
     * @param walletIndex Index of the wallet
     */
    function getWalletAddress(uint256 walletIndex) public view returns (address) {
        address walletAddress = addresses[msg.sender][walletIndex];
        require(walletAddress != address(0), "Wallet does not exist");
        return walletAddress;
    }

    /**
     * @notice Enter an encumbrance contract with a wallet for a set of assets
     * @param walletIndex Index of the wallet
     * @param assets List of assets the policy will have access to
     * @param policy The encumbrance policy
     * @param expiry Expiry time of the encumbrance contract
     * @param data Additional data for the encumbrance policy
     */
    function enterEncumbranceContract(
        uint256 walletIndex,
        bytes32[] calldata assets,
        IEncumbrancePolicy policy,
        uint256 expiry,
        bytes calldata data
    ) public {
        require(block.timestamp < expiry, "Already expired");
        require(address(policy) != address(0), "Policy not specified");
        address account = getWalletAddress(walletIndex);
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 previousExpiry = encumbranceExpiry[account][assets[i]];
            require(previousExpiry == 0 || previousExpiry < block.timestamp, "Already encumbered");
            encumbranceContract[account][assets[i]] = policy;
            encumbranceExpiry[account][assets[i]] = expiry;
        }

        // Notify the policy that encumbrance has begun
        policy.notifyEncumbranceEnrollment(msg.sender, account, assets, expiry, data);
    }

    /**
     * @notice Exit an encumbrance contract with a wallet for a set of assets
     * @param message Bytes containing the asset information
     */
    function findAsset(bytes calldata message) public pure returns (bytes32) {
        bytes32 asset = 0;
        if (message.length > 0) {
            if (message[0] == hex"19") {
                // EIP-191 signed data
                if (message.length > 1) {
                    if (message[1] == 0x01) {
                        // EIP-712: Typed structured data
                        // Only recognized through the typed data signing methods
                        asset = bytes32(0);
                    } else if (message[1] == 0x45) {
                        // EIP-191 "Ethereum Signed Message" messages
                        asset = bytes32(uint256(0x1945));
                    }
                }
            } else if (message[0] == hex"02") {
                // Ethereum type-2 transaction
                asset = bytes32(uint256(0x02));
            }
        }
        return asset;
    }

    /**
     * @notice Find the asset for an EIP-712 message
     * @param domain EIP-712 domain
     * @return The asset
     */
    function findEip712Asset(
        EIP712DomainParams memory domain,
        string calldata,
        bytes calldata
    ) public pure returns (bytes32) {
        return keccak256(bytes.concat(bytes("EIP-712 "), bytes(domain.name)));
    }

    /**
     * @notice Sign an authorised message
     * @param owner The owner of the wallet
     * @param walletIndex Index of the wallet
     * @param message The message to be signed
     * @return DER-encoded signature
     */
    function signMessageAuthorized(
        address owner,
        uint256 walletIndex,
        bytes calldata message
    ) private view returns (bytes memory) {
        bytes memory privateKey = privateKeys[owner][walletIndex];
        require(privateKey.length > 0, "Wallet does not exist");

        bytes32 asset = BasicEncumberedWallet(address(this)).findAsset(message);
        // TODO: Whether owners should be forbidden from signing messages about non-recognized assets (path to
        // encumbrance contract upgrades) or allowed (no path out of pre-signing attacks) is a tradeoff.
        // Here, as a measure of upgradability, other messages are not allowed.
        require(asset != 0, "Message type not recognized");

        address account = addresses[owner][walletIndex];
        require(block.timestamp < encumbranceExpiry[account][asset], "Encumbrance expired");

        bytes32 messageHash = keccak256(message);
        bytes memory signature = Sapphire.sign(
            Sapphire.SigningAlg.Secp256k1PrehashedKeccak256,
            privateKey,
            bytes.concat(messageHash),
            ""
        );
        return signature;
    }

    /**
     @notice Sign an arbitrary message. NOTE: This message might be an Ethereum transaction or typed data, or anything.
     @param message The message to be signed.
     @return DER-encoded signature
     */
    function signMessageSelf(uint256 walletIndex, bytes calldata message) public view returns (bytes memory) {
        address account = getWalletAddress(walletIndex);
        return signMessage(account, message);
    }

    /**
     @notice Sign an arbitrary ethereum transaction
     @param account The account that will sign the message.
     @param message The message to be signed.
     @return DER-encoded signature
     */
    function signMessage(address account, bytes calldata message) public view returns (bytes memory) {
        bytes32 asset = BasicEncumberedWallet(address(this)).findAsset(message);
        require(asset != 0, "Asset not found");
        require(address(encumbranceContract[account][asset]) == msg.sender, "Not encumbered by sender");
        require(block.timestamp < encumbranceExpiry[account][asset], "Rental expired");
        EncumberedAccount memory acc = accounts[account];
        return signMessageAuthorized(acc.owner, acc.index, message);
    }

    /**
     * @notice Sign typed data.
     * @param owner The owner of the wallet
     * @param walletIndex Index of the wallet
     * @param domain EIP-712 domain
     * @param dataType Data type according to EIP-712
     * @param data Struct containing the data contents
     * @return DER-encoded signature
     */
    function signTypedDataAuthorized(
        address owner,
        uint256 walletIndex,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) private view returns (bytes memory) {
        bytes memory privateKey = privateKeys[owner][walletIndex];
        require(privateKey.length > 0, "Wallet does not exist");

        // Calculate hash
        bytes32 messageHash = EIP712Utils.getTypedDataHash(domain, dataType, data);
        bytes memory signature = Sapphire.sign(
            Sapphire.SigningAlg.Secp256k1PrehashedKeccak256,
            privateKey,
            bytes.concat(messageHash),
            ""
        );
        return signature;
    }

    /**
     @notice Sign typed data. NOTE: The contents of the data are not type checked.
     @param account The account that will sign the typed data.
     @param domain EIP-712 domain
     @param dataType Data type according to EIP-712
     @param data Struct containing the data contents
     @return DER-encoded signature
     */
    function signTypedData(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        bytes32 asset = BasicEncumberedWallet(address(this)).findEip712Asset(domain, dataType, data);
        require(asset != 0, "Typed data message type not recognized");

        require(address(encumbranceContract[account][asset]) == msg.sender, "Not encumbered by sender");
        require(block.timestamp < encumbranceExpiry[account][asset], "Rental expired");

        EncumberedAccount memory acc = accounts[account];
        return signTypedDataAuthorized(acc.owner, acc.index, domain, dataType, data);
    }
}
