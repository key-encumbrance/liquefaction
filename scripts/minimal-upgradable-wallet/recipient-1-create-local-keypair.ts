import { ethers, network } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";

async function main() {
  if (network.name !== "dev") {
    throw new Error("Run this in a local environment and use `--network dev`");
  }
  const [acc1] = await ethers.getSigners();
  const owner = sapphire.wrap(acc1);

  // Deploy receiver contract locally
  const receiverFactory = await ethers.getContractFactory("MinimalUpgradableWalletReceiver");
  const reciever = await receiverFactory.deploy();

  // Generate key pair
  let pk: string;
  let sk: string;
  ({ pk, sk } = await reciever.generateKeyPair());
  console.log("Curve25519 keypair:");
  console.log({ pk, sk });
  console.log("Have the wallet deployer authorize your public key `pk`.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
