import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { createEthereumMessage, derToEthSignature } from "../scripts/ethereum-signatures";
import { getDomainParams } from "../scripts/eip712-builder";

function getCurrentTime(): number {
  return Math.floor(Date.now() / 1000);
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

describe("Snapshot Dark DAO", () => {
  async function deployWallet() {
    // Contracts are deployed using the first signer/account by default
    const [acc1, acc2] = await ethers.getSigners();
    const owner = sapphire.wrap(acc1);
    const voterOasis = sapphire.wrap(acc2);

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const BasicEncumberedWallet = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });

    const wallet = await BasicEncumberedWallet.deploy();
    const snapshotEncumbrancePolicy = await ethers.getContractFactory("SnapshotEncumbrancePolicy");
    const policy = await snapshotEncumbrancePolicy.deploy(wallet.target);
    return { owner, voterOasis, wallet: wallet.connect(owner), policy, eip712Utils };
  }

  async function deployAndEnter() {
    const { owner, voterOasis, wallet, policy, eip712Utils } = await deployWallet();
    await owner
      .sendTransaction({ to: voterOasis.getAddress(), value: ethers.parseEther("10"), data: "0x" })
      .then(async (c) => c.wait());
    console.log(
      "Voter balance: " +
        ethers.formatEther(await ethers.provider.getBalance(voterOasis.getAddress())),
    );
    console.log("Creating voter wallet...");
    const voterWallet = wallet.connect(voterOasis);
    await voterWallet.createWallet(0).then(async (c) => c.wait());
    console.log("Entering encumbrance contract...");

    // Find asset
    const asset = await wallet.findEip712Asset(
      getDomainParams(
        getSnapshotVoteTypedData("0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC").domain,
      ),
      "",
      "0x",
    );
    const assets = [asset];

    await voterWallet
      .enterEncumbranceContract(0, assets, policy.target, getCurrentTime() + 60 * 60, "0x")
      .then(async (c) => c.wait());

    console.log("Creating owner wallet...");
    await wallet.createWallet(0).then(async (c) => c.wait());
    console.log("Entering encumbrance contract...");
    await wallet
      .enterEncumbranceContract(0, assets, policy.target, getCurrentTime() + 60 * 60, "0x")
      .then(async (c) => c.wait());

    // Assume the Snapshot is taken right now
    const snapshotTimestamp = getCurrentTime();

    console.log("Getting owner address...");
    const ownerAddress = await wallet.getWalletAddress(0);
    console.log("Creating Merkle tree...");
    const merkleTreeData = [
      [ownerAddress, ethers.parseEther("10"), ethers.parseEther("0.1")],
      // [voterAddress, ethers.parseEther('20'), ethers.parseEther('0.2')],
    ];
    const bribeMerkleTree = StandardMerkleTree.of(merkleTreeData, [
      "address",
      "uint256",
      "uint256",
    ]);

    // Deploy Dark DAO
    const SnapshotDarkDAO = await ethers.getContractFactory("SnapshotDarkDAO", owner);
    console.log("Deploying Dark DAO...");
    const darkDao = await SnapshotDarkDAO.deploy(
      policy.target,
      getSnapshotVoteTypedData(ownerAddress).message.proposal,
      getCurrentTime(),
      getCurrentTime() + 60 * 30,
      bribeMerkleTree.root,
      // Fund with some bribe money
      { value: ethers.parseEther("1") },
    );

    return { owner, voterOasis, wallet, policy, darkDao, bribeMerkleTree };
  }

  describe("Snapshot Dark DAO", () => {
    it("Should accept members of the Merkle Tree and sign votes on their behalf", async () => {
      const { owner, voterOasis, wallet, policy, darkDao, bribeMerkleTree } =
        await deployAndEnter();
      const ownerAddress = await wallet.getWalletAddress(0);
      // Enter the Dark DAO!
      console.log(Array.from(bribeMerkleTree.entries()));
      const ownerLeaf = Array.from(bribeMerkleTree.entries())
        .map((x) => x[1])
        .find(([address, votingPower, bribe]) => address === ownerAddress);
      if (ownerLeaf === undefined) {
        throw new Error("Owner not found in the bribe merkle tree");
      }
      const ownerProof = bribeMerkleTree.getProof(ownerLeaf);
      console.log("owner leaf", ownerLeaf);
      console.log("owner proof", ownerProof);
      // Fail if the Dark DAO is not the vote signer
      await expect(darkDao.enterDarkDAO(ownerAddress, ownerLeaf[1], ownerLeaf[2], ownerProof)).to.be
        .reverted;

      const typedData = getSnapshotVoteTypedData(ownerAddress);
      const proposal = typedData.message.proposal;
      await policy
        .setVoteSigner(ownerAddress, proposal, darkDao.target)
        .then(async (x) => x.wait());
      // Succeed now that the Dark DAO is the vote signer
      await expect(darkDao.enterDarkDAO(ownerAddress, ownerLeaf[1], ownerLeaf[2], ownerProof)).to
        .not.be.reverted;
      // Sign a voting message (since owner == briber)
      const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
      const typeString = typedDataEnc.encodeType("Vote");
      console.log("Type string: " + typeString);
      console.log("Type string keccak: " + ethers.keccak256(ethers.toUtf8Bytes(typeString)));
      const encodedData = ethers.dataSlice(typedDataEnc.encodeData("Vote", typedData.message), 32);
      const derSignature = await darkDao.signVote(
        ownerAddress,
        getDomainParams(typedData.domain),
        typeString,
        encodedData,
      );
      const dataHash = ethers.TypedDataEncoder.hash(
        typedData.domain,
        typedData.types,
        typedData.message,
      );
      const ethSig = derToEthSignature(derSignature, dataHash, ownerAddress, "digest");
      if (ethSig === undefined) {
        throw new Error("Failed to verify encumbered vote signature");
      }
      console.log(ethSig);
      expect(
        ethers.verifyTypedData(typedData.domain, typedData.types, typedData.message, ethSig),
      ).to.equal(ownerAddress);
    });

    it("Should pay a bribe to a registered account", async () => {
      const { owner, voterOasis, wallet, policy, darkDao, bribeMerkleTree } =
        await deployAndEnter();
      const ownerAddress = await wallet.getWalletAddress(0);
      // Fail to pay bribe before registering
      await expect(darkDao.claimBribe(ownerAddress)).to.be.reverted;
      const ownerLeaf = Array.from(bribeMerkleTree.entries())
        .map((x) => x[1])
        .find(([address, votingPower, bribe]) => address === ownerAddress);
      if (ownerLeaf === undefined) {
        throw new Error("Owner not found in the bribe merkle tree");
      }
      const ownerProof = bribeMerkleTree.getProof(ownerLeaf);
      await policy
        .setVoteSigner(
          ownerAddress,
          getSnapshotVoteTypedData(ownerAddress).message.proposal,
          darkDao.target,
        )
        .then(async (x) => x.wait());

      const enterDarkDaoTx = await darkDao
        .enterDarkDAO(ownerAddress, ownerLeaf[1], ownerLeaf[2], ownerProof)
        .then(async (tx) => tx.wait());
      if (enterDarkDaoTx === null) {
        throw new Error("enterDarkDAO transaction receipt is null");
      }
      expect(enterDarkDaoTx.status).to.equal(1);
      console.log("enterDarkDAO gas cost:", enterDarkDaoTx.cumulativeGasUsed.toString());

      const previousBalance = await ethers.provider.getBalance(owner.address);
      const claimBribeTx = await darkDao.claimBribe(ownerAddress).then(async (tx) => tx.wait());
      if (claimBribeTx === null) {
        throw new Error("claimBribeTx transaction receipt is null");
      }
      expect(claimBribeTx.status).to.equal(1);
      console.log("claimBribe gas cost:", claimBribeTx.cumulativeGasUsed.toString());
      const afterBalance = await ethers.provider.getBalance(owner.address);
      // Check for payment, allowing for transaction costs
      expect(afterBalance - previousBalance > BigInt(ownerLeaf[2]) - ethers.parseEther("0.03")).to
        .be.true;

      // Fail to pay bribe more than once
      await expect(darkDao.claimBribe(ownerAddress)).to.be.reverted;

      // Withdraw excess funds back to briber
      const previousBriberBalance = await ethers.provider.getBalance(owner.address);
      await darkDao.withdrawUnusedFunds();
      const afterBriberBalance = await ethers.provider.getBalance(owner.address);
      expect(afterBriberBalance > previousBriberBalance).to.be.true;
      expect(await ethers.provider.getBalance(darkDao.target)).to.equal(0n);
    });
  });
});
