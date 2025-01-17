// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import "../wallet/IEncumbrancePolicy.sol";
import "../wallet/IEncumberedWallet.sol";

struct SnapshotVote2 {
    address from;
    bytes32 space;
    uint64 timestamp;
    bytes32 proposal;
    uint32 choice;
    bytes32 reason;
    bytes32 app;
    bytes32 metadata;
}

interface ISnapshotEncumbrancePolicy {
    function amVoteSigner(
        address account,
        bytes32 proposal,
        address sender,
        uint256 startTimestamp,
        uint256 endTimestamp
    ) external view returns (bool);

    function signOnBehalf(
        address account,
        bytes32 proposal,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) external view returns (bytes memory);
}

contract SnapshotEncumbrancePolicy is IEncumbrancePolicy, EIP712 {
    IEncumberedWallet public walletContract;
    mapping(address => address) private accountOwner;
    mapping(address => uint256) private enrollmentTimestamp;
    mapping(address => uint256) private encumbranceExpiration;
    mapping(address => mapping(bytes32 => address)) private allowedVoteSigner;
    mapping(address => mapping(bytes32 => uint256)) private voteSignerTimestamp;

    constructor(IEncumberedWallet encumberedWallet) EIP712("SnapshotEncumbrancePolicy", "0.0.1") {
        walletContract = encumberedWallet;
    }

    function notifyEncumbranceEnrollment(
        address _accountOwner,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata
    ) public {
        require(msg.sender == address(walletContract), "Not wallet contract");
        require(expiration >= block.timestamp, "Expiration is in the past");

        EIP712DomainParams memory snapshotDomain = EIP712DomainParams({
            name: "snapshot",
            // Other parameters are not used
            version: "",
            chainId: 0,
            verifyingContract: address(0),
            salt: bytes32(uint256(0)),
            usedParamsMask: 1
        });
        bytes32 snapshotDomainAsset = walletContract.findEip712Asset(snapshotDomain, "", bytes(""));
        bool assetFound = false;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == snapshotDomainAsset) {
                assetFound = true;
                break;
            }
        }

        require(assetFound, "Required asset not provided");

        encumbranceExpiration[account] = expiration;
        enrollmentTimestamp[account] = block.timestamp;
        accountOwner[account] = _accountOwner;
    }

    // Try to prevent leaking to the caller of an allowed vote signer
    function amVoteSigner(
        address account,
        bytes32 proposal,
        address sender,
        uint256 startTimestamp,
        uint256 endTimestamp
    ) public view returns (bool) {
        require(accountOwner[account] == sender, "Unauthorized");
        require(enrollmentTimestamp[account] <= startTimestamp, "Enrollment too late");
        require(encumbranceExpiration[account] >= endTimestamp, "Encumbrance period too short");
        return allowedVoteSigner[account][proposal] == msg.sender;
    }

    function signOnBehalf(
        address account,
        bytes32 proposal,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        // Note that in the case of self-authorizations, wallet owners can just
        // sign through the wallet contract directly
        require(msg.sender == allowedVoteSigner[account][proposal], "Wrong vote signer");
        require(keccak256(bytes(domain.name)) == keccak256(bytes("snapshot")), "Not a snapshot message");
        require(keccak256(bytes(dataType[:4])) == keccak256(bytes("Vote")), "Not a snapshot Vote");
        require(data.length == 256, "Incorrect vote data length");
        SnapshotVote2 memory vote = abi.decode(data, (SnapshotVote2));
        require(vote.proposal == proposal, "Wrong proposal");
        return walletContract.signTypedData(account, domain, dataType, data);
    }

    function selfVoteSigner(address account, bytes32 proposal) public {
        setVoteSigner(account, proposal, msg.sender);
    }

    function setVoteSigner(address account, bytes32 proposal, address signer) public {
        require(accountOwner[account] == msg.sender, "Only account owner");
        require(signer != address(0), "Zero address");
        require(allowedVoteSigner[account][proposal] == address(0), "Vote signer already set");
        allowedVoteSigner[account][proposal] = signer;
        voteSignerTimestamp[account][proposal] = block.timestamp;
    }

    function signVote(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public view returns (bytes memory) {
        bytes32 proposal = findEip712Asset(domain, dataType, data);
        require(proposal != bytes32(0), "Vote message not recognized");

        address voteSigner = allowedVoteSigner[account][proposal];
        require(voteSigner == accountOwner[account], "Sender not authorized for this proposal");
        uint256 voteTimestamp = voteSignerTimestamp[account][proposal];
        require(block.timestamp > voteTimestamp, "Signing is unlocked in the next block");
        return walletContract.signTypedData(account, domain, dataType, data);
    }

    function findAsset(bytes calldata) external pure returns (bytes32) {
        // We don't deal with non-EIP-712 messages
        return bytes32(0);
    }

    // Doubles as finding the proposal associated with the vote message
    function findEip712Asset(
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) public pure returns (bytes32) {
        // Only deal with Snapshot messages
        if (keccak256(bytes(domain.name)) != keccak256(bytes("snapshot"))) {
            return bytes32(0);
        }

        // Recognized message types (currently, only Vote)
        if (keccak256(bytes(dataType[:4])) == keccak256(bytes("Vote"))) {
            if (keccak256(bytes(dataType)) == 0xaeb61c95cf08a4ae90fd703eea32d24d7936280c3c5b611ad2c40211583d4c85) {
                if (data.length != 256) {
                    // Incorrect data length
                    return 0;
                }
                SnapshotVote2 memory vote = abi.decode(data, (SnapshotVote2));
                // Vote was decoded successfully
                return vote.proposal;
            }
            // Unrecognized vote type
            return 0;
        }
        return 0;
    }
}
