// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../IBlockHashOracle.sol";

contract TrivialBlockHashOracle is IBlockHashOracle, Ownable {
    mapping(uint256 => bytes32) public blockHashes;

    constructor() Ownable(msg.sender) {}

    function setBlockHash(uint256 _blockNumber, bytes32 _hash) external onlyOwner {
        blockHashes[_blockNumber] = _hash;
    }

    function getBlockHash(uint256 _blockNumber) external view override returns (bytes32) {
        require(blockHashes[_blockNumber] != 0, "No header found for this block");
        return blockHashes[_blockNumber];
    }
}
