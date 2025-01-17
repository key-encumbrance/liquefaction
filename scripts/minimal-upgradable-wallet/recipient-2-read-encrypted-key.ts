import { ethers, network } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const rlIt = rl[Symbol.asyncIterator]();

async function main() {
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
  const wallet = await ethers.getContractAt("MinimalUpgradableWallet", walletAddress);
  const publicAddr = await wallet.ethAddress();
  console.log("Encumbered wallet address:", publicAddr);

  let requestIndex: number;
  while (true) {
    process.stdout.write("Enter the request index (usually 0): ");
    const promptedValue = (await rlIt.next()).value;
    if (promptedValue === undefined) {
      return;
    }

    if (!Number.isNaN(Number(promptedValue))) {
      requestIndex = Number(promptedValue);
      break;
    } else {
      console.warn("Not a number:", promptedValue);
    }
  }

  console.log("Requesting encrypted key for request index", requestIndex);
  const [ciphertext, nonce, sharedPubKey] = await wallet.encryptKeyForRequest(requestIndex);
  console.log("Result:");
  console.log(JSON.stringify({ ciphertext, nonce, sharedPubKey }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
