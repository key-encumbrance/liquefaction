import { expect } from "chai";
import { ethers } from "hardhat";
import { derToEthSignature } from "../scripts/ethereum-signatures";

describe("DER signatures", () => {
  it("Should validate shortened signatures", () => {
    const ethSignature = derToEthSignature(
      "0x3043021f2aa4cfab627250f7f35ed92015658a7ff3d87a809ecdc8a8e8e3e1ee1ff4de02202f227939b52f2ae001d87b35111cc199307f728e62e1c839015e2e4558f8b4ee",
      "0x02eb8275a9808502540be4008502540be4008252089400000000000000000000000000000000000000008080c0",
      "0x9aE081a6da25C276bAa5FC1e5614D3A9174C7b0b",
      "bytes",
    );
    expect(ethSignature).to.not.be.undefined;
  });
});
