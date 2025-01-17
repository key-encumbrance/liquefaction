// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract DarkDAOToken is ERC20, ERC20Permit {
    address public underlyingToken;
    address public darkDaoSigner;
    mapping(uint256 => uint256) mints;
    mapping(bytes32 => uint256) withdrawalAmounts;

    event Withdrawal(address indexed sender, uint256 amount, bytes32 indexed nonceHash);

    constructor(
        address _underlyingToken,
        address _darkDaoSigner
    ) ERC20("Dark DAO Token", "DDT") ERC20Permit("Dark DAO Token") {
        underlyingToken = _underlyingToken;
        darkDaoSigner = _darkDaoSigner;
    }

    function finalizeDeposit(
        address recipientAddress,
        uint256 amount,
        uint256 depositId,
        bytes memory signature
    ) public {
        // Verify signature
        bytes32 hash = keccak256(abi.encode("deposit", recipientAddress, amount, depositId));
        (address recovered, ECDSA.RecoverError error, ) = ECDSA.tryRecover(hash, signature);
        require(error == ECDSA.RecoverError.NoError && recovered == darkDaoSigner, "Invalid signature or wrong signer");

        require(mints[depositId] == 0, "Tokens already minted");
        mints[depositId] = 1;

        _mint(recipientAddress, amount);
    }

    function beginWithdrawal(uint256 amount, bytes32 nonceHash) public {
        require(amount > 0, "Withdrawal amount must be positive");
        _burn(msg.sender, amount);
        bytes32 hash = keccak256(abi.encode("withdrawal", msg.sender, amount, nonceHash));
        require(withdrawalAmounts[hash] == 0, "Use a different nonce");
        withdrawalAmounts[hash] = amount;

        emit Withdrawal(msg.sender, amount, nonceHash);
    }
}
