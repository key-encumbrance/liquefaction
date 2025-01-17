import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer found. Did you set the PRIVATE_KEY environment variable?");
  }
  const [acc1] = signers;
  const owner = sapphire.wrap(acc1);
  console.log("Owner address:", owner.address);
  const walletFactory = await ethers.getContractFactory("MinimalUpgradableWallet");
  const wallet = await walletFactory.connect(owner).deploy(10);
  console.log("Minimal Upgradable Wallet deployed to\x1b[93m", wallet.target, "\x1b[0m");
  console.log("Code hash:", ethers.keccak256(await ethers.provider.getCode(wallet.target)));
  const ethAddr = await wallet.ethAddress();
  console.log("Public address of encumbered account:", ethAddr);
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
