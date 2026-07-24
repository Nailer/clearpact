// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClearPactEscrow} from "../src/ClearPactEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

/// Part 3: worker bonds, slashing, and the on-chain track record.
contract StakingIntegrationTest is Test {
    ClearPactEscrow internal escrow;
    ReputationRegistry internal registry;

    address internal arbiter = makeAddr("arbiter");
    address internal buyer = makeAddr("buyer");
    address internal worker = makeAddr("worker");
    address internal verifier = makeAddr("verifier");

    uint256 internal constant AMOUNT = 5 ether;
    uint96 internal constant BOND = 1 ether;
    uint8 internal constant PASS_SCORE = 70;
    uint32 internal constant WINDOW = 1 hours;

    bytes32 internal constant SPEC = keccak256("spec");
    bytes32 internal constant WORK = keccak256("work");
    bytes32 internal constant VERDICT = keccak256("verdict");

    function setUp() public {
        registry = new ReputationRegistry();
        escrow = new ClearPactEscrow(arbiter, registry);
        registry.setEscrow(address(escrow), true);
        vm.deal(buyer, 100 ether);
        vm.deal(worker, 10 ether);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _createBondedJob() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = escrow.createJob{value: AMOUNT}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, BOND
        );
    }

    function _stakeAndDeliver(uint256 jobId) internal {
        vm.prank(worker);
        registry.stake{value: BOND}();
        vm.prank(worker);
        escrow.deliver(jobId, WORK);
    }

    function _verdict(uint256 jobId, uint8 score) internal {
        vm.prank(verifier);
        escrow.submitVerdict(jobId, score, VERDICT);
    }

    // ── Bond mechanics ───────────────────────────────────────────────────

    function test_StakeAndUnstake() public {
        vm.prank(worker);
        registry.stake{value: 2 ether}();
        assertEq(registry.freeStakeOf(worker), 2 ether);

        uint256 before = worker.balance;
        vm.prank(worker);
        registry.unstake(1.5 ether);
        assertEq(registry.freeStakeOf(worker), 0.5 ether);
        assertEq(worker.balance, before + 1.5 ether);
    }

    function test_Deliver_RevertsWithoutBond() public {
        uint256 jobId = _createBondedJob();
        vm.prank(worker);
        vm.expectRevert(ReputationRegistry.InsufficientStake.selector);
        escrow.deliver(jobId, WORK);
    }

    function test_Deliver_LocksBond() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        assertEq(registry.freeStakeOf(worker), 0);
        assertEq(registry.lockedStakeOf(worker), BOND);
        assertEq(registry.totalStakeOf(worker), BOND);
    }

    function test_LockedBond_CannotBeUnstaked() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        vm.prank(worker);
        vm.expectRevert(ReputationRegistry.InsufficientStake.selector);
        registry.unstake(BOND);
    }

    function test_Settle_UnlocksBond_AndRecordsOutcome() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        _verdict(jobId, 90);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId);

        assertEq(registry.lockedStakeOf(worker), 0);
        assertEq(registry.freeStakeOf(worker), BOND);
        (uint64 delivered, uint64 passed,, uint128 earned,) = registry.statsOf(worker);
        assertEq(delivered, 1);
        assertEq(passed, 1);
        assertEq(earned, AMOUNT);
    }

    // ── Slashing ─────────────────────────────────────────────────────────

    function test_Arbitrate_SlashesBondToBuyer() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        _verdict(jobId, 20);
        vm.prank(worker);
        escrow.dispute(jobId);

        uint256 buyerBefore = buyer.balance;
        vm.prank(arbiter);
        // Worker loses: 10% of escrow, half the bond slashed to the buyer.
        escrow.arbitrate(jobId, 1_000, 5_000);

        // Buyer: 90% of escrow + half the bond.
        assertEq(buyer.balance, buyerBefore + (AMOUNT * 9) / 10 + BOND / 2);
        // Worker keeps the other half of the bond, unlocked.
        assertEq(registry.freeStakeOf(worker), BOND / 2);
        assertEq(registry.lockedStakeOf(worker), 0);

        (,, uint64 disputesLost,,) = registry.statsOf(worker);
        assertEq(disputesLost, 1);
    }

    function testFuzz_ArbitrateWithSlash_ConservesAllFunds(uint256 workerBps, uint256 slashBps) public {
        workerBps = bound(workerBps, 0, 10_000);
        slashBps = bound(slashBps, 0, 10_000);

        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        _verdict(jobId, 10);
        vm.prank(buyer);
        escrow.dispute(jobId);

        uint256 buyerBefore = buyer.balance;
        uint256 workerBefore = worker.balance;
        vm.prank(arbiter);
        escrow.arbitrate(jobId, workerBps, slashBps);

        // escrow + bond fully accounted for across buyer wallet, worker wallet, free stake
        uint256 buyerGain = buyer.balance - buyerBefore;
        uint256 workerGain = worker.balance - workerBefore;
        assertEq(buyerGain + workerGain + registry.freeStakeOf(worker), AMOUNT + BOND);
        assertEq(address(escrow).balance, 0);
        assertEq(registry.lockedStakeOf(worker), 0);
    }

    // ── Reputation formula ───────────────────────────────────────────────

    function test_Reputation_NewcomerIsNeutral() public view {
        assertEq(registry.reputationScore(worker), 50);
    }

    function test_Reputation_GrowsWithGoodWork() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        _verdict(jobId, 90);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId);
        // avg 90, pass rate 100 → (90+100)/2 = 95
        assertEq(registry.reputationScore(worker), 95);
    }

    function test_Reputation_DropsOnDisputeLoss() public {
        uint256 jobId = _createBondedJob();
        _stakeAndDeliver(jobId);
        _verdict(jobId, 20);
        vm.prank(worker);
        escrow.dispute(jobId);
        vm.prank(arbiter);
        escrow.arbitrate(jobId, 0, 10_000);
        // avg 20, pass 0 → base 10; penalty 10 → 0
        assertEq(registry.reputationScore(worker), 0);
    }

    function test_Reputation_PenaltyIsCapped() public {
        // 6 lost disputes on otherwise perfect work: penalty caps at 40.
        for (uint256 i; i < 6; i++) {
            uint256 jobId = _createBondedJob();
            _stakeAndDeliver(jobId);
            _verdict(jobId, 100);
            vm.prank(buyer);
            escrow.dispute(jobId);
            vm.prank(arbiter);
            escrow.arbitrate(jobId, 0, 0); // worker loses, bond returned
        }
        // avg 100, pass 0 → base 50; penalty capped 40 → 10
        assertEq(registry.reputationScore(worker), 10);
    }

    // ── Authorization ────────────────────────────────────────────────────

    function test_UnauthorizedEscrow_CannotTouchRegistry() public {
        vm.startPrank(makeAddr("rogue"));
        vm.expectRevert(ReputationRegistry.NotAuthorized.selector);
        registry.lockStake(worker, 1);
        vm.expectRevert(ReputationRegistry.NotAuthorized.selector);
        registry.slash(worker, 1, buyer);
        vm.expectRevert(ReputationRegistry.NotAuthorized.selector);
        registry.recordOutcome(worker, 100, true, 1);
        vm.stopPrank();
    }

    function test_OnlyOwner_CanAuthorizeEscrow() public {
        vm.prank(makeAddr("rogue"));
        vm.expectRevert(ReputationRegistry.NotAuthorized.selector);
        registry.setEscrow(makeAddr("fake"), true);
    }
}
