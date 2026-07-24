// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClearPactEscrow} from "../src/ClearPactEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

contract ClearPactEscrowTest is Test {
    ClearPactEscrow internal escrow;
    ReputationRegistry internal registry;

    address internal arbiter = makeAddr("arbiter");
    address internal buyer = makeAddr("buyer");
    address internal worker = makeAddr("worker");
    address internal verifier = makeAddr("verifier");

    uint256 internal constant AMOUNT = 5 ether; // 5 USDC (native, 18 decimals on Arc)
    uint8 internal constant PASS_SCORE = 70;
    uint32 internal constant WINDOW = 1 hours;

    bytes32 internal constant SPEC = keccak256("spec: summarize dataset X; criteria: >=95% coverage");
    bytes32 internal constant WORK = keccak256("deliverable payload");
    bytes32 internal constant VERDICT = keccak256("signed verdict blob");

    function setUp() public {
        registry = new ReputationRegistry();
        escrow = new ClearPactEscrow(arbiter, registry);
        registry.setEscrow(address(escrow), true);
        vm.deal(buyer, 100 ether);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = escrow.createJob{value: AMOUNT}(
            worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0
        );
    }

    function _deliver(uint256 jobId) internal {
        vm.prank(worker);
        escrow.deliver(jobId, WORK);
    }

    function _verdict(uint256 jobId, uint8 score) internal {
        vm.prank(verifier);
        escrow.submitVerdict(jobId, score, VERDICT);
    }

    function _status(uint256 jobId) internal view returns (ClearPactEscrow.Status) {
        return escrow.getJob(jobId).status;
    }

    // ── Happy path ───────────────────────────────────────────────────────

    function test_FullLifecycle_PassingVerdict_PaysWorker() public {
        uint256 jobId = _createJob();
        assertEq(address(escrow).balance, AMOUNT);

        _deliver(jobId);
        _verdict(jobId, 92);

        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId);

        assertEq(worker.balance, AMOUNT);
        assertEq(address(escrow).balance, 0);
        assertTrue(_status(jobId) == ClearPactEscrow.Status.Released);
    }

    function test_FailingVerdict_RefundsBuyer() public {
        uint256 jobId = _createJob();
        uint256 buyerBefore = buyer.balance;

        _deliver(jobId);
        _verdict(jobId, 30);

        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId);

        assertEq(buyer.balance, buyerBefore + AMOUNT);
        assertTrue(_status(jobId) == ClearPactEscrow.Status.Refunded);
    }

    function test_ExactPassScore_Passes() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, PASS_SCORE);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.settle(jobId);
        assertEq(worker.balance, AMOUNT);
    }

    function test_BuyerFastPath_AcceptDelivery() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        vm.prank(buyer);
        escrow.acceptDelivery(jobId);
        assertEq(worker.balance, AMOUNT);
        assertTrue(_status(jobId) == ClearPactEscrow.Status.Released);
    }

    // ── Expiry ───────────────────────────────────────────────────────────

    function test_CancelExpired_RefundsBuyer() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 2 days);
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        escrow.cancelExpired(jobId);
        assertEq(buyer.balance, buyerBefore + AMOUNT);
    }

    function test_CancelExpired_RevertsBeforeDeadline() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        vm.expectRevert();
        escrow.cancelExpired(jobId);
    }

    function test_Deliver_RevertsAfterDeadline() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 2 days);
        vm.prank(worker);
        vm.expectRevert(ClearPactEscrow.DeadlinePassed.selector);
        escrow.deliver(jobId, WORK);
    }

    // ── Disputes ─────────────────────────────────────────────────────────

    function test_Dispute_ThenArbitrate_SplitsFunds() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 30);

        uint256 buyerBefore = buyer.balance;
        vm.prank(worker);
        escrow.dispute(jobId);
        assertTrue(_status(jobId) == ClearPactEscrow.Status.Disputed);

        vm.prank(arbiter);
        escrow.arbitrate(jobId, 2_500, 0); // 25% to worker, no bond staked

        assertEq(worker.balance, AMOUNT / 4);
        assertEq(buyer.balance, buyerBefore + (AMOUNT * 3) / 4);
        assertTrue(_status(jobId) == ClearPactEscrow.Status.Resolved);
    }

    function test_Dispute_RevertsAfterWindow() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 30);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(worker);
        vm.expectRevert(ClearPactEscrow.DisputeWindowClosed.selector);
        escrow.dispute(jobId);
    }

    function test_Settle_RevertsDuringWindow() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 92);
        vm.expectRevert(ClearPactEscrow.DisputeWindowOpen.selector);
        escrow.settle(jobId);
    }

    function test_Settle_RevertsWhenDisputed() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 30);
        vm.prank(buyer);
        escrow.dispute(jobId);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(ClearPactEscrow.WrongStatus.selector);
        escrow.settle(jobId);
    }

    function testFuzz_Arbitrate_ConservesFunds(uint256 workerBps) public {
        workerBps = bound(workerBps, 0, 10_000);
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 10);
        vm.prank(buyer);
        escrow.dispute(jobId);

        uint256 buyerBefore = buyer.balance;
        vm.prank(arbiter);
        escrow.arbitrate(jobId, workerBps, 0);

        assertEq(worker.balance + (buyer.balance - buyerBefore), AMOUNT);
        assertEq(address(escrow).balance, 0);
    }

    // ── Access control ───────────────────────────────────────────────────

    function test_OnlyWorker_CanDeliver() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        vm.expectRevert(ClearPactEscrow.NotAuthorized.selector);
        escrow.deliver(jobId, WORK);
    }

    function test_OnlyVerifier_CanSubmitVerdict() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        vm.prank(worker);
        vm.expectRevert(ClearPactEscrow.NotAuthorized.selector);
        escrow.submitVerdict(jobId, 100, VERDICT);
    }

    function test_OnlyArbiter_CanArbitrate() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 30);
        vm.prank(buyer);
        escrow.dispute(jobId);
        vm.prank(buyer);
        vm.expectRevert(ClearPactEscrow.NotAuthorized.selector);
        escrow.arbitrate(jobId, 0, 0);
    }

    function test_OnlyBuyer_CanAcceptDelivery() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        vm.prank(worker);
        vm.expectRevert(ClearPactEscrow.NotAuthorized.selector);
        escrow.acceptDelivery(jobId);
    }

    function test_ThirdParty_CannotDispute() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        _verdict(jobId, 30);
        vm.prank(verifier);
        vm.expectRevert(ClearPactEscrow.NotAuthorized.selector);
        escrow.dispute(jobId);
    }

    // ── Creation guards ──────────────────────────────────────────────────

    function test_CreateJob_RevertsOnZeroValue() public {
        vm.prank(buyer);
        vm.expectRevert(ClearPactEscrow.ZeroAmount.selector);
        escrow.createJob(worker, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0);
    }

    function test_CreateJob_RevertsOnPastDeadline() public {
        vm.warp(1000);
        vm.prank(buyer);
        vm.expectRevert(ClearPactEscrow.BadParams.selector);
        escrow.createJob{value: AMOUNT}(worker, verifier, SPEC, PASS_SCORE, uint64(999), WINDOW, 0);
    }

    function test_CreateJob_RevertsOnSelfDealing() public {
        vm.prank(buyer);
        vm.expectRevert(ClearPactEscrow.BadParams.selector);
        escrow.createJob{value: AMOUNT}(buyer, verifier, SPEC, PASS_SCORE, uint64(block.timestamp + 1 days), WINDOW, 0);
    }

    function test_VerdictScore_CappedAt100() public {
        uint256 jobId = _createJob();
        _deliver(jobId);
        vm.prank(verifier);
        vm.expectRevert(ClearPactEscrow.BadParams.selector);
        escrow.submitVerdict(jobId, 101, VERDICT);
    }
}
