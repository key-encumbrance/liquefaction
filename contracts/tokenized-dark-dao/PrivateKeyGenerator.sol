// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";
import {EthereumUtils} from "@oasisprotocol/sapphire-contracts/contracts/EthereumUtils.sol";

contract PrivateKeyGenerator {
    function generatePrivateKey(
        bytes memory pers
    ) internal view returns (bytes memory privateKey, address publicAddress) {
        bytes memory seed = Sapphire.randomBytes(32, pers);
        bytes memory publicKey;
        (publicKey, privateKey) = Sapphire.generateSigningKeyPair(
            Sapphire.SigningAlg.Secp256k1PrehashedKeccak256,
            seed
        );
        require(publicKey.length > 0, "Public key length is 0");
        publicAddress = EthereumUtils.k256PubkeyToEthereumAddress(publicKey);
    }
}
