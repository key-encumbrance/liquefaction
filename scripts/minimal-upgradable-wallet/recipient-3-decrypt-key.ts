import { ethers, network } from "hardhat";
import { type BytesLike } from "ethers";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const rlIt = rl[Symbol.asyncIterator]();

async function main() {
  if (network.name !== "dev") {
    throw new Error("Run this in a local environment and use `--network dev`");
  }
  const [acc1] = await ethers.getSigners();
  const owner = sapphire.wrap(acc1);

  // Deploy receiver contract locally
  const receiverFactory = await ethers.getContractFactory("MinimalUpgradableWalletReceiver");
  const reciever = await receiverFactory.deploy();

  let keyData: { ciphertext: string; nonce: string; sharedPubKey: string };
  while (true) {
    process.stdout.write("Enter the encrypted key JSON object: ");
    const promptedValue = (await rlIt.next()).value;
    if (promptedValue === undefined) {
      return;
    }

    try {
      const jsonRes = JSON.parse(promptedValue);
      if (!("ciphertext" in jsonRes) || !("nonce" in jsonRes) || !("sharedPubKey" in jsonRes)) {
        throw new Error("JSON object doesn't have all the required properties");
      }
      keyData = jsonRes;
      break;
    } catch (e: any) {
      console.warn("Not a JSON value", "\n", e);
    }
  }

  let recipientSecretKey: BytesLike;
  while (true) {
    process.stdout.write("Enter your Curve25519 secret key: ");
    const promptedValue = (await rlIt.next()).value;
    if (promptedValue === undefined) {
      return;
    }

    if (ethers.isBytesLike(promptedValue) && ethers.dataLength(promptedValue) === 32) {
      recipientSecretKey = promptedValue;
      break;
    } else {
      console.warn("Not a 32-byte hex string");
    }
  }

  let decryptedKey = await reciever.decryptKeyFromRequest(
    keyData.ciphertext,
    keyData.nonce,
    keyData.sharedPubKey,
    recipientSecretKey,
  );
  console.log("\x1b[93mDecrypted key:", decryptedKey, "\x1b[0m");

  // Get wallet public address
  const recoveredWallet = new ethers.Wallet(decryptedKey);
  console.log("Public address of decrypted key:", recoveredWallet.address);
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
