// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function attackDelegate(address to) external {
        // Will fail because msg.sender is now the PhishingContract,
        // which has 0 balance and is not the original tx.origin
        token.delegateVote(to);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public hacker = address(0x3);

    function setUp() public {
        token = new GovernanceToken(10000 ether);
        token.transfer(user1, 1000 ether);
        token.transfer(user2, 1000 ether);
    }

    function test_PhishingProtection() public {
        PhishingContract phishing = new PhishingContract(token);

        // User1 is tricked into interacting with the phishing contract
        vm.prank(user1, user1); // Set msg.sender and tx.origin to user1
        
        // Attack should only delegate phishing contract's votes (0)
        phishing.attackDelegate(hacker);

        // Verify hacker got no delegated power from user1
        assertEq(token.delegatedPower(hacker), 0);
        assertEq(token.delegates(user1), address(0));
    }

    function test_LegitimateDelegation() public {
        vm.prank(user1);
        token.delegateVote(user2);

        assertEq(token.delegates(user1), user2);
        assertEq(token.delegatedPower(user2), 1000 ether);
        assertEq(token.getVotingPower(user2), 2000 ether); // 1000 own + 1000 delegated
        assertEq(token.getVotingPower(user1), 0); // Delegated away
    }

    function test_RevokeDelegation() public {
        vm.startPrank(user1);
        token.delegateVote(user2);
        token.revokeDelegate();
        vm.stopPrank();

        assertEq(token.delegates(user1), address(0));
        assertEq(token.delegatedPower(user2), 0);
        assertEq(token.getVotingPower(user2), 1000 ether);
        assertEq(token.getVotingPower(user1), 1000 ether);
    }
}
