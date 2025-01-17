## Example encumbrance policies

This directory has two example encumbrance policy contracts. Encumbrance policies restrict the owners of key-encumbered wallets created by the [Basic Encumbered Wallet contract](../../BasicEncumberedWallet.sol) from signing certain types of messages until enrollment expires.

- **ExampleEncumbrancePolicy**: Encumbers all Ethereum signed messages, allowing the contract owner to have, exclusively, the ability to sign messages on behalf of enrolled encumbered accounts.
- **TrivialTypedDataPolicy**: Delegates access to the signatures of a particular domain of EIP-712 signed messages to another address. Note that the delegated domain is determined by the encumbered account's access manager during enrollment. This contract does not check which domains were delegated.
- **TestTransactionSubPolicy**: Implements a transaction sub-policy contract, with no authentication whatsoever, for testing.
