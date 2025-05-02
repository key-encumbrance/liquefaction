// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title DelayedFinalizationBool
 * @notice Provides functions for managing bools with a delayed finalization
 * mechanism. Bool updates always refer to changes in assignment.
 */
library DelayedFinalizationBool {
    struct BoolStatus {
        // Current value
        bool _bool;
        // Block number when pending bool was set
        uint256 pendingBlockNumber;
    }

    /**
     * @notice Sets a new bool as pending.
     * @param boolStatus Bool status in storage
     * @param newBool The new bool to set
     */
    function updateBool(BoolStatus storage boolStatus, bool newBool) internal {
        require(boolStatus.pendingBlockNumber < block.number, "Bool: Multiple changes in the same block");
        boolStatus._bool = newBool;
        boolStatus.pendingBlockNumber = block.number;
    }

    /**
     * @notice Gets the finalized bool for a given key. Reverts if the bool is still pending finalization.
     * @param boolStatus Bool status in storage
     * @return The finalized bool
     */
    function getFinalizedBool(BoolStatus storage boolStatus) internal view returns (bool) {
        require(boolStatus.pendingBlockNumber < block.number, "Bool is pending finalization");
        return boolStatus._bool;
    }

    /**
     * @notice Checks if an bool is finalized for a given key without returning the bool.
     *         Useful for access control checks.
     * @param boolStatus Bool status in storage
     * @param comparisonBool The bool to check
     * @return True if the bool is finalized for the key, false otherwise
     */
    function isFinalizedBool(BoolStatus storage boolStatus, bool comparisonBool) internal view returns (bool) {
        if (boolStatus.pendingBlockNumber >= block.number) {
            // Pending finalization, don't reveal
            return false;
        }
        return boolStatus._bool == comparisonBool;
    }
}
