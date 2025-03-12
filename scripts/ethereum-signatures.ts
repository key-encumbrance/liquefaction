import { ethers } from "ethers";

export function createEthereumMessage(message: string): Uint8Array {
  const messageEth = "\u0019Ethereum Signed Message:\n" + message.length + message;
  const messageEthBytes = ethers.toUtf8Bytes(messageEth);
  return messageEthBytes;
}

// Convert a Sapphire DER-encoded signature to an Ethereum signature
export function derToEthSignature(
  signature: string,
  messageOrDigest: string | Uint8Array,
  expectedAddress: string,
  type: "message" | "bytes" | "digest",
): string | undefined {
  // DER-encoded sequence with correct length
  let pos = 0;
  if (ethers.dataSlice(signature, pos, pos + 1) !== "0x30") {
    throw new Error("Expected DER sequence");
  }

  pos++;
  if (
    ethers.dataSlice(signature, pos, pos + 1) !== ethers.toBeHex(ethers.dataLength(signature) - 2)
  ) {
    throw new Error("Incorrect DER element length");
  }

  pos++;

  // Parse signature
  const pieces = [];
  for (let i = 0; i < 2; i++) {
    if (ethers.dataSlice(signature, pos, pos + 1) !== "0x02") {
      throw new Error("Expected DER integer");
    }

    pos++;
    const length = ethers.getBytes(ethers.dataSlice(signature, pos, pos + 1))[0];
    pos++;
    let piece = ethers.dataSlice(signature, pos, pos + length);
    pos += length;
    if (length === 33) {
      // Trim extra zero byte
      if (ethers.dataSlice(piece, 0, 1) !== "0x00") {
        throw new Error("Expected to trim an extra zero byte");
      }
      piece = ethers.dataSlice(piece, 1, 33);
    }

    if (ethers.dataLength(piece) < 32) {
      piece = ethers.zeroPadValue(piece, 32);
    }

    if (ethers.dataLength(piece) !== 32) {
      console.log(signature, messageOrDigest, expectedAddress, type);
      throw new Error("Piece length is " + ethers.dataLength(piece) + ", expected 32");
    }

    pieces.push(piece);
  }

  let ethSig: string | undefined = undefined;
  for (let i = 0; i < 2; i++) {
    const potentialSignature = ethers.concat([...pieces, ethers.toBeHex(0x1b + i)]);
    try {
      if (type === "message") {
        if (ethers.verifyMessage(messageOrDigest, potentialSignature) === expectedAddress) {
          ethSig = potentialSignature;
          break;
        }
      } else if (type === "bytes" || type === "digest") {
        if (
          ethers.recoverAddress(
            type === "digest" ? messageOrDigest : ethers.keccak256(messageOrDigest),
            potentialSignature,
          ) === expectedAddress
        ) {
          ethSig = potentialSignature;
          break;
        }
      }
    } catch (error) {
      console.warn("Skipped an error:", error);
    }
  }

  return ethSig;
}
