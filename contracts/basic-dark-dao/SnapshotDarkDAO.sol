// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ISnapshotEncumbrancePolicy} from "./SnapshotEncumbrancePolicy.sol";
import {EIP712DomainParams} from "../parsing/EIP712Utils.sol";

/**
 * @title Snapshot Dark DAO
 * @notice A Dark DAO for selling Snapshot-based DAO vote messages to the contract
 * creator, the briber.
 * The briber decides which bribe amounts would get paid to which accounts for enrolling
 * and publishes this information in a Merkle tree. Bribees whose accounts are already
 * encumbered and enrolled in the Snapshot encumbrance policy can enter the Dark DAO and
 * sell their votes.
 */
contract SnapshotDarkDAO {
    // @dev A mapping to keep track of which accounts were enrolled
    mapping(address => uint256) private registeredBribes;
    // @dev Keeps track of account owners for bribe payout authorization
    mapping(address => address) private accountOwners;
    mapping(address => uint256) private bribesPaid;
    // @dev Total registered voting power
    uint256 private totalVotingPower;
    // @dev Briber/contract creator's address
    address private briber;
    // @dev Amount of bribe money earmarked to be paid to bribees
    uint256 private outstandingBribeTotal;

    // @notice The Snapshot encumbrance policy that the Dark DAO trusts
    ISnapshotEncumbrancePolicy public snapshotEncPolicy;
    // @notice Timestamp before which the account must have been encumbered and enrolled
    // in the Snapshot encumbrance policy
    uint256 public proposalStart;
    // @notice Timestamp after which no more entrants are accepted
    uint256 public proposalEnd;
    // @notice The bribe for each account is encoded inside this Merkle tree
    bytes32 public bribeMerkleRoot;
    // @notice The target proposal hash
    bytes32 public proposalHash;

    constructor(
        ISnapshotEncumbrancePolicy _snapshotEncPolicy,
        bytes32 _proposalHash,
        uint256 _proposalStart,
        uint256 _proposalEnd,
        bytes32 _bribeMerkleRoot
    ) payable {
        snapshotEncPolicy = _snapshotEncPolicy;
        proposalHash = _proposalHash;
        proposalStart = _proposalStart;
        proposalEnd = _proposalEnd;
        bribeMerkleRoot = _bribeMerkleRoot;
        briber = msg.sender;
        totalVotingPower = 0;
    }

    receive() external payable {
        // Accept extra bribe money
    }

    /**
     * @notice Helps compute the Merkle leaf of a particular DAO member in the bribe Merkle tree
     * @param account Encumbered account that owns the DAO tokens
     * @param votingPower Voting power this account's vote contributes to the proposal vote
     * @param bribe Bribe amount that would be paid to the owner of this account for enrolling
     * @return Merkle leaf
     */
    function getLeaf(address account, uint256 votingPower, uint256 bribe) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, votingPower, bribe))));
    }

    /**
     * @notice Enters the Dark DAO. A bribee calling this function must have already assigned
     * vote signing privileges to this Dark DAO contract in the Snapshot encumbrance policy.
     * @param account Encumbered account that owns the DAO tokens
     * @param votingPower Voting power this account's vote contributes to the proposal vote
     * @param bribe Bribe amount that would be paid to the owner of this account for enrolling
     * @param proof Merkle proof of this account's bribe and voting power
     */
    function enterDarkDAO(address account, uint256 votingPower, uint256 bribe, bytes32[] calldata proof) public {
        require(block.timestamp < proposalEnd, "Bribe has ended");
        require(
            snapshotEncPolicy.amVoteSigner(account, proposalHash, msg.sender, proposalStart, proposalEnd),
            "Dark DAO must be the vote signer"
        );
        require(registeredBribes[account] == 0, "Already entered");
        require(
            MerkleProof.verify(proof, bribeMerkleRoot, getLeaf(account, votingPower, bribe)),
            "Invalid Merkle proof"
        );
        require(address(this).balance - outstandingBribeTotal >= bribe, "Insufficient bribe funds remaining");
        registeredBribes[account] = bribe;
        accountOwners[account] = msg.sender;
        outstandingBribeTotal += bribe;
        totalVotingPower += votingPower;
    }

    /**
     * @notice Signs a DAO vote on this proposal on behalf of an encumbered account that enrolled
     * in the Dark DAO contract. Only the briber can do this!
     * @param account Encumbered account that owns the DAO tokens
     * @param domain EIP-712 domain of the typed data
     * @param dataType Type string of the vote
     * @param data Vote data encoded according to EIP-712
     * @return vote message signed with the account's private key
     */
    function signVote(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        require(msg.sender == briber, "Only the briber signs votes");
        return snapshotEncPolicy.signOnBehalf(account, proposalHash, domain, dataType, data);
    }

    /**
     * @notice Claims a bribe that the account owner earned from selling DAO votes to the briber
     * @param account Encumbered account that owns the DAO tokens
     */
    function claimBribe(address account) public {
        require(msg.sender != address(0) && msg.sender == accountOwners[account], "Only account owner");
        require(bribesPaid[account] == 0, "Bribe already paid");
        require(registeredBribes[account] > 0, "Bribe not registered for this account");
        // Avoid re-entry
        uint256 bribe = registeredBribes[account];
        bribesPaid[account] = bribe;
        outstandingBribeTotal -= bribe;
        payable(msg.sender).transfer(bribe);
    }

    /**
     * @notice Withdraws unused bribe money back to the briber
     */
    function withdrawUnusedFunds() public {
        require(msg.sender == briber);
        payable(msg.sender).transfer(address(this).balance - outstandingBribeTotal);
    }
}
