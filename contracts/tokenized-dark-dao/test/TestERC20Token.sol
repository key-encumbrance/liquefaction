// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract TestERC20Token is ERC20, ERC20Permit {
    constructor() ERC20("Test DAO Token", "DAO") ERC20Permit("Test DAO Token") {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
}
