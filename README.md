# Liquefaction 🧊🌀️💧
- [📃 Read the paper](http://arxiv.org/abs/2412.02634)
- **Coming soon:** all implementation code (including wallet, examples) will be open-sourced and released here 🔓️
- **Coming later this month:** interactive demo dApp on a public test network

This repository will contain the implementation of Liquefaction, a smart-contract based, key-encumbered wallet platform that systematically overturns the assumption that private keys are controlled by individuals or individual entities.

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

### Getting started
Coming soon.

### Acknowledgements

We use a modified version of [Proveth](https://github.com/lorenzb/proveth), available under the MIT license, to verify transaction inclusion and state proofs inside encumbrance policies.

### Disclaimer

The source code contained in this repository has not been audited. It is an
academic prototype. Our smart contracts might contain serious bugs.
Key-encumbered wallets and encumbrance policies are novel concepts,
so there are not yet any established standards or best practices to
assist with safe deployment.
