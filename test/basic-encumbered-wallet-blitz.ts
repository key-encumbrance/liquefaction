import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { createEthereumMessage, derToEthSignature } from "../scripts/ethereum-signatures";

describe("Enrollment Blitz", () => {
  async function deployContracts() {
    const [owner] = await ethers.getSigners();

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const BasicEncumberedWallet = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const wallet = await BasicEncumberedWallet.deploy();
    const EncumbrancePolicyTest = await ethers.getContractFactory("EnrollmentBlitzTest");
    const policyTest = await EncumbrancePolicyTest.deploy();
    return { owner, wallet, policyTest: policyTest.connect(owner) };
  }

  it("Should not allow signing messages in the same block as the policy was enrolled", async () => {
    const { owner, wallet, policyTest } = await deployContracts();
    const walletIndex = 0;
    const asset = ethers.zeroPadValue("0x1945", 32);
    const message = createEthereumMessage("Hello world");

    await expect(
      policyTest.testEncumbrance.staticCall(wallet.target, walletIndex, asset, message),
    ).to.be.revertedWith("Not encumbered by sender");
  });
});
