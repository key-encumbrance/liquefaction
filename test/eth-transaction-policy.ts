import { expect } from "chai";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { type JsonRpcApiProvider, type BytesLike } from "ethers";
import { ethers } from "hardhat";
import { derToEthSignature } from "../scripts/ethereum-signatures";
import {
  getMappingStorageSlot,
  getRpcUint,
  getRlpUint,
  getTxInclusionProof,
} from "../scripts/inclusion-proofs";
import { IEncumbrancePolicy, TransactionSerializer } from "../typechain-types";

function getCurrentTime() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilsSecondsPassed(s: number, startTimer: Date) {
  const currentTime = new Date();
  const elapsedMilliseconds = currentTime.getTime() - startTimer.getTime();

  const millisecondsUntilsSeconds = s * 1000 - elapsedMilliseconds;

  if (millisecondsUntilsSeconds > 0) {
    console.log(`Waiting for ${millisecondsUntilsSeconds}ms...`);
    await sleep(millisecondsUntilsSeconds);
  }
}

type DestinationAsset = {
  chainId: bigint;
  to: string;
};

const publicNetwork = {
  chainId: 30121,
  name: "publicNetwork",
};
const publicProvider = new ethers.JsonRpcProvider("http://127.0.0.1:32002", publicNetwork);

function throwIfEmpty<T>(val: T | undefined | null, valStr: string): T {
  if (val === undefined || val === null) {
    throw new Error("Expected value to be non-empty: " + valStr);
  }
  return val;
}

// Get a transaction inclusion proof. Only returns the correct type for type-2 transactions.
async function getTxInclusion(gethProvider: JsonRpcApiProvider, txHash: string) {
  const signedWithdrawalTx = await publicProvider.getTransaction(txHash);
  if (signedWithdrawalTx === null) {
    throw new Error("Withdrawal transaction is null");
  }
  if (signedWithdrawalTx.type !== 2) {
    throw new Error("Unsupported transaction type (must be 2 for getTxInclusion)");
  }
  const txReceipt = await gethProvider.getTransactionReceipt(txHash);
  if (txReceipt === null) {
    throw new Error("Withdrawal transaction receipt is null");
  }
  const { proof, rlpBlockHeader } = await getTxInclusionProof(
    gethProvider,
    txReceipt.blockNumber,
    txReceipt.index,
  );

  // Get proof
  // This can be gathered from the transaction data of the included transaction
  const signedTxFormatted = {
    transaction: {
      chainId: signedWithdrawalTx.chainId,
      nonce: signedWithdrawalTx.nonce,
      maxPriorityFeePerGas: throwIfEmpty(
        signedWithdrawalTx.maxPriorityFeePerGas,
        "maxPriorityFeePerGas",
      ),
      maxFeePerGas: throwIfEmpty(signedWithdrawalTx.maxFeePerGas, "maxFeePerGas"),
      gasLimit: signedWithdrawalTx.gasLimit,
      destination: throwIfEmpty(signedWithdrawalTx.to, "to"),
      amount: signedWithdrawalTx.value,
      payload: signedWithdrawalTx.data,
    },
    r: signedWithdrawalTx.signature.r,
    s: signedWithdrawalTx.signature.s,
    v: signedWithdrawalTx.signature.v,
  };

  return {
    signedTxFormatted,
    inclusionProof: {
      rlpBlockHeader,
      transactionIndexRlp: getRlpUint(txReceipt.index),
      transactionProofStack: ethers.encodeRlp(proof.map((rlpList) => ethers.decodeRlp(rlpList))),
    },
    proofBlockNumber: txReceipt.blockNumber,
  };
}

