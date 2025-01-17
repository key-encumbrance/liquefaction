// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {EIP712DomainParams} from "../parsing/EIP712Utils.sol";

/**
 * @title Encumbrance policy interface.
 */
interface IEncumbrancePolicy {
    /**
     * Notify the policy that a it has been enrolled. The policy may revert the
     * enrollment if it wishes to reject the request.
     *
     * @param accountOwner The access manager of the account being enrolled.
     * @param account The account to be enrolled.
     * @param assets The assets being encumbered.
     * @param expiration The date and time when the enrollment will expire.
     * @param data Any additional data required by the policy (e.g. payment details).
     */
    function notifyEncumbranceEnrollment(
        address accountOwner,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata data
    ) external;
}
