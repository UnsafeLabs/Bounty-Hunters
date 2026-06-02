// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public govToken;

    constructor(address _govToken) {
        govToken = GovernanceToken(_govToken);
    }

    /// @dev Malicious contract that attempts to delegate votes on behalf of the token holder
    function attemptPhishing() external {
        govToken.delegateVote(address(this));
    }

    /// @dev Try to revoke delegation of the token holder
    function attemptRevokePhishing() external {
        govToken.revokeDelegate();
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public govToken;
    address public alice = address(0x1);
    address public bob = address(0x2);
    PhishingContract public phishingContract;

    function setUp() public {
        govToken = new GovernanceToken(1000 ether);
        vm.prank(alice);
        govToken.delegateVote(bob);
        phishingContract = new PhishingContract(address(govToken));
    }

    function test_delegateVote_uses_msgSender_not_txOrigin() public {
        assertEq(govToken.delegates(alice), bob);
        vm.prank(alice);
        phishingContract.attemptPhishing();
        assertEq(govToken.delegates(alice), bob);
        assertEq(govToken.delegatedPower(address(phishingContract)), 0);
    }

    function test_revokeDelegate_uses_msgSender() public {
        assertEq(govToken.delegatedPower(bob), govToken.balanceOf(alice));
        vm.prank(alice);
        phishingContract.attemptRevokePhishing();
        assertEq(govToken.delegates(alice), bob);
    }

    function test_onlyOwner_canCallSnapshot() public {
        vm.expectRevert("Ownable: caller is not the owner");
        govToken.snapshot();
    }

    function test_snapshot_works_forOwner() public {
        govToken.snapshot();
    }
}
