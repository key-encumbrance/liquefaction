// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";
import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";

contract MinimalUpgradableWalletReceiver {
    function generateKeyPair() public view returns (Sapphire.Curve25519PublicKey pk, Sapphire.Curve25519SecretKey sk) {
        (pk, sk) = Sapphire.generateCurve25519KeyPair(new bytes(0));
    }

    function decryptKeyFromRequest(
        bytes memory ciphertext,
        bytes32 nonce,
        Sapphire.Curve25519PublicKey peerPublicKey,
        Sapphire.Curve25519SecretKey secretKey
    ) public view returns (bytes memory decrypted) {
        bytes32 sharedKey = Sapphire.deriveSymmetricKey(peerPublicKey, secretKey);
        decrypted = Sapphire.decrypt(sharedKey, nonce, ciphertext, new bytes(0));
    }

    function encryptPrivateKey(
        bytes memory _privateKey,
        Sapphire.Curve25519PublicKey curve25519PublicKey
    ) public view returns (bytes memory ciphertext, bytes32 nonce, Sapphire.Curve25519PublicKey mySharedPubKey) {
        Sapphire.Curve25519SecretKey sk;
        (mySharedPubKey, sk) = Sapphire.generateCurve25519KeyPair(new bytes(0));
        bytes32 sharedKey = Sapphire.deriveSymmetricKey(curve25519PublicKey, sk);
        nonce = bytes32(Sapphire.randomBytes(32, new bytes(0)));
        ciphertext = Sapphire.encrypt(sharedKey, nonce, _privateKey, new bytes(0));
    }
}
