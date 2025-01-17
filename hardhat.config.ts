import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
      },
      viaIR: true,
    },
  },
  networks: {
    sapphire_testnet: {
      url: "https://testnet.sapphire.oasis.dev",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 0x5a_ff,
    },
    sapphire_mainnet: {
      url: "https://sapphire.oasis.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 0x5a_fe,
    },
    dev: {
      url: "http://127.0.0.1:8545",
      // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
      // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      ],
      chainId: 0x5a_fd,
      timeout: 10_000_000,
    },
  },
  mocha: {
    timeout: 600_000,
  },
};

export default config;
