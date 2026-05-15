// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract RebasingTestToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Rebasing Test Token", "RTEST") {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function negativeRebase(address account, uint256 amount) external {
        _burn(account, amount);
    }
}
