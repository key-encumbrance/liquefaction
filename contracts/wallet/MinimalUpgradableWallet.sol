// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";
import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";

contract MinimalUpgradableWallet {
    address public owner;
    bytes private privateKey;
    bytes public publicKey;
    address public ethAddress;
    bool public released;
    uint256 public blocksToWait;

    EncryptionRequest[] public requests;

    event PublicKeyGenerated(address indexed owner, bytes publicKey, address ethAddress);
    event EncryptionRequested(
        address indexed requester,
        Sapphire.Curve25519PublicKey curve25519PublicKey,
        uint256 blockHeight
    );
    event PrivateKeyReleased();

    struct EncryptionRequest {
        Sapphire.Curve25519PublicKey curve25519PublicKey;
        uint256 blockHeight;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can call this function");
        _;
    }

    constructor(uint256 _blocksToWait) {
        owner = msg.sender;
        released = false;
        require(_blocksToWait >= 3, "blocksToWait must be at least 3");
        blocksToWait = _blocksToWait;

        bytes memory seed = Sapphire.randomBytes(32, new bytes(0));
        (publicKey, privateKey) = Sapphire.generateSigningKeyPair(
            Sapphire.SigningAlg.Secp256k1PrehashedKeccak256,
            seed
        );
        ethAddress = EthereumUtils.k256PubkeyToEthereumAddress(publicKey);

        emit PublicKeyGenerated(owner, publicKey, ethAddress);
    }

    function requestEncryption(Sapphire.Curve25519PublicKey curve25519PublicKey) public onlyOwner {
        require(!released, "Key already released");
        requests.push(EncryptionRequest({curve25519PublicKey: curve25519PublicKey, blockHeight: block.number}));

        emit EncryptionRequested(msg.sender, curve25519PublicKey, block.number);
    }

    function getEncryptionRequests() public view returns (EncryptionRequest[] memory) {
        return requests;
    }

    function encryptKeyForRequest(
        uint256 requestId
    ) public view returns (bytes memory ciphertext, bytes32 nonce, Sapphire.Curve25519PublicKey mySharedPubKey) {
        require(requestId < requests.length, "Invalid request ID");
        EncryptionRequest memory req = requests[requestId];
        require(block.number > req.blockHeight + blocksToWait, "Request not finalized");
        (ciphertext, nonce, mySharedPubKey) = encryptPrivateKey(privateKey, req.curve25519PublicKey);
    }

    function encryptPrivateKey(
        bytes memory _privateKey,
        Sapphire.Curve25519PublicKey curve25519PublicKey
    ) internal view returns (bytes memory ciphertext, bytes32 nonce, Sapphire.Curve25519PublicKey mySharedPubKey) {
        Sapphire.Curve25519SecretKey sk;
        (mySharedPubKey, sk) = Sapphire.generateCurve25519KeyPair(new bytes(0));
        bytes32 sharedKey = Sapphire.deriveSymmetricKey(curve25519PublicKey, sk);
        nonce = bytes32(Sapphire.randomBytes(32, new bytes(0)));
        ciphertext = Sapphire.encrypt(sharedKey, nonce, _privateKey, new bytes(0));
    }

    function release() public onlyOwner {
        released = true;
        emit PrivateKeyReleased();
        // Overwrite storage slots with other bytes
        privateKey = hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        hex"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    }
}
