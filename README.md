# Liquefaction 🧊🌀️💧
- [📃 Read the paper](http://arxiv.org/abs/2412.02634)
- **Coming later:** Interactive demo dApp on public mainnet!

This repository contains the implementation of Liquefaction, a smart-contract based, key-encumbered wallet platform that systematically overturns the assumption that private keys are controlled by individuals or individual entities.

Liquefaction demonstrates the inherent fragility of this assumption and its sweeping repercussions, both destructive and constructive. This platform enables the cryptocurrency credentials and assets of a single end-user address to be freely rented, shared, or pooled, all while maintaining privacy.

### How does it work?
Liquefaction uses trusted execution environments (TEEs) to *encumber* private keys, allowing for rich, multi-user policies to be attached to their use. An **encumbered key** is not known by a user or administrator. Instead, it is generated by an application (running in a TEE) that enforces an access-control policy over access to signatures made with the key.

### What can it do?
Liquefaction enables a wide range of applications:

- **Dark DAOs**: privately sell or trade DAO votes (which cannot be overridden by the account owner) without making any public DAO token transfers or using public delegation.
- **Trading locked tokens**: buy or sell locked tokens while keeping the appearance of respecting their vesting schedules.
- **Mitigating dusting attacks**: prove that you don't own, and never did own, illicit assets that were sent to your account.
- **Private DAO treasuries**: privately commit funds to a fundraising DAO without transferring any assets on-chain.
- **Token-gated ticketing**: lend or sell your access to an in-person event or metaverse character to someone who doesn't own the required token.
- **Soulbound tokens**: sell an account which owns a soulbound token or sell access to signatures proving ownership of such an account.

See the [table on page 12](https://arxiv.org/pdf/2412.02634#page.12) of our paper for more details!

## Running the development code

### Important usage notes

For those who are interested in using Liquefaction on mainnet today, please note the following limitations:

1. We do not yet expose encumbrance history to new encumbrance policies, which makes **pre-signing attacks** trivial to perform (signing messages and holding onto signatures intended to be used after access is lost). Thus, encumbrance policies do not yet have a way to reject encumbered accounts which have previously used an untrusted policy that had broad access. We encourage your support in designing a specification for this feature. We think this can be resolved by having several critical encumbrance policies in use "from birth" of each encumbered account. You can implement this "encumbrance from birth" yourself (a complete mitigation to this issue) by wrapping our Liquefaction wallet with a smart contract access manager which enrolls encumbered accounts as soon as they are created and checking that the accounts you are interacting with originated from this access manager.
2. Our Ethereum transaction policy relies on the liveness of a trusted oracle of Ethereum block hashes, i.e. a trusted smart contract which maps block numbers to block hashes. You could implement one as an Ethereum light client on Oasis to minimize trust assumptions, but we have not designed such a feature.
3. Smart contract programming on Oasis Sapphire and in Liquefaction is slightly different from that on Ethereum. Specifically, [storage access patterns](https://docs.oasis.io/dapp/sapphire/security) are not hidden by the TEE and therefore might leak how a code path was taken. We have tried to limit information exposure where possible in our smart contracts, but our proof of concept does not take advantage of ORAM techniques or other critical mitigations to access pattern leaks.

### Run test cases locally

Requirements:

- NodeJS
- Docker
- [Kurtosis](https://docs.kurtosis.com/install/) for cross-chain tests (Ethereum inclusion/state proofs)

First, install the dependencies:

```sh
npm i
```

Run an Oasis Sapphire dev network:

```sh
# For linux/x86_64 based systems
docker run -it -p8545:8545 -p8546:8546 ghcr.io/oasisprotocol/sapphire-localnet -test-mnemonic
# For other systems (e.g., ARM-based Macs)
docker run -it -p8545:8545 -p8546:8546 --platform linux/x86_64 ghcr.io/oasisprotocol/sapphire-localnet -test-mnemonic
```

Check that the contracts compile:

```sh
npx hardhat compile
```

Check that the TypeScript source files compile:

```sh
npx tsc
```

For cross-chain test cases, run `geth` using Kurtosis:

```sh
kurtosis run github.com/ethpandaops/ethereum-package --args-file ./devnet/network_params.yaml --image-download always --enclave liquefaction-pub-devnet
# To stop the enclave:
kurtosis enclave stop liquefaction-pub-devnet
```

Run test cases:

```sh
npx hardhat test --network dev
```

#### Code formatting

Format code with

```sh
npx prettier -w .
```

### Acknowledgements

We use a modified version of [Proveth](https://github.com/lorenzb/proveth), available under the MIT license, to verify transaction inclusion and state proofs inside encumbrance policies.

### Disclaimer

The source code contained in this repository has not been audited. It is an
academic prototype. Our smart contracts might contain serious bugs.
Key-encumbered wallets and encumbrance policies are novel concepts,
so there are not yet any established standards or best practices to
assist with safe deployment.
