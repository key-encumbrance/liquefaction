import { ethers, type BytesLike, type TransactionResponse, JsonRpcApiProvider } from "ethers";
import { derToEthSignature } from "./ethereum-signatures";
import {
  getMappingStorageSlot,
  getRpcUint,
  getRlpUint,
  getTxInclusionProof,
} from "./inclusion-proofs";

function getProviderFromContract(contract: ethers.Contract): JsonRpcApiProvider {
  let provider: ethers.JsonRpcApiProvider;
  const runner = contract.runner;
  if (runner !== null && runner instanceof ethers.Wallet) {
    if (!(runner.provider instanceof ethers.JsonRpcApiProvider)) {
      throw new Error(
        "ddToken runner's provider must be a JsonRpcApiProvider. Connect the signer before calling this function.",
      );
    }
    provider = runner.provider;
  } else {
    if (!(runner instanceof ethers.JsonRpcApiProvider)) {
      throw new Error(
        "ddToken runner must be a JsonRpcApiProvider. Connect the contract before calling this function.",
      );
    }
    provider = runner;
  }
  return provider;
}

export class TokenizedDarkDAO {
  darkDao: ethers.Contract;
  ddToken: ethers.Contract;
  targetDaoTokenAddress: string;
  daoTokenBalanceMappingSlot: string;
  ddTokenWithdrawalsSlot: string;

  private constructor() {
    this.darkDao = new ethers.Contract("0x0000000000000000000000000000000000000000", []);
    this.ddToken = new ethers.Contract("0x0000000000000000000000000000000000000000", []);
    this.targetDaoTokenAddress = "";
    this.daoTokenBalanceMappingSlot = "";
    this.ddTokenWithdrawalsSlot = "";
  }

  public static async create(
    darkDao: ethers.Contract,
    ddToken: ethers.Contract,
    daoTokenBalanceMappingSlot: string,
    ddTokenWithdrawalsSlot: string,
  ): Promise<TokenizedDarkDAO> {
    const tdd = new TokenizedDarkDAO();
    tdd.darkDao = darkDao;
    tdd.ddToken = ddToken;
    tdd.daoTokenBalanceMappingSlot = daoTokenBalanceMappingSlot;
    tdd.ddTokenWithdrawalsSlot = ddTokenWithdrawalsSlot;
    tdd.targetDaoTokenAddress = await tdd.darkDao.ethDaoToken();
    return tdd;
  }

  async generateDepositAddress(
    ddTokenRecipient: string,
  ): Promise<{ depositAddress: string; wrappedAddressInfo: string }> {
    await this.darkDao.generateDepositAddress(ddTokenRecipient).then((t) => t.wait());
    const wrappedAddrInfoLen: bigint = await this.darkDao.getWrappedAddressInfoLength();
    if (wrappedAddrInfoLen < 1n) {
      throw new Error("wrappedAddressInfo length < 1");
    }
    return await this.darkDao.getWrappedAddressInfo(wrappedAddrInfoLen - 1n);
  }

  async getDepositProof(
    depositData: { depositAddress: string; wrappedAddressInfo: string },
    proofBlockNumber?: number,
    expectedValue?: bigint,
  ) {
    const ddTokenProvider = getProviderFromContract(this.ddToken);
    const blockNumber = proofBlockNumber || (await ddTokenProvider.getBlock("latest"));

    const depositStorageSlot = getMappingStorageSlot(
      depositData.depositAddress,
      this.daoTokenBalanceMappingSlot,
    );
    const proofBlockNumberRpcString = getRpcUint(blockNumber);
    const publicProvider = ddTokenProvider as JsonRpcApiProvider;
    const proof = await publicProvider.send("eth_getProof", [
      this.targetDaoTokenAddress,
      [depositStorageSlot],
      proofBlockNumberRpcString,
    ]);

    if (expectedValue !== undefined && expectedValue !== BigInt(proof.storageProof[0].value)) {
      throw new Error("Storage proof does not prove expected value");
    }

    // Get the RLP-encoded block header for this block
    const rawProofBlockHeader = await publicProvider.send("debug_getRawHeader", [
      proofBlockNumberRpcString,
    ]);

    const storageProof = {
      rlpBlockHeader: rawProofBlockHeader,
      addr: this.targetDaoTokenAddress,
      storageSlot: depositStorageSlot,
      accountProofStack: ethers.encodeRlp(
        proof.accountProof.map((rlpValue: string) => ethers.decodeRlp(rlpValue)),
      ),
      storageProofStack: ethers.encodeRlp(
        proof.storageProof[0].proof.map((rlpValue: string) => ethers.decodeRlp(rlpValue)),
      ),
    };
    return storageProof;
  }

