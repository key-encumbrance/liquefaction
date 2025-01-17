// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";
import "solidity-rlp/contracts/RLPReader.sol";
import {Type2TxMessage} from "./EthereumTransaction.sol";

contract TransactionReader {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for RLPReader.Iterator;
    using RLPReader for bytes;

    function parseTransaction(bytes calldata txBytes) public pure returns (Type2TxMessage memory) {
        require(txBytes[0] == 0x02, "Only type 2 transactions supported");
        bytes memory txRlpBytes = txBytes[1:];
        RLPReader.RLPItem[] memory ls = txRlpBytes.toRlpItem().toList();
        require(ls.length == 9, "Wrong RLP list length for type 2 transactions");

        Type2TxMessage memory _tx;
        _tx.chainId = ls[0].toUint();
        _tx.nonce = ls[1].toUint();
        _tx.maxPriorityFeePerGas = ls[2].toUint();
        _tx.maxFeePerGas = ls[3].toUint();
        _tx.gasLimit = ls[4].toUint();
        _tx.destination = ls[5].toBytes();
        _tx.amount = ls[6].toUint();
        _tx.payload = ls[7].toBytes();
        // Ignore the access list
        ls[8].toList();

        return _tx;
    }
}
