import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { TypedDataEncoder } from "ethers";
import { getDomainParams } from "../scripts/eip712-builder";

describe("EIP-712 Utils", () => {
  async function deployEIP712Parameters() {
    // Contracts are deployed using the first signer/account by default
    const [firstSigner] = await ethers.getSigners();
    const owner = sapphire.wrap(firstSigner);

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const EIP712UtilsTest = await ethers.getContractFactory("EIP712UtilsTest", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const utils = await EIP712UtilsTest.deploy();
    return { owner, utils };
  }

  const testDomain = {
    name: "testdomain",
    version: "0.1.0",
    chainId: 1,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };

  const EtherMailType = {
    types: {
      Person: [
        { name: "name", type: "string" },
        { name: "wallet", type: "address" },
      ],
      Mail: [
        { name: "from", type: "Person" },
        { name: "to", type: "Person" },
        { name: "contents", type: "string" },
      ],
    },
    domain: {
      name: "Ether Mail",
      version: "1",
      chainId: 1,
      verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
  };

  describe("EIP712", () => {
    it("Should calculate the correct domain params mask", () => {
      expect(getDomainParams(testDomain).usedParamsMask).to.equal(0b1111);
    });
    it("Should calculate the correct domain hash", async () => {
      const { owner, utils } = await deployEIP712Parameters();
      const hashedDomain = ethers.TypedDataEncoder.hashDomain(testDomain);
      await expect(utils.buildDomainSeparator(getDomainParams(testDomain))).to.eventually.equal(
        hashedDomain,
      );
    });
    it("Should calculate the correct domain hash with fewer params", async () => {
      const { owner, utils } = await deployEIP712Parameters();
      const smallerDomain = { name: "testdomainSmall", version: "0.0.1" };
      const hashedDomain = ethers.TypedDataEncoder.hashDomain(smallerDomain);
      await expect(utils.buildDomainSeparator(getDomainParams(smallerDomain))).to.eventually.equal(
        hashedDomain,
      );
    });
    it("Should calculate the correct struct and type hash", async () => {
      const { owner, utils } = await deployEIP712Parameters();
      const typeString =
        "Mail(Person from,Person to,string contents)Person(string name,address wallet)";
      const personTypehash = ethers.keccak256(
        ethers.toUtf8Bytes("Person(string name,address wallet)"),
      );
      const encodedData = ethers.concat([
        ethers.keccak256(
          ethers.concat([
            personTypehash,
            ethers.keccak256(ethers.toUtf8Bytes("Cow")),
            "0x000000000000000000000000CD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
          ]),
        ),
        ethers.keccak256(
          ethers.concat([
            personTypehash,
            ethers.keccak256(ethers.toUtf8Bytes("Bob")),
            "0x000000000000000000000000bBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
          ]),
        ),
        ethers.keccak256(ethers.toUtf8Bytes("Hello, Bob!")),
      ]);

      const structHash = await utils.hashStruct(typeString, encodedData);
      expect(structHash).to.equal(
        "0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e",
      );

      const typedDataHash = await utils.getTypedDataHash(
        getDomainParams(EtherMailType.domain),
        typeString,
        encodedData,
      );
      expect(
        ethers.recoverAddress(typedDataHash, {
          r: "0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d",
          s: "0x07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b91562",
          v: 28,
        }),
      ).to.equal("0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826");

      const ethersTypedDataHash = ethers.TypedDataEncoder.hash(
        EtherMailType.domain,
        EtherMailType.types,
        {
          from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
          to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
          contents: "Hello, Bob!",
        },
      );
      expect(typedDataHash).to.equal(ethersTypedDataHash);
    });
    it("Should create a correct EIP-712 type", async () => {
      const { owner, utils } = await deployEIP712Parameters();
      await expect(utils.getEIP712Type(0b00_0001)).to.eventually.equal("EIP712Domain(string name)");
      await expect(utils.getEIP712Type(0b00_0011)).to.eventually.equal(
        "EIP712Domain(string name,string version)",
      );
      await expect(utils.getEIP712Type(0b00_1111)).to.eventually.equal(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
      );
    });
  });
});