  async registerDeposit(wrappedAddressInfo: string, proofBlockNumber: number, storageProof: any) {
    return this.darkDao.registerDeposit(wrappedAddressInfo, proofBlockNumber, storageProof);
  }

  async mintDDTokens(depositIndex: number) {
    // TODO: Pass up other deposits
    const depositReceipt = await this.darkDao.getDeposit(depositIndex);
    const depositMessage = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "address", "uint256", "bytes32"],
      ["deposit", depositReceipt.recipient, depositReceipt.amount, depositReceipt.depositId],
    );
    const depositSignature = derToEthSignature(
      depositReceipt.signature,
      ethers.keccak256(depositMessage),
      await this.darkDao.darkDaoSignerAddress(),
      "digest",
    );
    return this.ddToken.finalizeDeposit(
      depositReceipt.recipient,
      depositReceipt.amount,
      depositReceipt.depositId,
      depositSignature,
    );
  }

  async beginWithdrawal(
    withdrawalAmount: bigint,
  ): Promise<{ witness: Uint8Array; nonceHash: string; tx: TransactionResponse }> {
    const witness = ethers.randomBytes(32);
    const nonceHash = ethers.keccak256(witness);
    const tx = await this.ddToken.beginWithdrawal(withdrawalAmount, nonceHash);
    return { witness, nonceHash, tx };
  }

  async registerWithdrawal(
    ddTokenHolder: string,
    withdrawalAmount: bigint,
    nonceHash: string,
    witness: string | Uint8Array,
    daoTokenRecipient: string,
    bribesRecipient: string,
    proofBlockNumber?: number,
  ): Promise<TransactionResponse> {
    // Calculate the storage slot
    const withdrawalHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address", "uint256", "bytes32"],
        ["withdrawal", ddTokenHolder, withdrawalAmount, nonceHash],
      ),
    );
    const withdrawalStorageSlot = getMappingStorageSlot(
      withdrawalHash,
      this.ddTokenWithdrawalsSlot,
    );
    // Get the withdrawal proof
    const publicProvider = getProviderFromContract(this.ddToken);
    const proofBlock = await publicProvider.getBlock(
      proofBlockNumber === undefined ? "latest" : proofBlockNumber,
    );

    if (proofBlock === null) {
      throw new Error("Failed to get proof block");
    }

    const proofBlockNumberRpcString = getRpcUint(proofBlock.number);
    const proof = await publicProvider.send("eth_getProof", [
      this.ddToken.target,
      [withdrawalStorageSlot],
      proofBlockNumberRpcString,
    ]);
    if (withdrawalAmount !== BigInt(proof.storageProof[0].value)) {
      throw new Error(
        "Withdrawal storage proof does not prove expected withdrawal amount: expected " +
          withdrawalAmount +
          " but got " +
          proof.storageProof[0].value,
      );
    }

    // Get the RLP-encoded block header for this block
    const rawProofBlockHeader = await publicProvider.send("debug_getRawHeader", [
      proofBlockNumberRpcString,
    ]);

    // Register the withdrawal with the proof
    const storageProof = {
      rlpBlockHeader: rawProofBlockHeader,
      addr: this.ddToken.target,
      storageSlot: withdrawalStorageSlot,
      accountProofStack: ethers.encodeRlp(
        proof.accountProof.map((rlpValue: string) => ethers.decodeRlp(rlpValue)),
      ),
      storageProofStack: ethers.encodeRlp(
        proof.storageProof[0].proof.map((rlpValue: string) => ethers.decodeRlp(rlpValue)),
      ),
    };

    return this.darkDao.registerWithdrawal(
      ddTokenHolder,
      withdrawalAmount,
      nonceHash,
      witness,
      daoTokenRecipient,
      bribesRecipient,
      proofBlock.number,
      storageProof,
    );
  }

  async getWithdrawalOwed(recipient: string): Promise<boolean> {
    return this.darkDao.getWithdrawalOwed(recipient);
  }

  async getWithdrawalTransaction(withdrawalRecipient: string): Promise<string> {
    const withdrawalTx = await this.darkDao.getSignedWithdrawalTransaction(withdrawalRecipient);
    const ethSig = derToEthSignature(
      withdrawalTx.signature,
      ethers.keccak256(withdrawalTx.unsignedTx),
      withdrawalTx.withdrawalAccount,
      "digest",
    );
    if (ethSig === undefined) {
      throw new Error("Signature recovery failed");
    }
    const signedWithdrawalTx = ethers.Transaction.from(withdrawalTx.unsignedTx);
    signedWithdrawalTx.signature = ethSig;
    const signedWithdrawalTxRaw = signedWithdrawalTx.serialized;
    return signedWithdrawalTxRaw;
  }

  async proveWithdrawalInclusion(txHash: string) {
    const ddTokenProvider = getProviderFromContract(this.ddToken);
    const signedWithdrawalTx = await ddTokenProvider.getTransaction(txHash);
    if (signedWithdrawalTx === null) {
      throw new Error("Withdrawal transaction is null");
    }
    const txReceipt = await ddTokenProvider.getTransactionReceipt(txHash);
    if (txReceipt === null) {
      throw new Error("Withdrawal transaction receipt is null");
    }
    const { proof, rlpBlockHeader } = await getTxInclusionProof(
      ddTokenProvider as JsonRpcApiProvider,
      txReceipt.blockNumber,
      txReceipt.index,
    );
    console.log("Transaction inclusion proof:", proof);

    // Submit proof to Dark DAO!
    // This can be gathered from the transaction data of the included transaction
    const signedTxFormatted = {
      transaction: {
        chainId: signedWithdrawalTx.chainId,
        nonce: signedWithdrawalTx.nonce,
        maxPriorityFeePerGas: signedWithdrawalTx.maxPriorityFeePerGas,
        maxFeePerGas: signedWithdrawalTx.maxFeePerGas,
        gasLimit: signedWithdrawalTx.gasLimit,
        destination: signedWithdrawalTx.to,
        amount: signedWithdrawalTx.value,
        payload: signedWithdrawalTx.data,
      },
      r: signedWithdrawalTx.signature.r,
      s: signedWithdrawalTx.signature.s,
      // TODO: We should probably make this v requirement consistent with the EthTransactionPolicy contract.
      v: signedWithdrawalTx.signature.v - 27,
    };
    console.log(signedTxFormatted, signedWithdrawalTx);
    const erc20Int = new ethers.Interface(["function transfer(address to, uint256 value) public"]);
    const transferData = erc20Int.decodeFunctionData("transfer", signedWithdrawalTx.data);
    return this.darkDao.proveWithdrawalInclusion(
      transferData.to,
      transferData.value,
      signedTxFormatted,
      {
        rlpBlockHeader,
        transactionIndexRlp: getRlpUint(txReceipt.index),
        transactionProofStack: ethers.encodeRlp(proof.map((rlpList) => ethers.decodeRlp(rlpList))),
      },
      txReceipt.blockNumber,
    );
  }
}
