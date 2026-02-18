// test/TransactionSerializer.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TransactionSerializer", function () {
  async function deploySerializer() {
    const TransactionSerializerFactory = await ethers.getContractFactory("TransactionSerializer");
    const transactionSerializer = await TransactionSerializerFactory.deploy();
    await transactionSerializer.waitForDeployment();
    const SerializerTestFactory = await ethers.getContractFactory("TransactionSerializerTest", {
      libraries: {
        TransactionSerializer: transactionSerializer.target,
      },
    });
    const serializerTest = await SerializerTestFactory.deploy();
    return { serializerTest };
  }

  it("should correctly serialize both unsigned and signed EIP-1559 transactions", async () => {
    const { serializerTest } = await deploySerializer();

    // Causes the r-value in the signature to lead with a zero byte
    const wallet = new ethers.Wallet(
      "0xeb07a2af12767e8906b6defb52641e1bb143ae3acf8d4fe6639c608764d7c800",
    );

    const tx = {
      type: 2,
      chainId: 31337n,
      nonce: 0,
      maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
      maxFeePerGas: ethers.parseUnits("2", "gwei"),
      gasLimit: 21000n,
      to: wallet.address,
      value: 0n,
      data: "0x",
    };

    const signedTx = await wallet.signTransaction(tx);
    const parsed = ethers.Transaction.from(signedTx);

    // Build the struct expected by TransactionSerializer
    const unsignedMessage = {
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      maxPriorityFeePerGas: BigInt(parsed.maxPriorityFeePerGas ?? 0n),
      maxFeePerGas: BigInt(parsed.maxFeePerGas ?? 0n),
      gasLimit: parsed.gasLimit,
      destination: parsed.to ?? "0x",
      amount: BigInt(parsed.value),
      payload: parsed.data,
    };

    const expectedUnsigned = ethers.hexlify(parsed.unsignedSerialized);
    const contractUnsigned = await serializerTest.serializeTransaction(unsignedMessage);
    expect(contractUnsigned).to.equal(expectedUnsigned);

    const signature = parsed.signature;
    if (signature === null) {
      throw new Error("Signature is null");
    }

    // Verify signed encoding
    console.log("r:", signature.r);
    console.log("s:", signature.s);
    console.log("v:", signature.v - 27);
    const signedMessage = {
      transaction: unsignedMessage,
      r: signature.r,
      s: signature.s,
      v: signature.v - 27,
    };

    const contractSigned = await serializerTest.serializeSignedTransaction(signedMessage);
    expect(contractSigned).to.equal(signedTx);
  });

  it("Should serialize a transaction with a 31-byte value", async () => {
    const { serializerTest } = await deploySerializer();
    const wallet = new ethers.Wallet(ethers.zeroPadValue("0x01", 32));

    const tx = {
      type: 2,
      chainId: 31337n,
      nonce: 0,
      maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
      maxFeePerGas: ethers.parseUnits("2", "gwei"),
      gasLimit: 21000n,
      to: wallet.address,
      value: 0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
      data: "0x",
    };

    const signedTx = await wallet.signTransaction(tx);
    const parsed = ethers.Transaction.from(signedTx);

    const unsignedMessage = {
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      maxPriorityFeePerGas: BigInt(parsed.maxPriorityFeePerGas ?? 0n),
      maxFeePerGas: BigInt(parsed.maxFeePerGas ?? 0n),
      gasLimit: parsed.gasLimit,
      destination: parsed.to ?? "0x",
      amount: BigInt(parsed.value),
      payload: parsed.data,
    };
    const expectedUnsigned = ethers.hexlify(parsed.unsignedSerialized);
    const contractUnsigned = await serializerTest.serializeTransaction(unsignedMessage);
    expect(contractUnsigned).to.equal(expectedUnsigned);
  });
});
