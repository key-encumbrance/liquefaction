// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {IEncumbrancePolicy} from "../../IEncumbrancePolicy.sol";
import {IEncumberedWallet} from "../../IEncumberedWallet.sol";
import {EIP712DomainParams} from "../../../parsing/EIP712Utils.sol";

/**
 * @title Trivial Typed Data Policy
 * @notice A minimal encumbrance policy for encumbering votes on a hypothetical off-chain,
 * message-based DAO voting system.
 * Once an encumbered wallet enrolls in the policy, this contract is authorized to sign
 * any vote targeting the off-chain voting system from the encumbered account.
 */
contract TrivialTypedDataPolicy is IEncumbrancePolicy {
    // @notice The encumbered wallet contract that this policy trusts
    IEncumberedWallet public walletContract;
    // @notice Stores the timestamps of when accounts entered the policy
    mapping(address => uint256) private enrollmentTime;
    mapping(address => address) private allowedVoteSigner;

    constructor(IEncumberedWallet encumberedWallet) {
        walletContract = encumberedWallet;
    }

    /**
     * @dev Called by the key-encumbered wallet contract when an account is enrolled in this policy
     */
    function notifyEncumbranceEnrollment(
        address,
        address wallet,
        bytes32[] calldata,
        uint256 expiration,
        bytes calldata data
    ) public {
        require(msg.sender == address(walletContract), "Not wallet contract");
        require(expiration >= block.timestamp, "Expiration is in the past");
        enrollmentTime[wallet] = block.timestamp;
        address allowedVoteSignerAddr = abi.decode(data, (address));
        allowedVoteSigner[wallet] = allowedVoteSignerAddr;
    }

    function signOnBehalf(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        // Note that in the case of self-authorizations, wallet owners can just
        // sign through the wallet contract directly
        require(msg.sender == allowedVoteSigner[account], "Wrong vote signer");
        return walletContract.signTypedData(account, domain, dataType, data);
    }

    // Logic for handling bribe payments and signing votes could go here.
    // See the SnapshotDarkDAO contract for a complete example.
}
