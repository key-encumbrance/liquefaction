// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "solidity-rlp/contracts/RLPReader.sol";
import {Type2TxMessage, Type2TxMessageSigned} from "./EthereumTransaction.sol";
import {RLPEncode} from "./RLPEncode.sol";

library TransactionSerializer {
    uint256 constant unsignedTxRlpLength = 9;

    function serializeTransactionToRlp(Type2TxMessage calldata _tx) public pure returns (bytes[] memory txRlpItems) {
        txRlpItems = new bytes[](unsignedTxRlpLength);
        txRlpItems[0] = RLPEncode.encodeUint(_tx.chainId);
        txRlpItems[1] = RLPEncode.encodeUint(_tx.nonce);
        txRlpItems[2] = RLPEncode.encodeUint(_tx.maxPriorityFeePerGas);
        txRlpItems[3] = RLPEncode.encodeUint(_tx.maxFeePerGas);
        txRlpItems[4] = RLPEncode.encodeUint(_tx.gasLimit);
        txRlpItems[5] = RLPEncode.encodeBytes(_tx.destination);
        txRlpItems[6] = RLPEncode.encodeUint(_tx.amount);
        txRlpItems[7] = RLPEncode.encodeBytes(_tx.payload);
        // Empty access list
        bytes[] memory emptyList;
        txRlpItems[8] = RLPEncode.encodeList(emptyList);
    }

    function serializeTransaction(Type2TxMessage calldata _tx) public pure returns (bytes memory txBytes) {
        txBytes = bytes.concat(hex"02", RLPEncode.encodeList(serializeTransactionToRlp(_tx)));
    }

    function serializeSignedTransactionToRlp(
        Type2TxMessageSigned calldata signedTx
    ) public pure returns (bytes[] memory signedTxRlpItems) {
        bytes[] memory unsignedTxRlpItems = serializeTransactionToRlp(signedTx.transaction);
        signedTxRlpItems = new bytes[](unsignedTxRlpLength + 3);
        for (uint i = 0; i < unsignedTxRlpLength; i++) {
            signedTxRlpItems[i] = unsignedTxRlpItems[i];
        }
        signedTxRlpItems[unsignedTxRlpLength] = RLPEncode.encodeUint(signedTx.v);
        signedTxRlpItems[unsignedTxRlpLength + 1] = RLPEncode.encodeUint(signedTx.r);
        signedTxRlpItems[unsignedTxRlpLength + 2] = RLPEncode.encodeUint(signedTx.s);
    }

    function serializeSignedTransaction(
        Type2TxMessageSigned calldata signedTx
    ) public pure returns (bytes memory txBytes) {
        txBytes = bytes.concat(hex"02", RLPEncode.encodeList(serializeSignedTransactionToRlp(signedTx)));
    }
}
