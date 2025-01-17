import { ethers } from "hardhat";
import { Contract, Signer, type ContractFactory } from "ethers";
import { expect } from "chai";

function retryPromise<T>(factory: () => Promise<T>, timeout: number = 60000): Promise<T> {
  let tries = 0;
  return new Promise<T>(async (resolve, reject) => {
    while (true) {
      try {
        // Create a promise that rejects after the specified timeout
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Promise timed out")), timeout),
        );

        // Use Promise.race to race the original promise against the timeout
        const result = await Promise.race([factory(), timeoutPromise]);
        // If the original promise resolves before the timeout, return the result
        resolve(result);
        return; // Exit the loop
      } catch (error) {
        // If the promise times out or fails, continue the loop to retry
        console.error("Promise failed or timed out, retrying...", error);
        tries++;

        if (tries > 100) {
          throw error;
        }
      }
    }
  });
}

async function getMinimalUpgradableWalletReceiver() {
  const receiverFactory = await ethers.getContractFactory("MinimalUpgradableWalletReceiver");
  console.log("Deploying MinimalUpgradableWalletReceiver...");
  const receiver = await retryPromise(() => receiverFactory.deploy());
  console.log("Deployed.");
  return receiver;
}

describe("MinimalUpgradableWalletReceiver", function () {
  let MinimalUpgradableWalletReceiver: Awaited<
    ReturnType<typeof getMinimalUpgradableWalletReceiver>
  >;
  let senderSk: string, senderPk: string, receiverSk: string, receiverPk: string;
  let owner: Signer;

  async function initialDeployments() {
    // Deploy the contract before each test
    [owner] = await ethers.getSigners();
    MinimalUpgradableWalletReceiver = await getMinimalUpgradableWalletReceiver();

    // Generate key pairs for sender and receiver
    console.log("Generating keypairs...");
    ({ pk: senderPk, sk: senderSk } = await MinimalUpgradableWalletReceiver.generateKeyPair());
    ({ pk: receiverPk, sk: receiverSk } = await MinimalUpgradableWalletReceiver.generateKeyPair());
    console.log("Keypairs generated.");
  }

  it("encrypts a private key", async function () {
    await initialDeployments();

    // Encrypt a message using encryptPrivateKey
    const privateKey = Buffer.from("This is my private key", "utf-8");

    let [ciphertext, nonce, mySharedPubKey] =
      await MinimalUpgradableWalletReceiver.encryptPrivateKey(privateKey, receiverSk);
  });

  it("sends a private key in encrypted form to a receiver which decrypts it", async function () {
    await initialDeployments();

    // Encrypt & decrypt a message
    const privateKey = Buffer.from("This is my private key", "utf-8");
    let [ciphertext, nonce, mySharedPubKey] =
      await MinimalUpgradableWalletReceiver.encryptPrivateKey(privateKey, receiverPk);
    let decryptedKey = await MinimalUpgradableWalletReceiver.decryptKeyFromRequest(
      ciphertext,
      nonce,
      mySharedPubKey,
      receiverSk,
    );
    expect(decryptedKey).to.be.a("string");

    // Compare decrypted text to the original private key
    expect(ethers.toUtf8String(decryptedKey)).to.equal(privateKey.toString("utf-8"));
  });
});

describe("MinimalUpgradableWallet", function () {
  let MinimalUpgradableWallet: any;
  let MinimalUpgradableWalletReceiver: any;
  let receiverSk: string, receiverPk: string;
  let owner: Signer;

  async function initialDeployments() {
    // Deploy contracts before each test
    [owner] = await ethers.getSigners();
    MinimalUpgradableWalletReceiver = await getMinimalUpgradableWalletReceiver();

    // Generate key pairs for the receiver
    ({ pk: receiverPk, sk: receiverSk } = await MinimalUpgradableWalletReceiver.generateKeyPair());

    // Deploy the wallet
    const walletFactory = await ethers.getContractFactory("MinimalUpgradableWallet");
    MinimalUpgradableWallet = await walletFactory.deploy(3);
  }

  it("sends the private key in encrypted form to a receiver which decrypts it", async function () {
    await initialDeployments();
    // Encrypt & decrypt a message
    await MinimalUpgradableWallet.requestEncryption(receiverPk);
    // Wait 3 blocks
    const initialBlockNumber = await ethers.provider.getBlockNumber();
    for (let i = 0; i < 3; i++) {
      await owner.sendTransaction({});
    }
    const finalBlockNumber = await ethers.provider.getBlockNumber();
    expect(finalBlockNumber - initialBlockNumber).to.be.at.least(3);

    let [ciphertext, nonce, mySharedPubKey] = await MinimalUpgradableWallet.encryptKeyForRequest(0);
    let decryptedKey = await MinimalUpgradableWalletReceiver.decryptKeyFromRequest(
      ciphertext,
      nonce,
      mySharedPubKey,
      receiverSk,
    );
    console.log("Decrypted key:", decryptedKey);

    // Get wallet public address
    const walletAddress = await MinimalUpgradableWallet.ethAddress();
    console.log("Public address of encumbered account:", walletAddress);

    const recoveredWallet = new ethers.Wallet(decryptedKey);
    expect(recoveredWallet.address).to.equal(walletAddress);
  });
});
