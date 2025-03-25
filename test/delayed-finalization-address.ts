import { expect } from "chai";
import { ethers } from "hardhat";
import { type Signer } from "ethers";

import { DelayedFinalizationAddressTest } from "../typechain-types/contracts/DelayedFinalizationAddressTest";

describe("DelayedFinalizationAddressTest", function () {
  let delayedFinalizationAddressTest: DelayedFinalizationAddressTest;
  let owner: Signer;
  let newAddress: string;
  const key = ethers.keccak256(ethers.toUtf8Bytes("testAdmin"));

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    newAddress = (await ethers.getSigners())[1].address;
    const DelayedFinalizationAddressTest = await ethers.getContractFactory(
      "DelayedFinalizationAddressTest",
    );
    delayedFinalizationAddressTest = await DelayedFinalizationAddressTest.deploy();
    await delayedFinalizationAddressTest.waitForDeployment();
  });

  it("Should fail when attempting to update and get finalized address in the same transaction", async function () {
    await expect(delayedFinalizationAddressTest.updateAndGetImmediately(key, newAddress)).to.be
      .reverted;
  });

  it("Should succeed in updating address, then get finalized after a block delay", async function () {
    // Update address
    const updateTx = await delayedFinalizationAddressTest.updateTestAddress(key, newAddress);
    await updateTx.wait();

    // Get finalized address after block delay
    const finalizedAddress = await delayedFinalizationAddressTest.getFinalizedTestAddress(key);
    expect(finalizedAddress).to.equal(newAddress);

    // Check if address is finalized
    const isFinalized = await delayedFinalizationAddressTest.isFinalizedTestAddress(
      key,
      newAddress,
    );
    expect(isFinalized).to.be.true;
  });
});
