// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/TokenVesting.sol";

interface Vm {
    function prank(address msgSender) external;
    function warp(uint256 newTimestamp) external;
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TokenVestingTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private beneficiary = address(0xBEEF);
    MockERC20 private token;

    function _newVesting(uint256 allocation, uint256 start, uint256 cliffDuration, uint256 duration)
        private
        returns (TokenVesting vesting)
    {
        vesting = new TokenVesting(address(token), beneficiary, allocation, start, cliffDuration, duration);
        token.mint(address(vesting), allocation);
    }

    function setUp() public {
        token = new MockERC20("Token", "TKN");
        vm.warp(1_000);
    }

    function testMaximumAllocationVestingDoesNotOverflow() public {
        uint256 allocation = 1_000_000_000 ether;
        TokenVesting vesting = _newVesting(allocation, block.timestamp, 0, 1_000 days);

        vm.warp(block.timestamp + 500 days);

        require(vesting.vestedAmount() == allocation / 2, "wrong max allocation vesting");
    }

    function testRemainderAccuracyAndFullCompletion() public {
        TokenVesting vesting = _newVesting(10, block.timestamp, 0, 3);

        vm.warp(block.timestamp + 1);
        require(vesting.vestedAmount() == 3, "wrong first remainder step");

        vm.warp(block.timestamp + 1);
        require(vesting.vestedAmount() == 6, "wrong second remainder step");

        vm.warp(block.timestamp + 1);
        require(vesting.vestedAmount() == 10, "full vesting did not complete");
    }

    function testRevocationDuringCliffReturnsFullUnclaimedAllocation() public {
        uint256 allocation = 1_000 ether;
        TokenVesting vesting = _newVesting(allocation, block.timestamp, 100 days, 1_000 days);
        uint256 ownerBefore = token.balanceOf(address(this));

        vm.warp(block.timestamp + 10 days);
        vesting.revoke();

        require(token.balanceOf(beneficiary) == 0, "beneficiary paid during cliff");
        require(token.balanceOf(address(this)) == ownerBefore + allocation, "owner missing unvested cliff tokens");
    }

    function testPostCliffRevocationPaysOnlyUnclaimedVestedTokens() public {
        uint256 allocation = 1_000 ether;
        TokenVesting vesting = _newVesting(allocation, block.timestamp, 0, 1_000 days);

        vm.warp(block.timestamp + 100 days);
        vm.prank(beneficiary);
        vesting.claim();

        vm.warp(block.timestamp + 300 days);
        uint256 ownerBefore = token.balanceOf(address(this));
        vesting.revoke();

        require(token.balanceOf(beneficiary) == 400 ether, "beneficiary missing vested tokens");
        require(token.balanceOf(address(this)) == ownerBefore + 600 ether, "owner got wrong unvested amount");
    }

    function testFullVestingClaimPaysTotalAllocation() public {
        uint256 allocation = 1_000 ether;
        TokenVesting vesting = _newVesting(allocation, block.timestamp, 0, 1_000 days);

        vm.warp(block.timestamp + 1_000 days);
        vm.prank(beneficiary);
        vesting.claim();

        require(token.balanceOf(beneficiary) == allocation, "full allocation not claimed");
        require(vesting.claimed() == allocation, "claimed not updated");
    }
}
