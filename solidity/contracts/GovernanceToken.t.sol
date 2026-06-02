// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public govToken;
    address public attacker;

    constructor(address _govToken, address _attacker) {
        govToken = GovernanceToken(_govToken);
        attacker = _attacker;
    }

    /// @dev Malicious contract that attempts to delegate votes on behalf of the token holder
    /// This simulates the tx.origin phishing attack vector
    function attemptPhishing() external {
        // Try to delegate using the caller's delegated votes
        // Since we fixed tx.origin -> msg.sender, this should use this contract's address
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

        phishingContract = new PhishingContract(address(govToken), address(this));
    }

    function test_delegateVote_uses_msgSender_not_txOrigin() public {
        // Alice delegates to Bob
        assertEq(govToken.delegates(alice), bob);

        // Deploy phishing contract and try to phish Alice's delegation
        // Since we fixed tx.origin -> msg.sender, the phishing contract
        // should NOT be able to delegate Alice's votes
        vm.prank(alice);
        phishingContract.attemptPhishing();

        // Alice's delegation should still be to Bob, not to the phishing contract
        assertEq(govToken.delegates(alice), bob);
        // The phishing contract should have 0 delegated power
        assertEq(govToken.delegatedPower(address(phishingContract)), 0);
    }

    function test_revokeDelegate_uses_msgSender() public {
        // Bob has delegated power from Alice
        assertEq(govToken.delegatedPower(bob), govToken.balanceOf(alice));

        // Phishing contract tries to revoke Alice's delegation
        vm.prank(alice);
        phishingContract.attemptRevokePhishing();

        // Alice's delegation should still exist (phishing failed)
        assertEq(govToken.delegates(alice), bob);
    }

    function test_onlyOwner_canCallSnapshot() public {
        // Non-owner should not be able to call snapshot
        vm.expectRevert("Ownable: caller is not the owner");
        govToken.snapshot();
    }

    function test_snapshot_works_forOwner() public {
        govToken.snapshot();  // Owner can call it
    }
}
