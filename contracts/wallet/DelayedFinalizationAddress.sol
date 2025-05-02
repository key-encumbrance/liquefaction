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
     * @notice Sets a new address as pending.
     * @param addressStatus Address status in storage
     * @param newAddress The new address to set
     */
    function updateAddress(AddressStatus storage addressStatus, address newAddress) internal {
        require(addressStatus.pendingBlockNumber < block.number, "Address: Multiple changes in the same block");
        addressStatus._address = newAddress;
        addressStatus.pendingBlockNumber = block.number;
    }

    /**
     * @notice Gets the finalized address for a given key. Reverts if the address is still pending finalization.
     * @param addressStatus Address status in storage
     * @return The finalized address
     */
    function getFinalizedAddress(AddressStatus storage addressStatus) internal view returns (address) {
        require(addressStatus.pendingBlockNumber < block.number, "Address is pending finalization");
        return addressStatus._address;
    }

    /**
     * @notice Checks if an address is finalized for a given key without returning the address.
     *         Useful for access control checks.
     * @param addressStatus Address status in storage
     * @param addr The address to check
     * @return True if the address is finalized for the key, false otherwise
     */
    function isFinalizedAddress(AddressStatus storage addressStatus, address addr) internal view returns (bool) {
        if (addressStatus.pendingBlockNumber >= block.number) {
            return false; // Pending finalization, don't reveal
        }
        return addressStatus._address == addr;
    }
}
