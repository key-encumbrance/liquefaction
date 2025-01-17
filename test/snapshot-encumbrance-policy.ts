import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { createEthereumMessage, derToEthSignature } from "../scripts/ethereum-signatures";
import { getDomainParams } from "../scripts/eip712-builder";

function getCurrentTime() {
  return Math.floor(Date.now() / 1000);
}

function throwIfUndefined<T>(item: T | undefined, title: string = "item"): T {
  if (item === undefined) {
    throw new Error("Undefined " + title);
  }
  return item;
}

function getSnapshotVoteTypedData(address: string) {
  const typedData = {
    types: {
      Vote: [
        { name: "from", type: "address" },
        { name: "space", type: "string" },
        { name: "timestamp", type: "uint64" },
        { name: "proposal", type: "bytes32" },
        { name: "choice", type: "uint32" },
        { name: "reason", type: "string" },
        { name: "app", type: "string" },
        { name: "metadata", type: "string" },
      ],
    },
    domain: {
      name: "snapshot",
      version: "0.1.4",
    },
    primaryType: "Vote",
    message: {
      from: address,
      space: "bnb50000.eth",
      timestamp: "1694651892",
      proposal: "0x85cfd1e3f1fe4734f5e63b9f9578f8c5255696e0adab20b07ae48ae26d2be1fb",
      choice: "1",
      reason: "",
      app: "snapshot",
      metadata: "{}",
    },
  };
  return typedData;
}

