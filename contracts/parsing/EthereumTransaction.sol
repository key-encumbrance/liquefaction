// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

struct Type2TxMessage {
    uint256 chainId;
    uint256 nonce;
    uint256 maxPriorityFeePerGas;
    uint256 maxFeePerGas;
    uint256 gasLimit;
    bytes destination;
    uint256 amount;
    bytes payload;
    // accessList has been omitted
}

struct Type2TxMessageSigned {
    Type2TxMessage transaction;
    uint256 r;
    uint256 s;
    uint256 v;
}
