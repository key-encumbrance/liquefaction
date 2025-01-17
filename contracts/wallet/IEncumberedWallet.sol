// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {IEncumbrancePolicy} from "./IEncumbrancePolicy.sol";
import {EIP712DomainParams} from "../parsing/EIP712Utils.sol";

interface IEncumberedWallet {
    // Wallet creation/account access functions
    function createWallet(uint256 index) external returns (bool);
    function getWalletAddress(uint256 walletIndex) external view returns (address);

    // Enrolling in encumbrance policies
    function enterEncumbranceContract(
        uint256 walletIndex,
        bytes32[] calldata assets,
        IEncumbrancePolicy policy,
        uint256 expiry,
        bytes calldata data
    ) external;

    // Signing
    function signMessage(address account, bytes calldata message) external view returns (bytes memory);

    function signTypedData(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) external view returns (bytes memory);

    // Returns the asset ID recognized by this encumbered wallet or 0 if the asset is not recognized
    function findAsset(bytes calldata message) external view returns (bytes32);
    function findEip712Asset(
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) external view returns (bytes32);
}
