# Minimal Upgradable Wallet

You can deploy a minimal upgradable wallet contract which is universally upgradable to other encumbered wallets. The catch is you cannot sign messages with this wallet.

## Deployment

Deploy a contract:

```sh
 PRIVATE_KEY=<your pk> npx hardhat run --network sapphire_mainnet scripts/minimal-upgradable-wallet/deploy.ts
```

## Transferring the key

When you are ready to transfer the key to a different wallet (or leak the key), do the following:

1. The recipient of the key should generate a keypair. To do this locally, run

```sh
python ./scripts/minimal-upgradable-wallet/generate_curve25519_keypair.py
```

Alternatively, you can also do this using a local Oasis Sapphire devnet:

```sh
npx hardhat run --network dev scripts/minimal-upgradable-wallet/recipient-1-create-local-keypair.ts
```

2. The owner should approve the recipient's public key. To do this on Oasis Sapphire mainnet, run

```sh
 PRIVATE_KEY=<your pk> npx hardhat run --network sapphire_mainnet scripts/minimal-upgradable-wallet/authorize-key.ts
```

and enter the contract address and recipient public key as requested.

3. The recipient can now request the encrypted key and decrypt it locally:

```sh
npx hardhat run --network sapphire_mainnet scripts/minimal-upgradable-wallet/recipient-2-read-encrypted-key.ts
```

```sh
npx hardhat run --network dev scripts/minimal-upgradable-wallet/recipient-3-decrypt-key.ts
```

4. The owner can erase the key from contract storage:

```sh
 PRIVATE_KEY=<your pk> npx hardhat run --network sapphire_mainnet scripts/minimal-upgradable-wallet/zap-key.ts
```

TODO: We should probably let the recipient do this.
