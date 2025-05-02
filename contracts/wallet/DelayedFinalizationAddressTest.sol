// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {DelayedFinalizationAddress} from "./DelayedFinalizationAddress.sol";

contract DelayedFinalizationAddressTest {
    using DelayedFinalizationAddress for DelayedFinalizationAddress.AddressStatus;

    // Storage mapping for testing addresses
    mapping(bytes32 => DelayedFinalizationAddress.AddressStatus) public testAddresses;

    // Event to track address updates for easier testing
    event AddressUpdated(bytes32 key, address _address, uint256 pendingBlockNumber);

    /**
     * @notice Updates a test address as pending for a given key.
     * @param key The generic key (e.g., "testAdmin")
     * @param newAddress The new address to set
     */
    function updateTestAddress(bytes32 key, address newAddress) public {
        testAddresses[key].updateAddress(newAddress);
        emit AddressUpdated(key, newAddress, testAddresses[key].pendingBlockNumber);
    }

    /**
     * @notice Gets the finalized address for a given key.
     * @param key The generic key
     * @return The finalized address
     */
    function getFinalizedTestAddress(bytes32 key) public view returns (address) {
        return testAddresses[key].getFinalizedAddress();
    }

    /**
     * @notice Checks if an address is finalized for a given key.
     * @param key The generic key
     * @param addr The address to check
     * @return True if the address is finalized for the key, false otherwise
     */
    function isFinalizedTestAddress(bytes32 key, address addr) public view returns (bool) {
        return testAddresses[key].isFinalizedAddress(addr);
    }

    /**
     * @notice Attempts to update and get the finalized address in the same transaction.
     * @param key The generic key
     * @param newAddress The new address to set
     */
    function updateAndGetImmediately(bytes32 key, address newAddress) public {
        testAddresses[key].updateAddress(newAddress);
        // Attempt to get immediately
        address finalizedAddress = testAddresses[key].getFinalizedAddress();
        emit AddressUpdated(key, finalizedAddress, testAddresses[key].pendingBlockNumber);
    }
}
