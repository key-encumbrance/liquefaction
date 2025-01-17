// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {Type2TxMessage, Type2TxMessageSigned} from "./EthereumTransaction.sol";
import {TransactionSerializer} from "./TransactionSerializer.sol";

contract TransactionSerializerTest {
    function serializeTransaction(Type2TxMessage calldata _tx) public pure returns (bytes memory txBytes) {
        return TransactionSerializer.serializeTransaction(_tx);
    }

    function serializeSignedTransaction(
        Type2TxMessageSigned calldata signedTx
    ) public pure returns (bytes memory txBytes) {
        return TransactionSerializer.serializeSignedTransaction(signedTx);
    }
}
