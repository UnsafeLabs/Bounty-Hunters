// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("Mock", "MCK") {
        _mint(msg.sender, initialSupply);
    }
}

contract MaliciousStaker {
    address public vault;
    address public token;

    constructor(address _vault, address _token) {
        vault = _vault;
        token = _token;
    }

    function approveAndStake(uint256 amount) external {
        IERC20(token).approve(vault, amount);
        (bool ok, ) = vault.call(abi.encodeWithSignature("stake(uint256)", amount));
        require(ok, "stake failed");
    }

    function attack() external {
        (bool ok, ) = vault.call(abi.encodeWithSignature("withdraw(uint256)", 1 ether));
        require(ok, "attack failed");
    }

    receive() external payable {
        if (address(vault).balance > 0) {
            (bool ok, ) = vault.call(abi.encodeWithSignature("withdraw(uint256)", 1 ether));
            require(ok, "reentry failed");
        }
    }
}
