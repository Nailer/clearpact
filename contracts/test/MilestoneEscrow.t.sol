// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

contract MilestoneEscrowTest is Test {
    MilestoneEscrow internal escrow;
    ReputationRegistry internal registry;

    address internal arbiter = makeAddr("arbiter");
    address internal buyer = makeAddr("buyer");
    address internal worker = makeAddr("worker");
    address internal verifier = makeAddr("verifier");

    uint8 internal constant PASS_SCORE = 70;
    uint32 internal constant WINDOW = 1 hours;
    bytes32 internal constant SPEC = keccak256("3-milestone dataset job");
    uint256 internal constant WORKER_START = 10 ether; // vm.deal in setUp, for bond flexibility

    function setUp() public {
        registry = new ReputationRegistry();
        escrow = new MilestoneEscrow(arbiter, registry);
        registry.setEscrow(address(escrow), true);
        vm.deal(buyer, 100 ether);
        vm.deal(worker, 10 ether);
    }

    function _amounts() internal pure returns (uint96[] memory a) {
        a = new uint96[](3);
        a[0] = 1 ether;
        a[1] = 2 ether;
        a[2] = 3 ether;
    }

    function _createJob(uint96 bond) internal returns (uint256 jobId) {
        uint96[] memory amounts = _amounts();
        uint256 total;
        for (uint256 i; i < amounts.length; i++) total += amounts[i];
        vm.prank(buyer);
        jobId = escrow.createJob{value: total}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, bond, amounts
        );
    }

    function _deliver(uint256 jobId, uint256 i) internal {
        vm.prank(worker);
        escrow.deliver(jobId, i, keccak256(abi.encodePacked("work", i)));
    }

    function _verdict(uint256 jobId, uint256 i, uint8 score) internal {
        vm.prank(verifier);
        escrow.submitVerdict(jobId, i, score, keccak256(abi.encodePacked("verdict", i)));
    }

    // ── Happy path ───────────────────────────────────────────────────────

    function test_ThreeMilestones_AllPass_StreamPaid() public {
        uint256 jobId = _createJob(0);
        uint96[] memory amounts = _amounts();

        for (uint256 i; i < 3; i++) {
            _deliver(jobId, i);
            _verdict(jobId, i, 90);
            vm.warp(block.timestamp + WINDOW + 1);
            escrow.settle(jobId, i);
            assertEq(worker.balance, WORKER_START + _sum(amounts, i + 1));
        }
    }

    function _sum(uint96[] memory a, uint256 upTo) internal pure returns (uint256 s) {
        for (uint256 i; i < upTo; i++) s += a[i];
    }

    function test_MilestonesReleaseIndependently_NotAllAtOnce() public {
        uint256 jobId = _createJob(0);
        _deliver(jobId, 0);
        _verdict(jobId, 0, 90);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId, 0);
        assertEq(worker.balance, WORKER_START + 1 ether);

        // Milestone 1 not yet delivered — must not be settleable.
        vm.expectRevert(MilestoneEscrow.WrongStatus.selector);
        escrow.settle(jobId, 1);
    }

    function test_OneMilestoneFails_RefundsOnlyThatChunk() public {
        uint256 jobId = _createJob(0);
        _deliver(jobId, 0);
        _verdict(jobId, 0, 30); // fails

        vm.warp(block.timestamp + WINDOW + 1);
        uint256 buyerBefore = buyer.balance;
        escrow.settle(jobId, 0);
        assertEq(buyer.balance, buyerBefore + 1 ether);
        assertEq(worker.balance, WORKER_START);
    }

    // ── Bond ─────────────────────────────────────────────────────────────

    function test_BondLockedOnceAcrossAllMilestones() public {
        vm.prank(worker);
        registry.stake{value: 1 ether}();

        uint256 jobId = _createJob(1 ether);
        _deliver(jobId, 0);
        assertEq(registry.lockedStakeOf(worker), 1 ether);

        // Delivering milestone 2 must not lock a second bond.
        _deliver(jobId, 1);
        assertEq(registry.lockedStakeOf(worker), 1 ether);
    }

    function test_Deliver_RevertsWithoutBond() public {
        uint256 jobId = _createJob(1 ether);
        vm.prank(worker);
        vm.expectRevert(ReputationRegistry.InsufficientStake.selector);
        escrow.deliver(jobId, 0, keccak256("x"));
    }

    function test_BondReturned_OnlyAfterAllMilestonesResolved() public {
        vm.prank(worker);
        registry.stake{value: 1 ether}();
        uint256 jobId = _createJob(1 ether);

        _deliver(jobId, 0);
        _verdict(jobId, 0, 90);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId, 0);
        assertEq(registry.lockedStakeOf(worker), 1 ether, "bond still locked after 1 of 3");

        _deliver(jobId, 1);
        _verdict(jobId, 1, 90);
        _deliver(jobId, 2);
        _verdict(jobId, 2, 90);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId, 1);
        escrow.settle(jobId, 2);
        assertEq(registry.lockedStakeOf(worker), 0, "bond released after final milestone");
        assertEq(registry.freeStakeOf(worker), 1 ether);
    }

    // ── Disputes on a single milestone ──────────────────────────────────

    function test_DisputeOneMilestone_DoesNotBlockOthers() public {
        uint256 jobId = _createJob(0);
        _deliver(jobId, 0);
        _verdict(jobId, 0, 20);
        vm.prank(worker);
        escrow.dispute(jobId, 0);

        // Milestone 1 is untouched by milestone 0's dispute.
        _deliver(jobId, 1);
        _verdict(jobId, 1, 95);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId, 1);
        assertEq(worker.balance, WORKER_START + 2 ether);
    }

    function test_Arbitrate_SlashesSharedBond() public {
        vm.prank(worker);
        registry.stake{value: 1 ether}();
        uint256 jobId = _createJob(1 ether);

        _deliver(jobId, 0);
        _verdict(jobId, 0, 10);
        vm.prank(buyer);
        escrow.dispute(jobId, 0);

        vm.prank(arbiter);
        escrow.arbitrate(jobId, 0, 0, 5_000); // worker gets 0%, half the bond slashed

        assertEq(registry.lockedStakeOf(worker), 0.5 ether);
        (,, uint64 disputesLost,,) = registry.statsOf(worker);
        assertEq(disputesLost, 1);
    }

    // ── Conservation ─────────────────────────────────────────────────────

    function testFuzz_AllMilestonesResolveSomehow_ConservesFunds(uint8 s0, uint8 s1, uint8 s2) public {
        uint256 jobId = _createJob(0);
        uint96[] memory amounts = _amounts();
        uint256 total = _sum(amounts, 3);
        uint256 buyerBefore = buyer.balance;

        uint8[3] memory scores = [uint8(bound(s0, 0, 100)), uint8(bound(s1, 0, 100)), uint8(bound(s2, 0, 100))];
        for (uint256 i; i < 3; i++) {
            _deliver(jobId, i);
            _verdict(jobId, i, scores[i]);
            vm.warp(block.timestamp + WINDOW + 1);
            escrow.settle(jobId, i);
        }

        assertEq((worker.balance - WORKER_START) + (buyer.balance - buyerBefore), total);
        assertEq(address(escrow).balance, 0);
    }

    // ── Guards ───────────────────────────────────────────────────────────

    function test_CreateJob_RevertsOnAmountMismatch() public {
        uint96[] memory amounts = _amounts();
        vm.prank(buyer);
        vm.expectRevert(MilestoneEscrow.ZeroAmount.selector);
        escrow.createJob{value: 1 ether}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0, amounts
        );
    }

    function test_CreateJob_RevertsOnEmptyMilestones() public {
        uint96[] memory empty = new uint96[](0);
        vm.prank(buyer);
        vm.expectRevert(MilestoneEscrow.NoMilestones.selector);
        escrow.createJob{value: 0}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0, empty
        );
    }

    function test_OnlyWorker_CanDeliverMilestone() public {
        uint256 jobId = _createJob(0);
        vm.prank(buyer);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        escrow.deliver(jobId, 0, keccak256("x"));
    }

    function test_CreateJob3_ScalarOverload_MatchesArrayVersion() public {
        vm.prank(buyer);
        uint256 jobId = escrow.createJob3{value: 6 ether}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0, 1 ether, 2 ether, 3 ether
        );
        assertEq(escrow.milestoneCount(jobId), 3);
        assertEq(escrow.getMilestone(jobId, 0).amount, 1 ether);
        assertEq(escrow.getMilestone(jobId, 2).amount, 3 ether);
    }

    function test_InvalidMilestoneIndex_Reverts() public {
        uint256 jobId = _createJob(0);
        vm.prank(worker);
        vm.expectRevert(MilestoneEscrow.BadParams.selector);
        escrow.deliver(jobId, 5, keccak256("x"));
    }
}
