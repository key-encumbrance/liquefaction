// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IBlockHashOracle {
    function getBlockHash(uint256 blockNumber) external returns (bytes32);
}