describe("EthTransactionPolicy", function () {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  async function deployWallet() {
    // Contracts are deployed using the first signer/account by default
    const [firstSigner] = await ethers.getSigners();
    // sapphire.wrap is necessary for accessing view functions, but revert messages are not
    // shown when doing encrypted calls
    // const owner = sapphire.wrap(firstSigner);
    const owner = firstSigner;

    const EIP712Utils = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await EIP712Utils.deploy();

    const BasicEncumberedWallet = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const wallet = await BasicEncumberedWallet.deploy();

    return { owner, wallet: wallet.connect(owner) };
  }

  async function deployPolicy() {
    const walletArgs = await deployWallet();
    const { wallet } = walletArgs;

    const TransactionSerializer = await ethers.getContractFactory("TransactionSerializer");
    const transactionSerializer = await TransactionSerializer.deploy();

    const TrivialBlockHashOracle = await ethers.getContractFactory("TrivialBlockHashOracle", {});
    const trivialBlockHashOracle = await TrivialBlockHashOracle.deploy();

    const NonceEncumbrancePolicy = await ethers.getContractFactory("EthTransactionPolicy", {
      libraries: {
        TransactionSerializer: transactionSerializer.target,
      },
    });

    const StateVerifier = await ethers.getContractFactory("ProvethVerifier");
    const stateVerifier = await StateVerifier.deploy();

    const policy = await NonceEncumbrancePolicy.deploy(
      wallet.target,
      trivialBlockHashOracle.target,
      stateVerifier.target,
    );
    return { ...walletArgs, policy, trivialBlockHashOracle, transactionSerializer };
  }

  async function deploySubPolicy() {
    const policyArgs = await deployPolicy();

    const SubPolicy = await ethers.getContractFactory("TestTransactionSubPolicy", {
      libraries: {
        TransactionSerializer: policyArgs.transactionSerializer.target,
      },
    });
    const subPolicy = await SubPolicy.deploy(policyArgs.policy);
    return { ...policyArgs, subPolicy };
  }

  async function deployTestSubPolicy(
    policy: IEncumbrancePolicy,
    transactionSerializer: TransactionSerializer,
  ) {
    const SubPolicy = await ethers.getContractFactory("TestTransactionSubPolicy", {
      libraries: {
        TransactionSerializer: transactionSerializer.target,
      },
    });
    const subPolicy = await SubPolicy.deploy(policy);
    return subPolicy;
  }

  async function getAccounts() {
    // Contracts are deployed using the first signer/account by default
    // 0x72A6CF1837105827077250171974056B40377488
    const ownerPublic = new ethers.Wallet(
      "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
    ).connect(publicProvider);
    return { ownerPublic };
  }

  it("Should enroll in an Ethereum transaction subpolicy", async () => {
    const { owner, wallet, policy, subPolicy } = await deploySubPolicy();
    await wallet.createWallet(0).then(async (c) => c.wait());

    // Policies usually should allow extra access
    const txPolicyExpiration = getCurrentTime() + 60 * 60;
    await expect(
      wallet.enterEncumbranceContract(
        0,
        [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000000000000000000000000001945",
        ],
        policy.target,
        txPolicyExpiration,
        abiCoder.encode(["address"], [owner.address]),
      ),
    ).to.not.be.reverted;

    const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);
    const assets: DestinationAsset[] = [
      {
        chainId: 1n,
        to: "0x0000000000000000000000000000000000000000",
      },
    ];

    // Subpolicies usually should allow extra access
    await expect(
      policy
        .connect(owner)
        .enterEncumbranceContract(
          walletAddr,
          assets,
          subPolicy.target,
          txPolicyExpiration,
          abiCoder.encode(["bool", "bool"], [true, false]),
        ),
    ).to.not.be.reverted;
  });

  it("Should generate a transaction inclusion proof", async () => {
    const { ownerPublic } = await getAccounts();
    const txReceipt = await ownerPublic
      .sendTransaction({ to: ownerPublic.address })
      .then(async (tx) => tx.wait());
    expect(txReceipt).to.not.be.null;
    await getTxInclusionProof(publicProvider, txReceipt!.blockNumber, txReceipt!.index);
  });

  it("Should sign encumbered Ethereum transactions and increment the nonce using a transaction inclusion proof", async () => {
    let [accountOwner] = await ethers.getSigners();
    const { owner, wallet, policy, trivialBlockHashOracle, subPolicy } = await deploySubPolicy();
    await wallet.createWallet(0).then(async (c) => c.wait());
    const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);

    const txPolicyExpiration = getCurrentTime() + 60 * 60;
    await wallet
      .enterEncumbranceContract(
        0,
        [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000000000000000000000000001945",
        ],
        policy.target,
        txPolicyExpiration,
        abiCoder.encode(["address"], [owner.address]),
      )
      .then((r) => r.wait());

    const assets: DestinationAsset[] = [
      {
        chainId: 30121n,
        to: "0x0000000000000000000000000000000000000000",
      },
    ];

    await policy
      .enterEncumbranceContract(
        walletAddr,
        assets,
        subPolicy.target,
        txPolicyExpiration,
        abiCoder.encode(["bool", "bool"], [true, false]),
      )
      .then((r) => r.wait());
    // 1. Commit to a deposit of 0.1 ETH to the encumbered wallet
    const { ownerPublic } = await getAccounts();
    const tx0 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
    });
    const tx0Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx0));
    const tx0Hash = tx0Transaction.hash;
    if (tx0Hash === null) {
      throw new Error("Could not get hash from transaction 0");
    }
    await subPolicy
      .connect(sapphire.wrap(owner))
      .commitToDeposit(tx0Hash)
      .then((r) => r.wait());

    // 2. Broadcast the deposit transaction and ensure it is included
    const tx0Receipt = await publicProvider
      .broadcastTransaction(tx0Transaction.serialized)
      .then((r) => r.wait());

    // 3. Add balance to the wallet
    const tx0ReceiptHash = tx0Receipt?.hash;
    if (tx0ReceiptHash === undefined) {
      throw new Error("Could not get tx receipt hash from transaction 0");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx0ReceiptHash,
    );
    await subPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait());

    // 4. Sign a transaction on behalf of the encumbered wallet
    const tx1 = {
      chainId: (await publicProvider.getNetwork()).chainId,
      nonce: 0,
      maxPriorityFeePerGas: 10_000_000_000n,
      maxFeePerGas: 10_000_000_000n,
      gasLimit: 21_000n,
      to: "0x0000000000000000000000000000000000000000",
      amount: 0n,
      data: "0x",
    };
    const tx1Transaction = ethers.Transaction.from({ ...tx1, type: 2 });
    const tx1UnsignedSerialized: BytesLike = tx1Transaction.unsignedSerialized;
    // Maybe we should change the names "payload" to "data" and "destination" to "to"...

    expect(
      subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
        ...tx1,
        destination: tx1.to,
        payload: tx1.data,
      }),
    ).to.be.revertedWith(
      "Insufficient balance to pay for gas cost later during transaction Inclusion proof",
    );

    let chainId = 30121n;
    await subPolicy
      .depositLocalFunds(walletAddr, chainId, {
        value: ethers.parseEther("2"),
      })
      .then((r) => r.wait());

    await subPolicy.finalizeLocalFunds(walletAddr, chainId).then((r) => r.wait());

    expect(
      subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
        ...tx1,
        destination: tx1.to,
        payload: tx1.data,
      }),
    ).to.be.revertedWith("Transaction not committed");

    await subPolicy
      .connect(sapphire.wrap(owner))
      .commitToTransaction(walletAddr, {
        ...tx1,
        destination: tx1.to,
        payload: tx1.data,
      })
      .then((r) => r.wait());
    const txSig1 = await subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
      ...tx1,
      destination: tx1.to,
      payload: tx1.data,
    });
    const ethSig1 = derToEthSignature(txSig1, tx1UnsignedSerialized, walletAddr, "bytes");
    if (ethSig1 === undefined) {
      // If this fails, check that tx1UnsignedSerialized is equal to the transaction
      throw new Error("Could not verify transaction signature");
    }
    tx1Transaction.signature = ethSig1;

    // 5. Broadcast transaction on target blockchain
    await publicProvider.broadcastTransaction(tx1Transaction.serialized).then((r) => r.wait());

    // 6. Create transaction inclusion proof
    const tx1Hash = tx1Transaction.hash;
    if (tx1Hash === null) {
      throw new Error("Could not get hash from transaction 1");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx1Hash,
    );

    const tx2 = { ...tx1, nonce: 1 };
    const txReceipt = await publicProvider.getTransactionReceipt(tx1Hash);
    if (txReceipt === null) {
      throw new Error("Withdrawal transaction receipt is null");
    }
    await trivialBlockHashOracle
      .setBlockHash(txReceipt.blockNumber, txReceipt.blockHash)
      .then((r) => r.wait());

    // 7. Prove transaction inclusion to the encumbrance policy
    const balance = await ethers.provider.getBalance(owner.address);
    let receipt = await policy
      .proveTransactionInclusion(signedTxFormatted, inclusionProof, proofBlockNumber)
      .then((r) => r.wait());
    if (receipt === undefined || receipt === null) {
      throw new Error("Could not get receipt from proveTransactionInclusion");
    }

    let reimbursed_amount = await policy.estimateInclusionProofCost(
      signedTxFormatted.transaction.payload.length,
    );
    let curr_balance = await ethers.provider.getBalance(owner.address);
    if (balance - receipt.gasUsed * receipt.gasPrice + reimbursed_amount != curr_balance) {
      throw new Error("Balance reimbursement for transaction inclusion proof failed");
    }

    // 8. Sign a second transaction with nonce = 1 without commitment
    const tx2Transaction = ethers.Transaction.from({ ...tx2, type: 2 });
    const tx2UnsignedSerialized: BytesLike = tx2Transaction.unsignedSerialized;
    const txSig2 = await subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
      ...tx2,
      destination: tx2.to,
      payload: tx2.data,
    });
    const ethSig2 = derToEthSignature(txSig2, tx2UnsignedSerialized, walletAddr, "bytes");
    if (ethSig2 === undefined) {
      throw new Error("Could not verify transaction signature (tx2)");
    }
    tx2Transaction.signature = ethSig2;

    // 8. Broadcast this second transaction and ensure it gets included successfully
    await publicProvider.broadcastTransaction(tx2Transaction.serialized).then((r) => r.wait());
  });

  it("Should test transaction commitments when two consecutive subpolicies use the same asset", async () => {
    const { owner, wallet, policy, trivialBlockHashOracle, subPolicy, transactionSerializer } =
      await deploySubPolicy();
    await wallet.createWallet(0).then(async (c) => c.wait());
    const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);

    var txPolicyExpiration = getCurrentTime() + 60 * 60;
    await wallet
      .enterEncumbranceContract(
        0,
        [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000000000000000000000000001945",
        ],
        policy.target,
        txPolicyExpiration,
        abiCoder.encode(["address"], [owner.address]),
      )
      .then((r) => r.wait());

    const assets: DestinationAsset[] = [
      {
        chainId: 30121n,
        to: "0x0000000000000000000000000000000000000000",
      },
    ];

    txPolicyExpiration = getCurrentTime() + 90; // policy expires in 100 seconds
    await policy
      .enterEncumbranceContract(
        walletAddr,
        assets,
        subPolicy.target,
        txPolicyExpiration,
        abiCoder.encode(["bool", "bool"], [false, false]), // This subpolicy will not commit to the deposit nor transactions
      )
      .then((r) => r.wait());
    let startTimer = Date.now();

    // 1. Commit to a deposit of 0.1 ETH to the encumbered wallet
    const { ownerPublic } = await getAccounts();
    const tx0 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
    });
    const tx0Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx0));
    const tx0Hash = tx0Transaction.hash;
    if (tx0Hash === null) {
      throw new Error("Could not get hash from transaction 0");
    }
    await subPolicy
      .connect(sapphire.wrap(owner))
      .commitToDeposit(tx0Hash)
      .then((r) => r.wait());

    // 2. Broadcast the deposit transaction and ensure it is included
    const tx0Receipt = await publicProvider
      .broadcastTransaction(tx0Transaction.serialized)
      .then((r) => r.wait());

    // 3. Add balance to the wallet
    const tx0ReceiptHash = tx0Receipt?.hash;
    if (tx0ReceiptHash === undefined) {
      throw new Error("Could not get tx receipt hash from transaction 0");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx0ReceiptHash,
    );

    await subPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait());

    let chainId = 30121n;
    await subPolicy
      .depositLocalFunds(walletAddr, chainId, {
        value: ethers.parseEther("0.2"),
      })
      .then((r) => r.wait());

    await subPolicy.finalizeLocalFunds(walletAddr, chainId).then((r) => r.wait());

    // 4. Sign a transaction on behalf of the encumbered wallet
    const tx1 = {
      chainId: (await publicProvider.getNetwork()).chainId,
      nonce: 0,
      maxPriorityFeePerGas: 10_000_000_000n,
      maxFeePerGas: 10_000_000_000n,
      gasLimit: 21_000n,
      to: "0x0000000000000000000000000000000000000000",
      amount: 0n,
      data: "0x",
    };
    const tx1Transaction = ethers.Transaction.from({ ...tx1, type: 2 });
    const tx1UnsignedSerialized: BytesLike = tx1Transaction.unsignedSerialized;

    const txSig1 = await subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
      ...tx1,
      destination: tx1.to,
      payload: tx1.data,
    });

    tx1.nonce = 1; //Wrong nonce
    expect(
      subPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
        ...tx1,
        destination: tx1.to,
        payload: tx1.data,
      }),
    ).to.be.revertedWith("Invalid nonce");

    const ethSig1 = derToEthSignature(txSig1, tx1UnsignedSerialized, walletAddr, "bytes");
    if (ethSig1 === undefined) {
      // If this fails, check that tx1UnsignedSerialized is equal to the transaction
      throw new Error("Could not verify transaction signature");
    }
    tx1Transaction.signature = ethSig1;

    // 5. Broadcast transaction on target blockchain
    await publicProvider.broadcastTransaction(tx1Transaction.serialized).then((r) => r.wait());

    let balanceStart = await subPolicy.getSubPolicyBalance(walletAddr, chainId);

    // 6. Sleep until 95 seconds have passed
    await waitUntilsSecondsPassed(95, new Date(startTimer));

    // 7. Start a second subpolicy
    txPolicyExpiration = getCurrentTime() + 30 * 60;

    const secondSubPolicy = await deployTestSubPolicy(policy, transactionSerializer);

    await policy
      .enterEncumbranceContract(
        walletAddr,
        assets,
        secondSubPolicy.target,
        txPolicyExpiration,
        abiCoder.encode(["bool", "bool"], [true, false]), // This subpolicy will need to commit to the deposit
      )
      .then((r) => r.wait());
    startTimer = Date.now();

    // 8. Check that this subpolicy has no funds
    if ((await secondSubPolicy.getSubPolicyBalance(walletAddr, chainId)) != BigInt(0)) {
      throw new Error("The wallet balance should be 0");
    }

    // 9. Commit to a deposit of 0.1 ETH to the encumbered wallet
    const tx2 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
    });

    const tx2Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx2));

    const tx2Hash = tx2Transaction.hash;
    if (tx2Hash === null) {
      throw new Error("Could not get hash from transaction 2");
    }
    await secondSubPolicy
      .connect(sapphire.wrap(owner))
      .commitToDeposit(tx2Hash)
      .then((r) => r.wait());

    // 10. Broadcast the deposit transaction and ensure it is included
    const tx2Receipt = await publicProvider
      .broadcastTransaction(tx2Transaction.serialized)
      .then((r) => r.wait());

    // 11. Add balance to the wallet
    const tx2ReceiptHash = tx2Receipt?.hash;
    if (tx2ReceiptHash === undefined) {
      throw new Error("Could not get tx receipt hash from transaction 0");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx2ReceiptHash,
    );
    await secondSubPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait());

    const balanceBeforeInclusionProof = await secondSubPolicy.getSubPolicyBalance(
      walletAddr,
      chainId,
    );
    if (balanceBeforeInclusionProof == BigInt(0)) {
      throw new Error("The wallet balance should not be 0");
    }

    await secondSubPolicy
      .depositLocalFunds(walletAddr, chainId, {
        value: ethers.parseEther("0.2"),
      })
      .then((r) => r.wait());

    await secondSubPolicy.finalizeLocalFunds(walletAddr, chainId).then((r) => r.wait());

    // 12. Create transaction inclusion proof for the first transaction
    const tx1Hash = tx1Transaction.hash;
    if (tx1Hash === null) {
      throw new Error("Could not get hash from transaction 1");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx1Hash,
    );

    const txReceipt = await publicProvider.getTransactionReceipt(tx1Hash);
    if (txReceipt === null) {
      throw new Error("Withdrawal transaction receipt is null");
    }
    await trivialBlockHashOracle
      .setBlockHash(txReceipt.blockNumber, txReceipt.blockHash)
      .then((r) => r.wait());

    // 13. Prove transaction inclusion to the encumbrance policy
    await policy
      .proveTransactionInclusion(signedTxFormatted, inclusionProof, proofBlockNumber)
      .then((r) => r.wait());
    let balanceFinal = await subPolicy.getSubPolicyBalance(walletAddr, chainId);

    if (
      balanceStart - balanceFinal !=
      (await policy.getMaxTransactionCost(signedTxFormatted.transaction))
    ) {
      throw new Error(
        "The balance did was not correctly decremented from the first subpolicy " +
          balanceStart +
          " " +
          balanceFinal,
      );
    }

    // 14. Check that the balance has not changed
    const balanceAfterInclusionProof = await secondSubPolicy.getSubPolicyBalance(
      walletAddr,
      chainId,
    );
    if (balanceAfterInclusionProof != balanceBeforeInclusionProof) {
      throw new Error("The wallet balance should be the same");
    }

    // 15. Release commitment requirement
    await policy
      .connect(sapphire.wrap(owner))
      .releaseCommitmentRequirement(walletAddr, assets[0])
      .then((r) => r.wait());

    // 16. Sign a second transaction with nonce = 1 without commitment
    const tx3 = { ...tx1, nonce: 1 };
    const tx3Transaction = ethers.Transaction.from({ ...tx3, type: 2 });
    const tx3UnsignedSerialized: BytesLike = tx3Transaction.unsignedSerialized;
    const txSig3 = await secondSubPolicy.connect(sapphire.wrap(owner)).signOnBehalf(walletAddr, {
      ...tx3,
      destination: tx3.to,
      payload: tx3.data,
    });
    const ethSig3 = derToEthSignature(txSig3, tx3UnsignedSerialized, walletAddr, "bytes");
    // If this test passes that means that the nonce signed is actually 1 and transaction 1 incremented the nonce
    if (ethSig3 === undefined) {
      throw new Error("Could not verify transaction signature (tx3)");
    }
  });

  it("Should enroll in a subpolicy with deposit control and try to add deposit straightaway and via subpolicy", async () => {
    const { owner, wallet, policy, transactionSerializer } = await deployPolicy();
    const subPolicy = await deployTestSubPolicy(policy, transactionSerializer);
    await wallet.createWallet(0).then(async (c) => c.wait());
    const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);

    const txPolicyExpiration = getCurrentTime() + 60 * 60;
    await wallet
      .enterEncumbranceContract(
        0,
        [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000000000000000000000000001945",
        ],
        policy.target,
        txPolicyExpiration,
        abiCoder.encode(["address"], [owner.address]),
      )
      .then((r) => r.wait());

    const assets: DestinationAsset[] = [
      {
        chainId: 30121n,
        to: "0x0000000000000000000000000000000000000000",
      },
    ];

    await policy
      .enterEncumbranceContract(
        walletAddr,
        assets,
        subPolicy.target,
        txPolicyExpiration,
        abiCoder.encode(["bool", "bool"], [true, true]),
      )
      .then((r) => r.wait());
    // 1. Commit to a deposit of 0.1 ETH to the encumbered wallet
    const { ownerPublic } = await getAccounts();
    const tx0 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
    });

    const tx0Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx0));
    const tx0Hash = tx0Transaction.hash;
    if (tx0Hash === null) {
      throw new Error("Could not get hash from transaction 0");
    }

    await subPolicy
      .connect(sapphire.wrap(owner))
      .commitToDeposit(tx0Hash)
      .then((r) => r.wait());

    // 2. Prove that the commitment happenned
    const commitmentProof = {
      account: await subPolicy.getAddress(),
      txHash: tx0Hash,
    };

    const types = {
      DepositCommitmentProof: [
        { name: "account", type: "address" },
        { name: "txHash", type: "bytes32" },
      ],
    };

    const domain = {
      name: "EthTransactionPolicy",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await policy.getAddress(),
    };

    const signature = await owner.signTypedData(domain, types, commitmentProof);

    let isDepositCommitted = await policy.isDepositCommitted(commitmentProof, signature);
    expect(isDepositCommitted).to.be.true;

    // 3. Broadcast the deposit transaction and ensure it is included
    const tx0Receipt = await publicProvider
      .broadcastTransaction(tx0Transaction.serialized)
      .then((r) => r.wait());

    // 4. Submit another transaction without commitment
    const tx1 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
    });
    const tx1Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx1));
    const tx1Hash = tx1Transaction.hash;
    if (tx1Hash === null) {
      throw new Error("Could not get hash from transaction 1");
    }
    const tx1Receipt = await publicProvider
      .broadcastTransaction(tx1Transaction.serialized)
      .then((r) => r.wait());

    //This transaction was committed after it was submitted and should not be included
    await subPolicy
      .connect(sapphire.wrap(owner))
      .commitToDeposit(tx1Hash)
      .then((r) => r.wait());

    // 5. Add balance to the wallet
    const tx0ReceiptHash = tx0Receipt?.hash;
    const tx1ReceiptHash = tx1Receipt?.hash;
    if (tx0ReceiptHash === undefined) {
      throw new Error("Could not get tx receipt hash from transaction 0");
    }
    if (tx1ReceiptHash === undefined) {
      throw new Error("Could not get tx receipt hash from transaction 1");
    }
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx0ReceiptHash,
    );
    expect(subPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait())).to.be
      .reverted;
    expect(subPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait())).to.not
      .be.reverted;
    var { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx1ReceiptHash,
    );
    expect(subPolicy.acceptDeposit(signedTxFormatted, inclusionProof).then((r) => r.wait())).to.be
      .reverted;
  });
});
