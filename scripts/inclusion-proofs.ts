import {
  ethers,
  type BytesLike,
  type WebSocketProvider,
  type TransactionResponse,
  JsonRpcApiProvider,
} from "ethers";
import { Trie } from "@ethereumjs/trie";
import { derToEthSignature } from "./ethereum-signatures";
import { encode } from "rlp";

export function getMappingStorageSlot(mappingKey: BytesLike, mappingSlot: BytesLike): string {
  return ethers.keccak256(
    ethers.concat([ethers.zeroPadValue(mappingKey, 32), ethers.zeroPadValue(mappingSlot, 32)]),
  );
}

export function getRpcUint(number: any): string {
  return "0x" + BigInt(number).toString(16);
}

export function getRlpUint(number: any): string {
  let hex_value = "0x" + number.toString(16);
  if (hex_value.length % 2 != 0) {
    hex_value = "0x0" + hex_value.slice(2);
  }
  return number > 0 ? ethers.encodeRlp(ethers.getBytes(hex_value)) : ethers.encodeRlp("0x");
}

export async function getTxInclusionProof(
  provider: JsonRpcApiProvider,
  blockNumber: number,
  txIndex: number,
): Promise<{ rlpBlockHeader: string; proof: string[] }> {
  const rawBlock = await provider.send("debug_getRawBlock", [getRpcUint(blockNumber)]);
  const blockRlp = ethers.decodeRlp(rawBlock);
  // TODO: Review whether we can make this type conversion
  const blockHeader: string[] = blockRlp[0] as string[];
  const rawTransactions: string[] = blockRlp[1] as string[];

  // Build Merkle tree
  const trie = new Trie();
  for (let [i, rawTransaction] of rawTransactions.entries()) {
    if (typeof rawTransaction == "object") {
      await trie.put(ethers.getBytes(getRlpUint(i)), ethers.getBytes(encode(rawTransaction)));
    } else {
      await trie.put(ethers.getBytes(getRlpUint(i)), ethers.getBytes(rawTransaction));
    }
  }

  // Ensure the transaction root was constructed the same way
  const txRoot = ethers.hexlify(trie.root());
  if (txRoot != blockHeader[4]) {
    throw new Error(
      "Constructed transaction Merkle tree has a root inconsistent with the transactionsRoot in the block header",
    );
  }

  if (txIndex >= rawTransactions.length) {
    throw new Error("Transaction index is outside the range of this block");
  }

  // Generate the proof of the transaction
  const txProof = await trie.createProof(ethers.getBytes(getRlpUint(txIndex)));
  const txProofHex = txProof.map((x) => ethers.hexlify(x));
  return {
    rlpBlockHeader: ethers.encodeRlp(blockHeader),
    proof: txProofHex,
  };
}
