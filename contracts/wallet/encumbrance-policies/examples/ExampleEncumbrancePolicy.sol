// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {EIP712DomainParams} from "../../../parsing/EIP712Utils.sol";
import {IEncumbrancePolicy} from "../../IEncumbrancePolicy.sol";
import {IEncumberedWallet} from "../../IEncumberedWallet.sol";

/**
 * @title Example Encumbrance Policy
 * @notice A minimal encumbrance policy demonstrating how to encumber Ethereum signed messages.
 * This contract is just an example and doesn't have much use; enrolling in this policy would allow
 * the contract owner to sign Ethereum messages (yet not transactions) using your encumbered
 * account's private key. Until the enrollment expires, the account owner is unable to sign messages
 * from the same account.
 */
contract ExampleEncumbrancePolicy is IEncumbrancePolicy {
    // @notice The encumbered wallet contract that this policy trusts
    IEncumberedWallet public walletContract;
    // @notice The owner of the contract who is granted the ability to sign messages from the
    // encumbered accounts that enroll in this policy.
    address public owner;

    constructor(IEncumberedWallet encumberedWallet) {
        walletContract = encumberedWallet;
        owner = msg.sender;
    }

    /**
     * @dev Called by the key-encumbered wallet contract when an account is enrolled in this policy
     */
    function notifyEncumbranceEnrollment(
        address,
        address,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata
    ) public view {
        require(msg.sender == address(walletContract), "Not wallet contract");
        require(expiration >= block.timestamp, "Expiration is in the past");

        bool assetFound = false;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == bytes32(uint256(0x1945))) {
                assetFound = true;
                break;
            }
        }
        require(assetFound, "Required message asset not included");
    }

    /**
     * @notice Lets the contract owner sign an Ethereum message on behalf of an encumbered account
     */
    function signOnBehalf(address account, bytes calldata message) public view returns (bytes memory) {
        require(msg.sender == owner);
        return walletContract.signMessage(account, message);
    }

    /**
     * @notice Lets the contract owner sign an EIP-712 typed data message on behalf of an encumbered account
     */
    function signTypedData(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        require(msg.sender == owner);
        return walletContract.signTypedData(account, domain, dataType, data);
    }
}
