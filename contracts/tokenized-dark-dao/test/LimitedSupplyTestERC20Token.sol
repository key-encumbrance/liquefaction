// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract LimitedSupplyTestERC20Token is ERC20, ERC20Permit {
    constructor() ERC20("Test DAO Token", "DAO") ERC20Permit("Test DAO Token") {
        _mint(msg.sender, 600 * 10 ** 18);
    }
}
