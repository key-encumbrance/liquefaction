import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { createEthereumMessage, derToEthSignature } from "../scripts/ethereum-signatures";
import { getDomainParams } from "../scripts/eip712-builder";

function getCurrentTime() {
  return Math.floor(Date.now() / 1000);
}

describe("BasicEncumberedWallet", () => {
  async function deployWallet() {
    // Contracts are deployed using the first signer/account by default
    const [firstSigner] = await ethers.getSigners();
    const secondSigner = sapphire.wrap(ethers.Wallet.createRandom().connect(ethers.provider));
    const owner = sapphire.wrap(firstSigner);

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const BasicEncumberedWallet = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const wallet = await BasicEncumberedWallet.deploy();

    return { owner, secondSigner, wallet: wallet.connect(owner) };
  }

  async function deployPolicy() {
    const walletArgs = await deployWallet();
    const { wallet } = walletArgs;
    const ExampleEncumbrancePolicy = await ethers.getContractFactory("ExampleEncumbrancePolicy");
    const policy = await ExampleEncumbrancePolicy.deploy(wallet.target);
    return { ...walletArgs, policy };
  }

  async function deployTypedDataPolicy() {
    const walletArgs = await deployWallet();
    const typedDataPolicy = await ethers.getContractFactory("TrivialTypedDataPolicy");
    const policy = await typedDataPolicy.deploy(walletArgs.wallet.target);
    return { ...walletArgs, policy };
  }

  describe("Wallet", () => {
    it("Should create a new wallet", async () => {
      const { owner, wallet } = await deployWallet();
      await wallet.createWallet(0).then(async (w) => w.wait());
      console.log(await wallet.getPublicKey(0));
    });
    it("Should not overwrite an existing wallet", async () => {
      const { owner, wallet } = await deployWallet();
      const createWalletTx = await wallet.createWallet(0);
      const createWalletReceipt = await createWalletTx.wait();
      if (createWalletReceipt === null) {
        throw new Error("createWalletReceipt is null");
      }
      console.log("Gas cost of creating an encumbered account: " + createWalletReceipt?.gasUsed);
      const gasUsed1 = createWalletReceipt.gasUsed;
      expect(gasUsed1 > 100_000n).to.be.true;

      const publicKey = await wallet.getPublicKey(0);
      expect(publicKey).to.not.equal("0x");

      // Should not make a new wallet at the same index
      await wallet.createWallet(0).then((t) => t.wait());

      const publicKey2 = await wallet.getPublicKey(0);
      expect(publicKey).to.equal(publicKey2);
    });
    it("Should not sign messages that are encumbered", async () => {
      const { owner, wallet } = await deployWallet();
      await wallet.createWallet(0).then(async (c) => c.wait());
      await expect(
        wallet.signMessageSelf(0, createEthereumMessage("Hello world")),
      ).to.be.revertedWith("Not encumbered by sender");
    });
    it("Should send asset list to policies upon enrollment for approval", async () => {
      const { owner, wallet, policy } = await deployPolicy();
      await wallet.createWallet(0).then(async (c) => c.wait());

      // Example policy reverts if no assets are set
      await expect(
        wallet.enterEncumbranceContract(0, [], policy.target, getCurrentTime() + 60 * 60, "0x"),
      ).to.be.reverted;

      // Example policy reverts if the correct asset isn't set
      await expect(
        wallet.enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1946", 32)],
          policy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        ),
      ).to.be.reverted;

      // Policies usually should allow extra access
      await expect(
        wallet.enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32), ethers.zeroPadValue("0x1946", 32)],
          policy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        ),
      ).to.not.be.reverted;
    });
    it("Should enroll in an encumbrance contract, with working encumbrance", async () => {
      const { owner, wallet, policy } = await deployPolicy();
      await wallet.createWallet(0).then(async (c) => c.wait());
      const tx1 = await wallet
        .enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32)],
          policy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        )
        .then(async (r) => r.wait());

      // Encumbered messages can't be signed by the owner
      await expect(
        wallet.signMessageSelf(0, createEthereumMessage("Hello world")),
      ).to.be.revertedWith("Not encumbered by sender");

      // Allowed message type succeeds
      const encMessage = createEthereumMessage("Encumbered message");
      const addr = await wallet.getWalletAddress(0);
      const derSig = await policy.connect(owner).signOnBehalf(addr, encMessage);
      // Check signature
      const ethSig = derToEthSignature(derSig, encMessage, addr, "bytes");
      expect(ethSig).to.not.be.undefined;
    });
    it("Should encumber EIP-712 typed messages", async () => {
      const { owner, wallet, policy } = await deployTypedDataPolicy();
      await wallet.createWallet(0).then(async (c) => c.wait());
      const walletAddr = await wallet.getWalletAddress(0);

      const typedData = {
        types: {
          Mail: [
            { name: "to", type: "address" },
            { name: "message", type: "string" },
          ],
        },
        domain: {
          name: "mail",
          version: "1.0.0",
        },
        primaryType: "Mail",
        message: {
          to: await wallet.getWalletAddress(0),
          message: "Hello world",
        },
      };

      const domain = getDomainParams(typedData.domain);
      const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
      const typeString = typedDataEnc.encodeType("Mail");
      const encodedData = ethers.dataSlice(typedDataEnc.encodeData("Mail", typedData.message), 32);
      const asset = await wallet.findEip712Asset(domain, typeString, encodedData);

      const tx1 = await wallet
        .enterEncumbranceContract(
          0,
          [asset],
          policy.target,
          getCurrentTime() + 60 * 60,
          ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address]),
        )
        .then(async (r) => r.wait());

      // Encumbered messages can't be signed by the owner
      await expect(
        wallet.signTypedData(walletAddr, domain, typeString, encodedData),
      ).to.be.revertedWith("Not encumbered by sender");

      // Unauthorized message type fails
      await expect(
        policy
          .connect(owner)
          .signOnBehalf(walletAddr, getDomainParams({ name: "phony!" }), typeString, encodedData),
      ).to.be.revertedWith("Not encumbered by sender");

      // Allowed message type succeeds
      const derSig = await policy
        .connect(owner)
        .signOnBehalf(walletAddr, domain, typeString, encodedData);
      // Check signature
      const typeHash = ethers.TypedDataEncoder.hash(
        typedData.domain,
        typedData.types,
        typedData.message,
      );
      const ethSig = derToEthSignature(derSig, typeHash, walletAddr, "digest");
      expect(ethSig).to.not.be.undefined;
    });

    it("Should transfer an account to another party", async () => {
      const { owner, wallet, policy, secondSigner } = await deployPolicy();
      await wallet.createWallet(0).then(async (c) => c.wait());
      const tx1 = await wallet
        .enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32)],
          policy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        )
        .then(async (r) => r.wait());

      // Encumbered messages can't be signed by the owner
      await expect(
        wallet.signMessageSelf(0, createEthereumMessage("Hello world")),
      ).to.be.revertedWith("Not encumbered by sender");

      const encWalletAddress = await wallet.getWalletAddress(0);
      await wallet.transferAccountOwnership(0, secondSigner.address).then(async (r) => r.wait());

      await expect(wallet.getWalletAddress(0)).to.be.revertedWith("Wallet does not exist");

      const newAttendedWallet = await wallet.connect(secondSigner).getAttendedWallet(0);
      await expect(
        wallet.connect(secondSigner).getWalletAddress(newAttendedWallet.index),
      ).to.eventually.equal(encWalletAddress);

      // Allowed message type succeeds under original owner
      const encMessage = createEthereumMessage("Encumbered message");
      const derSig = await policy.connect(owner).signOnBehalf(encWalletAddress, encMessage);
      // Check signature
      const ethSig = derToEthSignature(derSig, encMessage, encWalletAddress, "bytes");
      expect(ethSig).to.not.be.undefined;
    });
  });
});