describe("Snapshot Encumbrance Policy", () => {
  async function deployWallet() {
    // Contracts are deployed using the first signer/account by default
    const [acc1] = await ethers.getSigners();
    const owner = sapphire.wrap(acc1);

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const BasicEncumberedWallet = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });

    const EIP712UtilsTest = await ethers.getContractFactory("EIP712UtilsTest", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const eip712UtilsTest = await EIP712UtilsTest.deploy();

    const wallet = (await BasicEncumberedWallet.deploy()).connect(owner);
    const snapshotEncumbrancePolicy = await ethers.getContractFactory("SnapshotEncumbrancePolicy");
    const policy = await snapshotEncumbrancePolicy.deploy(wallet.target);
    return { owner, wallet, policy, eip712Utils, eip712UtilsTest };
  }

  async function deployAndEnter() {
    const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployWallet();
    await wallet.createWallet(0).then(async (c) => c.wait());
    const asset = await wallet.findEip712Asset(
      getDomainParams(
        getSnapshotVoteTypedData("0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC").domain,
      ),
      "",
      "0x",
    );
    const assets = [asset];
    await wallet
      .enterEncumbranceContract(0, assets, policy.target, getCurrentTime() + 60 * 60, "0x")
      .then(async (c) => c.wait());
    return { owner, wallet, policy, eip712Utils, eip712UtilsTest };
  }

  describe("Snapshot", () => {
    it("Should sign messages that are not encumbered", async () => {
      const { owner, wallet, policy } = await deployAndEnter();
      const encAddr = await wallet.getWalletAddress(0);
      const OwnerMessagePolicyFactory = await ethers.getContractFactory("ExampleEncumbrancePolicy");
      const ownerMsgPolicy = (await OwnerMessagePolicyFactory.deploy(wallet.target)).connect(owner);
      await wallet
        .enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32)],
          ownerMsgPolicy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        )
        .then(async (c) => c.wait());
      const response = await ownerMsgPolicy.signOnBehalf(
        encAddr,
        createEthereumMessage("Raw hello"),
      );
      const response2 = await ownerMsgPolicy.signOnBehalf(
        encAddr,
        createEthereumMessage("Hello world"),
      );
    });
    it("Should sign typed data that is not encumbered", async () => {
      const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployAndEnter();
      const domain = {
        name: "Ether Mail",
        version: "1",
        chainId: 1,
        verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
      };
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

      // Enter example policy to sign typed data
      const OwnerMessagePolicyFactory = await ethers.getContractFactory("ExampleEncumbrancePolicy");
      const ownerMsgPolicy = (await OwnerMessagePolicyFactory.deploy(wallet.target)).connect(owner);
      const typedDataAsset = await wallet.findEip712Asset(getDomainParams(domain), "", "0x");
      await wallet
        .enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32), typedDataAsset],
          ownerMsgPolicy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        )
        .then(async (c) => c.wait());

      const structHash = await eip712Utils.hashStruct(typeString, encodedData);
      expect(structHash).to.equal(
        "0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e",
      );
      const address = await wallet.getWalletAddress(0);
      const derSignature = await ownerMsgPolicy.signTypedData(
        address,
        getDomainParams(domain),
        typeString,
        encodedData,
      );

      console.log("Computing typed data hash...");
      console.log(["Ether Mail", "1", 1, domain.verifyingContract]);
      console.log(typeString);
      console.log(encodedData);
      const dataHash = await eip712UtilsTest.getTypedDataHash(
        getDomainParams(domain),
        typeString,
        encodedData,
      );
      console.log("Typed data hash:", dataHash);

      const ethSig = throwIfUndefined(derToEthSignature(derSignature, dataHash, address, "digest"));

      const typedData = {
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
        primaryType: "Mail",
        domain: {
          name: "Ether Mail",
          version: "1",
          chainId: 1,
          verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
        },
        message: {
          from: {
            name: "Cow",
            wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
          },
          to: {
            name: "Bob",
            wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
          },
          contents: "Hello, Bob!",
        },
      };
      console.log(
        "TypedDataEncoder: " +
          ethers.TypedDataEncoder.hash(domain, typedData.types, typedData.message),
      );

      expect(ethers.verifyTypedData(domain, typedData.types, typedData.message, ethSig)).to.equal(
        address,
      );
    });
    it("Should not sign an unknown snapshot vote type", async () => {
      const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployAndEnter();
      const address = await wallet.getWalletAddress(0);
      const typedData = {
        types: {
          Vote: [
            { name: "from", type: "address" },
            { name: "proposal", type: "bytes32" },
            { name: "vote", type: "uint256" },
          ],
        },
        primaryType: "Vote",
        domain: {
          name: "snapshot",
          version: "1",
          chainId: 1,
          verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
        },
        message: {
          from: address,
          proposal: "0x0000000000000000000000000000000000000000000000000000000000000000",
          vote: 1,
        },
      };
      const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
      const typeString = typedDataEnc.encodeType("Vote");
      console.log("Type string: " + typeString);
      const encodedData = ethers.concat([
        ethers.zeroPadValue(typedData.message.from, 32),
        ethers.zeroPadValue(typedData.message.proposal, 32),
        ethers.zeroPadValue("0x01", 32),
      ]);

      await expect(
        wallet.signTypedData(address, getDomainParams(typedData.domain), typeString, encodedData),
      ).to.be.reverted;

      // Ensure new policies can't be enrolled in the wallet, too
      const OwnerMessagePolicyFactory = await ethers.getContractFactory("ExampleEncumbrancePolicy");
      const ownerMsgPolicy = (await OwnerMessagePolicyFactory.deploy(wallet.target)).connect(owner);
      const typedDataAsset = await wallet.findEip712Asset(
        getDomainParams(typedData.domain),
        typeString,
        encodedData,
      );
      await expect(
        wallet.enterEncumbranceContract(
          0,
          [ethers.zeroPadValue("0x1945", 32), typedDataAsset],
          ownerMsgPolicy.target,
          getCurrentTime() + 60 * 60,
          "0x",
        ),
      ).to.be.reverted;
    }).timeout(10_000_000);
    it("Should not let the user re-authorize a proposal", async () => {
      const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployAndEnter();
      const address = await wallet.getWalletAddress(0);
      const proposal = "0x85cfd1e3f1fe4734f5e63b9f9578f8c5255696e0adab20b07ae48ae26d2be1fb";
      await expect(policy.selfVoteSigner(address, proposal)).to.not.be.reverted;
      await expect(
        policy.setVoteSigner(address, proposal, "0x0000000000000000000000000000000000000001"),
      ).to.be.reverted;
    });
    it("Should not allow signing an unauthorized snapshot vote", async () => {
      const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployAndEnter();
      const address = await wallet.getWalletAddress(0);
      const typedData = getSnapshotVoteTypedData(address);
      const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
      const typeString = typedDataEnc.encodeType("Vote");
      console.log("Type string: " + typeString);
      console.log("Type string keccak: " + ethers.keccak256(ethers.toUtf8Bytes(typeString)));
      const encodedData = typedDataEnc.encodeData("Vote", typedData.message);
      console.log(ethers.dataSlice(encodedData, 32));

      await expect(
        policy.signVote(
          address,
          getDomainParams(typedData.domain),
          typeString,
          ethers.dataSlice(encodedData, 32),
        ),
      ).to.be.revertedWith("Sender not authorized for this proposal");
    });
    it("Should allow signing an authorized snapshot vote", async () => {
      const { owner, wallet, policy, eip712Utils, eip712UtilsTest } = await deployAndEnter();
      const address = await wallet.getWalletAddress(0);
      const typedData = getSnapshotVoteTypedData(address);
      const proposal = typedData.message.proposal;
      const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
      const typeString = typedDataEnc.encodeType("Vote");
      console.log("Type string: " + typeString);
      console.log("Type string keccak: " + ethers.keccak256(ethers.toUtf8Bytes(typeString)));
      const encodedData = ethers.dataSlice(typedDataEnc.encodeData("Vote", typedData.message), 32);

      // Expect signing to be functional after authorizing self to vote on this proposal
      await expect(
        policy.signVote(address, getDomainParams(typedData.domain), typeString, encodedData),
      ).to.be.reverted;
      await expect(policy.selfVoteSigner(address, proposal)).to.not.be.reverted;
      const derSignature = await policy.signVote(
        address,
        getDomainParams(typedData.domain),
        typeString,
        encodedData,
      );
      const dataHash = await eip712UtilsTest.getTypedDataHash(
        getDomainParams(typedData.domain),
        typeString,
        encodedData,
      );
      const ethSig = throwIfUndefined(derToEthSignature(derSignature, dataHash, address, "digest"));
      expect(
        ethers.verifyTypedData(typedData.domain, typedData.types, typedData.message, ethSig),
      ).to.equal(address);
    });
  });
});
