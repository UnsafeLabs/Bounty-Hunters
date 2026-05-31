// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GovernanceToken.sol";

interface Vm {
    function expectRevert() external;
    function prank(address msgSender) external;
}

contract PhishingContract {
    GovernanceToken private token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function phish(address to) external {
        token.delegateVote(to);
    }
}

contract ContractWallet {
    GovernanceToken private token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function delegate(address to) external {
        token.delegateVote(to);
    }

    function revoke() external {
        token.revokeDelegate();
    }
}

contract GovernanceTokenTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    GovernanceToken private token;

    address private victim = address(0xBEEF);
    address private delegatee = address(0xCAFE);
    address private attacker = address(0xBAD);

    function setUp() public {
        token = new GovernanceToken(1_000 ether);
        token.transfer(victim, 100 ether);
    }

    function testPhishingContractCannotDelegateVictimVotes() public {
        PhishingContract phishing = new PhishingContract(token);

        vm.prank(victim);
        phishing.phish(attacker);

        require(token.delegates(victim) == address(0), "victim delegated through phishing");
        require(token.delegatedPower(attacker) == 0, "attacker gained victim votes");
        require(token.getVotingPower(victim) == 100 ether, "victim lost own voting power");
    }

    function testDirectDelegationAndRevokeUseMsgSender() public {
        vm.prank(victim);
        token.delegateVote(delegatee);

        require(token.delegates(victim) == delegatee, "delegate not stored");
        require(token.getVotingPower(victim) == 0, "delegator kept voting power");
        require(token.getVotingPower(delegatee) == 100 ether, "delegate missing power");

        vm.prank(victim);
        token.revokeDelegate();

        require(token.delegates(victim) == address(0), "delegate not revoked");
        require(token.getVotingPower(victim) == 100 ether, "victim power not restored");
        require(token.getVotingPower(delegatee) == 0, "delegate power not removed");
    }

    function testLegitimateContractWalletCanDelegateItsOwnVotes() public {
        ContractWallet wallet = new ContractWallet(token);
        token.transfer(address(wallet), 50 ether);

        wallet.delegate(delegatee);

        require(token.delegates(address(wallet)) == delegatee, "wallet delegate missing");
        require(token.getVotingPower(address(wallet)) == 0, "wallet kept delegated power");
        require(token.getVotingPower(delegatee) == 50 ether, "delegate missing wallet power");
    }

    function testOnlyOwnerCanSnapshot() public {
        vm.prank(victim);
        vm.expectRevert();
        token.snapshot();

        token.snapshot();
    }

    function testDelegatedVoteCountsForProposal() public {
        vm.prank(victim);
        token.delegateVote(delegatee);

        uint256 proposalId = token.createProposal("ship it", 1 days);

        vm.prank(delegatee);
        token.vote(proposalId, true);

        (, uint256 forVotes,,,) = token.proposals(proposalId);
        require(forVotes == 100 ether, "delegated vote not counted");
    }
}
