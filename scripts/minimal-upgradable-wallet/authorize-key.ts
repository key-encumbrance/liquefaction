import { ethers, network } from "hardhat";
import { type BytesLike } from "ethers";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const rlIt = rl[Symbol.asyncIterator]();

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer found. Did you set the PRIVATE_KEY environment variable?");
  }
  const [acc1] = signers;
  let walletAddress: string;
  while (true) {
    process.stdout.write("Enter the MinimalUpgradableWallet deployed contract address: ");
    const promptedAddr = (await rlIt.next()).value;
    if (promptedAddr === undefined) {
      return;
    }

    if (ethers.isAddress(promptedAddr)) {
      walletAddress = ethers.getAddress(promptedAddr);
      break;
    } else {
      console.warn("Not an address:", promptedAddr);
    }
  }

  const owner = sapphire.wrap(acc1);
  const wallet = (await ethers.getContractAt("MinimalUpgradableWallet", walletAddress)).connect(
    owner,
  );
  const publicAddr = await wallet.ethAddress();
  const released = await wallet.released();
  if (released) {
    console.log("Key already has been released and wiped from this contract.");
    return;
  }
  console.log("Authorizing for encumbered wallet", publicAddr);

  let recipientPublicKey: BytesLike;
  while (true) {
    process.stdout.write("Enter the recipient's Curve25519 public key: ");
    const promptedValue = (await rlIt.next()).value;
    if (promptedValue === undefined) {
      return;
    }

    if (ethers.isBytesLike(promptedValue) && ethers.dataLength(promptedValue) === 32) {
      recipientPublicKey = promptedValue;
      break;
    } else {
      console.warn("Not a 32-byte hex string:", promptedValue);
    }
  }

  await wallet.requestEncryption(recipientPublicKey);
  const blocksToWait = await wallet.blocksToWait();
  console.log(
    "The key will be available for the recipient to decrypt in",
    Number(blocksToWait),
    "blocks",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
