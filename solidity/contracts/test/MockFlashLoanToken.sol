// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFlashLoanToken is ERC20 {
    constructor() ERC20("Mock Flash Loan Token", "MFLT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RebasingFlashLoanToken is MockFlashLoanToken {
    function rebase() external {
        _mint(address(0xBEEF), 1);
    }
}
