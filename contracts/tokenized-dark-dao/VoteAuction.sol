// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

struct Bid {
    uint256 bidValue;
    address bidder;
}

contract VoteAuction {
    mapping(bytes32 => uint256) private auctionEnds;
    mapping(bytes32 => Bid) private currentBid;
    mapping(address => uint256) private deposited;
    uint256 public minimumBid;
    uint256 public auctionDuration;
    uint256 private totalAuctionEarnings;

    event AuctionCreated(bytes32 indexed hash, uint256 auctionEnd);
    event BidSubmitted(bytes32 indexed hash, uint256 value);

    constructor(uint256 _minimumBid, uint256 _auctionDuration) {
        minimumBid = _minimumBid;
        auctionDuration = _auctionDuration;
    }

    function getTotalAuctionEarnings() internal view returns (uint256) {
        return totalAuctionEarnings;
    }

    function createAuction(bytes32 hash) public payable {
        require(auctionEnds[hash] == 0, "Auction already initialized");
        auctionEnds[hash] = block.timestamp + auctionDuration;
        emit AuctionCreated(hash, auctionEnds[hash]);
        if (msg.value > 0) {
            bid(hash, msg.value);
        }
    }

    function getMaxBid(bytes32 hash) public view returns (uint256) {
        return currentBid[hash].bidValue;
    }

    function bid(bytes32 hash, uint256 bidValue) public payable {
        deposited[msg.sender] += msg.value;
        require(block.timestamp < auctionEnds[hash], "Auction has ended");
        require(bidValue >= minimumBid, "You must bid at least the minimum");
        require(bidValue > currentBid[hash].bidValue, "Bid must be higher than the current highest bid");
        if (currentBid[hash].bidValue > 0 && currentBid[hash].bidder != address(0)) {
            // Add to refund
            deposited[currentBid[hash].bidder] += currentBid[hash].bidValue;
        }
        require(bidValue <= deposited[msg.sender], "Bid value greater than deposited amount");
        deposited[msg.sender] -= bidValue;
        totalAuctionEarnings += bidValue - currentBid[hash].bidValue;
        currentBid[hash] = Bid({bidValue: bidValue, bidder: msg.sender});
        emit BidSubmitted(hash, msg.value);
    }

    function getAuctionWinner(bytes32 hash) internal view returns (address) {
        require(auctionEnds[hash] > 0, "Auction has not started");
        require(block.timestamp >= auctionEnds[hash], "Auction has not ended");
        return currentBid[hash].bidder;
    }

    function withdrawExcess() public {
        uint256 refund = deposited[msg.sender];
        deposited[msg.sender] = 0;
        payable(msg.sender).transfer(refund);
    }
}
