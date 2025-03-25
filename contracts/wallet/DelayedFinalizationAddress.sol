// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title DelayedFinalizationAddress
 * @notice Provides functions for managing addresses with a delayed finalization
 * mechanism. Address updates always refer to changes in assignment.
 */
library DelayedFinalizationAddress {
    struct AddressStatus {
        // Current value
        address _address;
        // Block number when pending address was set
        uint256 pendingBlockNumber;
    }

    /**
     * @notice Sets a new address as pending for a given key, assuming the update.
     * @param addresses Storage mapping for all addresses (pending and finalized)
     * @param key The generic key (e.g., "admin", "controller", etc.)
     * @param newAddress The new address to set
     */
    function updateAddress(
        mapping(bytes32 => AddressStatus) storage addresses,
        bytes32 key,
        address newAddress
    ) internal {
        require(addresses[key].pendingBlockNumber < block.number, "Address: Multiple changes in the same block");
        addresses[key] = AddressStatus(newAddress, block.number);
    }

    /**
     * @notice Gets the finalized address for a given key. Reverts if the address is still pending finalization.
     * @param addresses Storage mapping for all addresses (pending and finalized)
     * @param key The generic key
     * @return The finalized address
     */
    function getFinalizedAddress(
        mapping(bytes32 => AddressStatus) storage addresses,
        bytes32 key
    ) internal view returns (address) {
        require(addresses[key].pendingBlockNumber < block.number, "Address is pending finalization");
        return addresses[key]._address;
    }

    /**
     * @notice Checks if an address is finalized for a given key without returning the address.
     *         Useful for access control checks.
     * @param addresses Storage mapping for all addresses (pending and finalized)
     * @param key The generic key
     * @param addr The address to check
     * @return True if the address is finalized for the key, false otherwise
     */
    function isFinalizedAddress(
        mapping(bytes32 => AddressStatus) storage addresses,
        bytes32 key,
        address addr
    ) internal view returns (bool) {
        if (addresses[key].pendingBlockNumber >= block.number) {
            return false; // Pending finalization, don't reveal
        }
        return addresses[key]._address == addr;
    }
}
