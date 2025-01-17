import { expect } from "chai";
import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import {
  type TransactionResponse,
  type TransactionReceipt,
  type BaseContract,
  type Signer,
  type BytesLike,
  type Contract,
} from "ethers";
import { derToEthSignature } from "../scripts/ethereum-signatures";
import { type PopulatedTypedData, getTypedDataParams } from "../scripts/eip712-builder";
import {
  getMappingStorageSlot,
  getRpcUint,
  getRlpUint,
  getTxInclusionProof,
} from "../scripts/inclusion-proofs";
import { TokenizedDarkDAO } from "../scripts/tokenized-dark-dao";

const oasisTestChainId = 0x5a_fd;
// Use a different network that supports a state proof for testing the public network
// Example: geth
const ethTestChainId = 30_121;

// The "public" network, i.e. Ethereum network
const publicProvider = new ethers.JsonRpcProvider("http://localhost:32002");
// The storage slot of the balances mapping in our TestERC20 token is 0
const daoTokenBalanceMappingSlot = "0x00";
// The withdrawals slot in the DD token contract is 11 on the current version of Solidity and OpenZeppelin
const ddTokenWithdrawalsSlot = ethers.toBeHex(11);

// If true, prints the gas usage of operations and Dark DAO contract bytecode size
const verboseContractExecution = true;

function showTransactionResult(title: string, transactionReceipt: TransactionReceipt | null) {
  if (verboseContractExecution && transactionReceipt) {
    console.log(title, "gas usage:", transactionReceipt.gasUsed.toString());
  }
}

function getSnapshotVoteTypedData(address: string, proposal: string): PopulatedTypedData {
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
      proposal,
      choice: "1",
      reason: "",
      app: "snapshot",
      metadata: "{}",
    },
  };
  return typedData;
}

