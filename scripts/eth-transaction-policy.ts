import { expect } from "chai";
import { ethers } from "hardhat";
import { type JsonRpcProvider, type BytesLike } from "ethers";
import { getRlpUint, getTxInclusionProof } from "./inclusion-proofs";

import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { derToEthSignature } from "./ethereum-signatures";

function getCurrentTime() {
  return Math.floor(Date.now() / 1000);
}

type DestinationAsset = {
  chainId: bigint;
  to: string;
};

const holeskyNetwork = {
  chainId: 17000, // Holesky's chain ID
  name: "holesky",
};

const publicNetwork = {
  chainId: 30121,
  name: "publicNetwork",
};
const publicProvider = new ethers.JsonRpcProvider("http://127.0.0.1:32002", publicNetwork);

/*async function getAccounts() {
  // Connect the wallet to the Holesky provider
  const ownerPrivateKey = process.env.PRIVATE_KEY;

  if (!ownerPrivateKey) {
    throw new Error("PRIVATE_KEY environment variable is not set");
  }
  const ownerPublic = new ethers.Wallet(ownerPrivateKey).connect(publicProvider);
  return { ownerPublic };
}*/

async function getAccounts() {
  // Contracts are deployed using the first signer/account by default
  // 0x72A6CF1837105827077250171974056B40377488
  const ownerPublic = new ethers.Wallet(
    "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
  ).connect(publicProvider);
  return { ownerPublic };
}

function throwIfEmpty<T>(val: T | undefined | null, valStr: string): T {
  if (val === undefined || val === null) {
    throw new Error("Expected value to be non-empty: " + valStr);
  }
  return val;
}

async function getTxInclusion(gethProvider: JsonRpcProvider, txHash: string) {
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

async function main() {
  let block_wait = 1;
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  /* = await new ethers.JsonRpcProvider(
    //"https://rpc-holesky.rockx.com",
    "https://1rpc.io/holesky",
    holeskyNetwork,
  );*/

  const { owner, wallet, policy, trivialBlockHashOracle, subPolicy } = await deploySubPolicy();
  await wallet.createWallet(0).then(async (c) => c.wait());
  const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);

  const txPolicyExpiration = getCurrentTime() + 60 * 60 * 24;
  let aux_receipt = await wallet
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
  console.log(
    "gas used by enrolling policy to wallet via enterEncumbranceContract: ",
    aux_receipt?.gasUsed,
  );
  const assets: DestinationAsset[] = [
    {
      chainId: (await publicProvider.getNetwork()).chainId,
      to: "0x0000000000000000000000000000000000000000",
    },
  ];

  aux_receipt = await policy
    .enterEncumbranceContract(
      walletAddr,
      assets,
      subPolicy.target,
      txPolicyExpiration,
      abiCoder.encode(["bool", "bool"], [false, false]),
    )
    .then((r) => r.wait());
  console.log(
    "gas used by enrolling sub-policy to policy via enterEncumbranceContract: ",
    aux_receipt?.gasUsed,
  );
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
  aux_receipt = await subPolicy
    .connect(sapphire.wrap(owner))
    .commitToDeposit(tx0Hash)
    .then((r) => r.wait());
  console.log("gas used by committing to deposit via commitToDeposit: ", aux_receipt?.gasUsed);

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
  aux_receipt = await policy.depositFunds(signedTxFormatted, inclusionProof).then((r) => r.wait());
  console.log("gas used by depositing funds via depositFunds: ", aux_receipt?.gasUsed);

  let chainId = (await publicProvider.getNetwork()).chainId;

  await subPolicy
    .depositLocalFunds(walletAddr, chainId, {
      value: ethers.parseEther("2"),
    })
    .then((r) => r.wait());

  await subPolicy.finalizeLocalFunds(walletAddr, chainId).then((r) => r.wait());

  console.log("Setup completed");
  // 4. Sign a transaction on behalf of the encumbered wallet
  for (let i = 0; i < 100; i++) {
    let startTimer = Date.now();
    const tx1 = {
      chainId: (await publicProvider.getNetwork()).chainId,
      nonce: i,
      maxPriorityFeePerGas: 10_000_000_000n,
      maxFeePerGas: 10_000_000_000n,
      gasLimit: 1_000_000n,
      to: "0x0000000000000000000000000000000000000000",
      amount: 0n,
      data: "0x" + "00".repeat(1024 * 10 * i),
    };
    const tx1Transaction = ethers.Transaction.from({ ...tx1, type: 2 });
    const tx1UnsignedSerialized: BytesLike = tx1Transaction.unsignedSerialized;

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
    const tx1_eth = await publicProvider.broadcastTransaction(tx1Transaction.serialized);
    if (tx1_eth === null) {
      throw new Error("Could not get tx receipt hash from transaction 0");
    }
    await tx1_eth.wait(1);
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
    aux_receipt = await policy
      .proveTransactionInclusion(signedTxFormatted, inclusionProof, proofBlockNumber)
      .then((r) => r.wait());
    console.log("Gas used for length ", i, ": ", aux_receipt?.gasUsed);

    console.log(block_wait + ", " + (Date.now() - startTimer));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err));
