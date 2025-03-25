// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {BasicEncumberedWallet} from "./BasicEncumberedWallet.sol";
import {IEncumbrancePolicy} from "./IEncumbrancePolicy.sol";

contract EnrollmentBlitzTest is IEncumbrancePolicy {
    function testEncumbrance(
        BasicEncumberedWallet wallet,
        uint256 _walletIndex,
        bytes32 _asset,
        bytes calldata _message
    ) public returns (bytes memory) {
        // 1. Create a new wallet
        require(wallet.createWallet(_walletIndex), "Failed to create wallet");

        // 2. Enroll this contract as an encumbrance policy
        uint256 expiry = block.timestamp + 60 * 60;
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = _asset;
        wallet.enterEncumbranceContract(_walletIndex, assets, this, expiry, "0x");

        // 3. Sign a message using the wallet (this should fail!)
        bytes memory signature = wallet.signMessage(wallet.getWalletAddress(_walletIndex), _message);

        // 4. Return the signed message (concatenated with the original message for verification)
        return abi.encodePacked(_message, signature);
    }

    function notifyEncumbranceEnrollment(
        address accountOwner,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata data
    ) external override {
        // No-op, simply allow enrollment
    }
}