describe("Dark DAO Token", () => {
  async function getAccounts() {
    // Contracts are deployed using the first signer/account by default
    const [owner] = await ethers.getSigners();
    const ownerPublic = new ethers.Wallet(
      "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
    ).connect(publicProvider);
    return { owner, ownerPublic };
  }

  async function deployToken() {
    const { owner, ownerPublic } = await getAccounts();

    // On Ethereum
    const daoTokenFactory = await ethers.getContractFactory("TestERC20Token", ownerPublic);
    const daoToken = await daoTokenFactory.deploy();
    await daoToken.waitForDeployment();

    // On Oasis
    const eip712UtilsFactory = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await eip712UtilsFactory.deploy();
    await eip712Utils.waitForDeployment();

    const liquefactionWalletFactory = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const liquefactionWallet = await liquefactionWalletFactory.deploy();
    const blockHashOracleFactory = await ethers.getContractFactory("TrivialBlockHashOracle");
    const blockHashOracle = await blockHashOracleFactory.deploy();
    const stateVerifierFactory = await ethers.getContractFactory("ProvethVerifier");
    const stateVerifier = await stateVerifierFactory.deploy();
    const transactionSerializerFactory = await ethers.getContractFactory("TransactionSerializer");
    const transactionSerializer = await transactionSerializerFactory.deploy();

    await liquefactionWallet.waitForDeployment();
    await blockHashOracle.waitForDeployment();
    await stateVerifier.waitForDeployment();
    await transactionSerializer.waitForDeployment();

    // On Oasis
    // Calculate the address of the DD token
    const nvDaoTokenPredictedAddress = ethers.getCreateAddress({
      from: ownerPublic.address,
      nonce: await publicProvider.getTransactionCount(ownerPublic.address),
    });
    const darkDaoFactory = await ethers.getContractFactory("VoteSellingDarkDAO", {
      libraries: {
        TransactionSerializer: transactionSerializer.target,
      },
    });

    // 1 ROSE
    const minimumBid = 10n ** 18n * 1n;

    // An auction for a proposal must begin earlier than this amount of time before the proposal ends
    // for the votes to be usable.
    // During testing, we use a very short time of 1 minute.
    const auctionDuration = 60;

    // Lockup period before DD token minting is allowed
    const depositLockupDuration = 0;

    const dd = await darkDaoFactory.deploy(
      {
        wallet: liquefactionWallet.target,
        ethBlockHashOracle: blockHashOracle.target,
        stateVerifier: stateVerifier.target,
        ethChainId: ethTestChainId,
        ethDdToken: nvDaoTokenPredictedAddress,
        ethDaoToken: daoToken.target,
        daoTokenBalanceSlot: daoTokenBalanceMappingSlot,
        ddTokenWithdrawalsSlot: ddTokenWithdrawalsSlot,
      },
      10n ** 18n * 8n,
      minimumBid,
      auctionDuration,
      depositLockupDuration,
    );
    await dd.waitForDeployment();
    console.log("Dark DAO contract bytecode size:", ethers.dataLength(darkDaoFactory.bytecode));

    // On Ethereum
    const nvDaoTokenFactory = await ethers.getContractFactory("DarkDAOToken", ownerPublic);
    const nvDaoToken = await nvDaoTokenFactory.deploy(
      daoToken.target,
      await dd.darkDaoSignerAddress(),
    );
    await nvDaoToken.waitForDeployment();
    expect(nvDaoToken.target).to.equal(nvDaoTokenPredictedAddress);

    const deployments: [string, BaseContract][] = [
      ["State verifier", stateVerifier],
      ["Transaction serializer", transactionSerializer],
      ["EIP-712 Utils", eip712Utils],
      ["Dark DAO contract", dd],
      ["DD Token", nvDaoToken],
    ];
    await Promise.all(
      deployments.map(async (x: [string, BaseContract]) => {
        const [name, c] = x;
        const deploymentTransaction = c.deploymentTransaction();
        if (deploymentTransaction === null) {
          return null;
        }

        const txReceipt = await deploymentTransaction.wait();
        showTransactionResult(name + " deployment", txReceipt);
      }),
    );

    return {
      owner,
      ownerPublic,
      blockHashOracle,
      dd,
      daoToken,
      nvDaoToken,
      transactionSerializer,
      liquefactionWallet,
    };
  }

  async function depositTokens(
    {
      dd,
      owner,
      ownerPublic,
      blockHashOracle,
      daoToken,
      nvDaoToken,
    }: {
      dd: Awaited<ReturnType<typeof deployToken>>["dd"];
      owner: Signer;
      ownerPublic: Signer;
      blockHashOracle: Awaited<ReturnType<typeof deployToken>>["blockHashOracle"];
      daoToken: Awaited<ReturnType<typeof deployToken>>["daoToken"];
      nvDaoToken: Awaited<ReturnType<typeof deployToken>>["nvDaoToken"];
    },
    depositAmount: bigint,
  ) {
    const ddTokenRecipient = await ownerPublic.getAddress();

    const tdd = await TokenizedDarkDAO.create(
      dd.connect(sapphire.wrap(owner)) as unknown as Contract,
      nvDaoToken.connect(ownerPublic) as unknown as Contract,
      daoTokenBalanceMappingSlot,
      ddTokenWithdrawalsSlot,
    );
    const depositData = await tdd.generateDepositAddress(ddTokenRecipient);
    console.log("Deposit address:", depositData.depositAddress);

    showTransactionResult(
      "Transfer DD tokens to deposit address",
      await daoToken
        .connect(ownerPublic)
        .transfer(depositData.depositAddress, depositAmount)
        .then(async (t: TransactionResponse) => t.wait()),
    );
    const proofBlock = await publicProvider.getBlock("latest");
    if (proofBlock === null) {
      throw new Error("Could not get latest block from public provider");
    }
    const proofBlockHash = proofBlock.hash;
    if (proofBlockHash === null) {
      throw new Error("Proof block hash is null");
    }
    await blockHashOracle.setBlockHash(proofBlock.number, proofBlockHash);
    const storageProof = await tdd.getDepositProof(depositData, proofBlock.number, depositAmount);
    expect(ethers.keccak256(storageProof.rlpBlockHeader)).to.equal(proofBlock.hash);

    showTransactionResult(
      "Register deposit",
      await tdd
        .registerDeposit(depositData.wrappedAddressInfo, proofBlock.number, storageProof)
        .then((tx) => tx.wait()),
    );
    showTransactionResult("Mint DD tokens", await tdd.mintDDTokens(0).then((tx) => tx.wait()));
    const nvDaoTokenBal = await nvDaoToken.balanceOf(ddTokenRecipient);
    expect(nvDaoTokenBal).to.equal(depositAmount);
    return { depositAddress: depositData.depositAddress, ddTokenRecipient };
  }

  async function beginWithdrawal(
    dd: Awaited<ReturnType<typeof deployToken>>["dd"],
    ddTokenHolder: Signer,
    nvDaoToken: Awaited<ReturnType<typeof deployToken>>["nvDaoToken"],
    withdrawalAmount: bigint,
  ) {
    const tdd = await TokenizedDarkDAO.create(
      dd as unknown as Contract,
      nvDaoToken.connect(ddTokenHolder) as unknown as Contract,
      daoTokenBalanceMappingSlot,
      ddTokenWithdrawalsSlot,
    );
    const result = await tdd.beginWithdrawal(withdrawalAmount);
    showTransactionResult("Begin withdrawal to DD contract", await result.tx.wait());
    return result;
  }

  async function registerWithdrawal(
    ddTokenHolder: Signer,
    withdrawalAmount: bigint,
    nonceHash: string,
    witness: BytesLike,
    nvDaoToken: Awaited<ReturnType<typeof deployToken>>["nvDaoToken"],
    dd: Awaited<ReturnType<typeof deployToken>>["dd"],
    withdrawalRecipient: string,
    bribesRecipient: string,
    blockHashOracle: any,
  ) {
    const proofBlock = await publicProvider.getBlock("latest");
    if (proofBlock === null) {
      throw new Error("Could not get latest block from public provider");
    }
    await blockHashOracle.setBlockHash(proofBlock.number, proofBlock.hash);
    const tdd = await TokenizedDarkDAO.create(
      dd as unknown as Contract,
      nvDaoToken as unknown as Contract,
      daoTokenBalanceMappingSlot,
      ddTokenWithdrawalsSlot,
    );
    showTransactionResult(
      "Register withdrawal",
      await tdd
        .registerWithdrawal(
          await ddTokenHolder.getAddress(),
          withdrawalAmount,
          nonceHash,
          witness,
          withdrawalRecipient,
          bribesRecipient,
          proofBlock.number,
        )
        .then(async (tx) => tx.wait()),
    );
  }

  describe("Token deployment", () => {
    it("Should deploy a nonvoting token", async () => {
      await deployToken();
    });
  });

  describe("Deposits", () => {
    it("Should generate a deposit address", async () => {
      const { dd, owner } = await deployToken();
      await dd.generateDepositAddress(owner.address).then((t) => t.wait());
      const [depositAddress, wrappedAddressInfo] = await dd
        .connect(sapphire.wrap(owner))
        .getWrappedAddressInfo(0);
      console.log("Deposit address: " + depositAddress);
    });
    it("Should calculate storage slots correctly", () => {
      expect(getMappingStorageSlot("0x60C2780B7412b9b28b724FBcD76a7e723468B664", "0x02")).to.equal(
        "0x1b78f95ce9c545113830f6f7eec96f49712a408da3b4b03d72d06260f909dc15",
      );
    });
    it("Should accept a valid deposit", async () => {
      const { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic } = await deployToken();
      const depositAmount = 10n ** 18n * 100n;
      await depositTokens(
        { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic },
        depositAmount,
      );
    });
  });

  describe("Voting", () => {
    it("Should allow incremental bids", async () => {
      const { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic } = await deployToken();
      const depositAmount = 10n ** 18n * 100n;
      const { depositAddress } = await depositTokens(
        { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic },
        depositAmount,
      );

      const proposalHash = "0x0df596950bfc99035520c0de4d1aae5c1bb0bc626605e5d0b744ff1d90e3a981";
      showTransactionResult(
        "Create auction",
        await dd
          .createAuction(proposalHash, { value: ethers.parseEther("1") })
          .then(async (tx) => tx.wait()),
      );
      showTransactionResult(
        "Bid on auction",
        await dd
          .bid(proposalHash, ethers.parseEther("1.1"), { value: ethers.parseEther("0.1") })
          .then(async (tx) => tx.wait()),
      );
      await expect(dd.getMaxBid(proposalHash)).to.eventually.equal(ethers.parseEther("1.1"));
    });
    it("Should allow auction winner to sign votes", async () => {
      const { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic } = await deployToken();
      const depositAmount = 10n ** 18n * 100n;
      const { depositAddress } = await depositTokens(
        { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic },
        depositAmount,
      );

      const proposalHash = "0x0df596950bfc99035520c0de4d1aae5c1bb0bc626605e5d0b744ff1d90e3a981";
      await dd
        .createAuction(proposalHash, { value: ethers.parseEther("1") })
        .then(async (tx) => tx.wait());
      await new Promise<void>((resolve) => setTimeout(resolve, 60 * 1000));
      // Trigger new block to be created on the dev network
      await owner.sendTransaction({ to: owner.address, data: "0x" });

      // Sign vote
      const proposalData = getSnapshotVoteTypedData(depositAddress, proposalHash);
      const proposalParameters = getTypedDataParams(proposalData);
      const derSignature = await dd
        .connect(sapphire.wrap(owner))
        .signVote(
          depositAddress,
          proposalParameters.domainParams,
          proposalParameters.typeString,
          proposalParameters.encodedData,
        );
      const dataHash = ethers.TypedDataEncoder.hash(
        proposalData.domain,
        proposalData.types,
        proposalData.message,
      );
      const ethSig = derToEthSignature(derSignature, dataHash, depositAddress, "digest");
      if (ethSig === undefined) {
        throw new Error("Could not verify ETH signature from encumbered account");
      }
      expect(
        ethers.verifyTypedData(
          proposalData.domain,
          proposalData.types,
          proposalData.message,
          ethSig,
        ),
      ).to.equal(depositAddress);
    });
  });

  describe("Withdrawals", () => {
    it("Should allow a withdrawal to be registered and processed", async () => {
      const { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic } = await deployToken();
      const depositAmount = 10n ** 18n * 100n;
      const { ddTokenRecipient, depositAddress } = await depositTokens(
        { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic },
        depositAmount,
      );

      const withdrawalAmount = depositAmount / 2n;
      const { witness, nonceHash } = await beginWithdrawal(
        dd,
        ownerPublic,
        nvDaoToken,
        withdrawalAmount,
      );
      // Lol account (Ethereum account receiving the DAO tokens)
      const withdrawalRecipient = "0xc42A84D4f2f511f90563dc984311Ab737ee56eFD";
      // Lol2 (Oasis account receiving the portion of the accumulated bribes + equalizing deposits)
      const bribesRecipient = "0x15B5F4c6F916d7E1B742deb0b06fd25a0490ef55";
      await registerWithdrawal(
        ownerPublic,
        withdrawalAmount,
        nonceHash,
        witness,
        nvDaoToken,
        dd,
        withdrawalRecipient,
        bribesRecipient,
        blockHashOracle,
      );

      // Get withdrawal tx
      const withdrawalAddress = depositAddress;
      const tdd = await TokenizedDarkDAO.create(
        dd as unknown as Contract,
        nvDaoToken as unknown as Contract,
        daoTokenBalanceMappingSlot,
        ddTokenWithdrawalsSlot,
      );
      const signedWithdrawalTxRaw = await tdd.getWithdrawalTransaction(withdrawalRecipient);

      // Fund the account
      // TODO: Ensure these transactions can still be included despite max gas price not being fulfilled
      await ownerPublic
        .sendTransaction({ to: withdrawalAddress, value: ethers.parseEther("0.1") })
        .then(async (tx) => tx.wait());
      await publicProvider
        .broadcastTransaction(signedWithdrawalTxRaw)
        .then(async (tx) => tx.wait());

      const withdrawnBalance = await daoToken.balanceOf(withdrawalRecipient);
      expect(withdrawnBalance).to.equal(withdrawalAmount);
    });

    it("Should generate a transaction inclusion proof", async () => {
      const { ownerPublic } = await getAccounts();
      const txReceipt = await ownerPublic
        .sendTransaction({ to: ownerPublic.address })
        .then(async (tx) => tx.wait());
      if (txReceipt === null) {
        throw new Error("Inclusion proof transaction receipt is null");
      }
      console.log(
        await getTxInclusionProof(publicProvider, txReceipt.blockNumber, txReceipt.index),
      );
    });

    it("Should accept withdrawal inclusion proofs", async () => {
      const {
        dd,
        owner,
        blockHashOracle,
        daoToken,
        nvDaoToken,
        ownerPublic,
        transactionSerializer,
      } = await deployToken();
      const depositAmount = 10n ** 18n * 100n;
      const { ddTokenRecipient, depositAddress } = await depositTokens(
        { dd, owner, blockHashOracle, daoToken, nvDaoToken, ownerPublic },
        depositAmount,
      );

      const withdrawalAmount = depositAmount / 2n;
      const { witness, nonceHash } = await beginWithdrawal(
        dd,
        ownerPublic,
        nvDaoToken,
        withdrawalAmount,
      );
      // Lol account
      const withdrawalRecipient = "0xc42A84D4f2f511f90563dc984311Ab737ee56eFD";
      await registerWithdrawal(
        ownerPublic,
        withdrawalAmount,
        nonceHash,
        witness,
        nvDaoToken,
        dd,
        withdrawalRecipient,
        withdrawalRecipient,
        blockHashOracle,
      );

      // Get withdrawal tx
      const withdrawalAddress = depositAddress;
      const tdd = await TokenizedDarkDAO.create(
        dd as unknown as Contract,
        nvDaoToken as unknown as Contract,
        daoTokenBalanceMappingSlot,
        ddTokenWithdrawalsSlot,
      );
      const signedWithdrawalTxRaw = await tdd.getWithdrawalTransaction(withdrawalRecipient);

      // Fund the account
      // TODO: Ensure these transactions can still be included despite max gas price not being fulfilled
      showTransactionResult(
        "Fund DAO token withdrawal",
        await ownerPublic
          .sendTransaction({ to: withdrawalAddress, value: ethers.parseEther("0.1") })
          .then(async (tx) => tx.wait()),
      );
      const txReceipt = await publicProvider
        .broadcastTransaction(signedWithdrawalTxRaw)
        .then(async (tx) => tx.wait());
      if (txReceipt === null) {
        throw new Error("Fund DAO token withdrawal transaction receipt is null");
      }
      showTransactionResult("DAO token transfer (estimate)", txReceipt);

      // Second withdrawal
      const { witness: witness2, nonceHash: nonceHash2 } = await beginWithdrawal(
        dd,
        ownerPublic,
        nvDaoToken,
        withdrawalAmount,
      );
      await registerWithdrawal(
        ownerPublic,
        withdrawalAmount,
        nonceHash2,
        witness2,
        nvDaoToken,
        dd,
        withdrawalRecipient,
        withdrawalRecipient,
        blockHashOracle,
      );

      // Get a proof of inclusion
      await blockHashOracle
        .setBlockHash(txReceipt.blockNumber, txReceipt.blockHash)
        .then(async (tx) => tx.wait());
      await tdd.proveWithdrawalInclusion(txReceipt.hash).then((tx) => tx.wait());

      console.log("Getting second signed withdrawal transaction...");
      const signedWithdrawalTxRaw2 = await tdd.getWithdrawalTransaction(withdrawalRecipient);
      const signedWithdrawalTx2 = ethers.Transaction.from(signedWithdrawalTxRaw2);
      expect(signedWithdrawalTx2.nonce).to.equal(1);
    });
  });
});
