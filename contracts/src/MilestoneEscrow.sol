// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {ReputationRegistry} from "./ReputationRegistry.sol";

/// @title  MilestoneEscrow
/// @notice ClearPact's nanopayment rail: pay-per-verified-chunk settlement for
///         long-running jobs, instead of one lump sum at the end.
///
///         A buyer escrows a total budget split across N milestones up front.
///         The worker delivers and the verifier grades each milestone
///         independently; a passing verdict releases *that milestone's* USDC
///         immediately — the worker gets paid as it goes, not after the whole
///         job. A failing milestone can be disputed and arbitrated exactly
///         like ClearPactEscrow, scoped to that one chunk, so one bad
///         milestone doesn't hold the rest of the job hostage.
///
///         Shares the same ReputationRegistry as ClearPactEscrow: a worker's
///         bond and credit score are a single, protocol-wide identity no
///         matter which settlement shape (lump-sum or streaming) it works
///         under.
///
///         Off-chain, milestone releases are the natural place to route
///         through Circle Gateway nanopayments — many small, cheap
///         settlements instead of one large one is exactly the batching
///         Gateway exists for.
contract MilestoneEscrow {
    // ─────────────────────────────── Types ────────────────────────────────

    enum Status {
        None,       // milestone id unused
        Created,    // funded by buyer, awaiting delivery
        Delivered,  // worker posted deliverable hash, awaiting verdict
        Verified,   // verifier posted verdict, dispute window open
        Disputed,   // a party escalated within the window
        Released,   // milestone funds paid to worker
        Refunded,   // milestone funds returned to buyer
        Resolved    // arbiter split this milestone's funds
    }

    struct Milestone {
        uint96 amount;
        bytes32 deliverableHash;
        bytes32 verdictHash;
        uint64 verdictAt;
        uint8 score;
        Status status;
    }

    struct Job {
        address buyer;
        address worker;
        address verifier;
        uint96 minWorkerStake;
        uint96 lockedStake;      // locked once, at the first delivery; unlocked when the job completes
        uint64 deadline;         // all milestones must be delivered by this time
        uint32 disputeWindow;
        uint8 passScore;
        uint8 milestonesResolved; // count of milestones no longer Created/Delivered/Verified/Disputed
        bool bondSettled;
    }

    // ─────────────────────────────── State ────────────────────────────────

    address public immutable arbiter;
    ReputationRegistry public immutable registry;

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Milestone[]) public milestonesOf;

    uint256 private _lock = 1;

    // ─────────────────────────────── Events ───────────────────────────────

    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        address indexed worker,
        address verifier,
        uint256 totalAmount,
        uint256 milestoneCount,
        bytes32 specHash,
        uint64 deadline,
        uint32 disputeWindow,
        uint8 passScore,
        uint96 minWorkerStake
    );
    event MilestoneDelivered(uint256 indexed jobId, uint256 indexed milestoneIndex, bytes32 deliverableHash);
    event MilestoneVerdict(uint256 indexed jobId, uint256 indexed milestoneIndex, uint8 score, bool passed);
    event MilestoneReleased(uint256 indexed jobId, uint256 indexed milestoneIndex, address indexed worker, uint256 amount);
    event MilestoneRefunded(uint256 indexed jobId, uint256 indexed milestoneIndex, address indexed buyer, uint256 amount);
    event MilestoneDisputed(uint256 indexed jobId, uint256 indexed milestoneIndex, address indexed by);
    event MilestoneArbitrated(uint256 indexed jobId, uint256 indexed milestoneIndex, uint256 workerAmount, uint256 buyerAmount, uint256 slashedAmount);
    event JobCompleted(uint256 indexed jobId);

    // ─────────────────────────────── Errors ───────────────────────────────

    error WrongStatus();
    error NotAuthorized();
    error ZeroAmount();
    error ZeroAddress();
    error BadParams();
    error DeadlinePassed();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error TransferFailed();
    error NoMilestones();

    modifier nonReentrant() {
        if (_lock != 1) revert NotAuthorized();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _arbiter, ReputationRegistry _registry) {
        if (_arbiter == address(0) || address(_registry) == address(0)) revert ZeroAddress();
        arbiter = _arbiter;
        registry = _registry;
    }

    // ─────────────────────────────── Buyer ────────────────────────────────

    /// @notice Buyer escrows msg.value split across `milestoneAmounts`.
    function createJob(
        address worker,
        address verifier,
        bytes32 specHash,
        uint8 passScore,
        uint64 deadline,
        uint32 disputeWindow,
        uint96 minWorkerStake,
        uint96[] calldata milestoneAmounts
    ) external payable returns (uint256 jobId) {
        return _createJob(
            msg.sender, worker, verifier, specHash, passScore, deadline, disputeWindow, minWorkerStake, milestoneAmounts
        );
    }

    /// @notice Same as `createJob`, but takes exactly 3 milestone amounts as
    ///         scalar parameters instead of a `uint96[]`. Exists because the
    ///         Circle CLI's `wallet execute` ABI encoder does not support
    ///         array parameters (confirmed by testing — the identical call
    ///         encodes and executes correctly via `cast`); this lets agent
    ///         wallets create milestone jobs without dropping to a raw key.
    function createJob3(
        address worker,
        address verifier,
        bytes32 specHash,
        uint8 passScore,
        uint64 deadline,
        uint32 disputeWindow,
        uint96 minWorkerStake,
        uint96 m0,
        uint96 m1,
        uint96 m2
    ) external payable returns (uint256 jobId) {
        uint96[] memory amounts = new uint96[](3);
        amounts[0] = m0;
        amounts[1] = m1;
        amounts[2] = m2;
        return _createJob(
            msg.sender, worker, verifier, specHash, passScore, deadline, disputeWindow, minWorkerStake, amounts
        );
    }

    function _createJob(
        address buyer,
        address worker,
        address verifier,
        bytes32 specHash,
        uint8 passScore,
        uint64 deadline,
        uint32 disputeWindow,
        uint96 minWorkerStake,
        uint96[] memory milestoneAmounts
    ) internal returns (uint256 jobId) {
        if (worker == address(0) || verifier == address(0)) revert ZeroAddress();
        if (worker == buyer || passScore > 100 || deadline <= block.timestamp) revert BadParams();
        if (milestoneAmounts.length == 0) revert NoMilestones();

        uint256 total;
        for (uint256 i; i < milestoneAmounts.length; i++) {
            if (milestoneAmounts[i] == 0) revert ZeroAmount();
            total += milestoneAmounts[i];
        }
        if (total != msg.value || total == 0 || total > type(uint96).max) revert ZeroAmount();

        jobId = nextJobId++;
        Job storage job = jobs[jobId];
        job.buyer = buyer;
        job.worker = worker;
        job.verifier = verifier;
        job.minWorkerStake = minWorkerStake;
        job.deadline = deadline;
        job.disputeWindow = disputeWindow;
        job.passScore = passScore;

        Milestone[] storage ms = milestonesOf[jobId];
        for (uint256 i; i < milestoneAmounts.length; i++) {
            ms.push(Milestone({
                amount: milestoneAmounts[i],
                deliverableHash: 0,
                verdictHash: 0,
                verdictAt: 0,
                score: 0,
                status: Status.Created
            }));
        }

        emit JobCreated(
            jobId, buyer, worker, verifier, total, milestoneAmounts.length, specHash, deadline, disputeWindow, passScore, minWorkerStake
        );
    }

    // ─────────────────────────────── Worker ───────────────────────────────

    /// @notice Worker delivers one milestone. Locks the job's bond on the
    ///         first delivery only ("no bond, no work" applies once per job,
    ///         not per milestone — the same bond backs every chunk).
    function deliver(uint256 jobId, uint256 milestoneIndex, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        Milestone storage m = _milestone(jobId, milestoneIndex);
        if (m.status != Status.Created) revert WrongStatus();
        if (msg.sender != job.worker) revert NotAuthorized();
        if (block.timestamp > job.deadline) revert DeadlinePassed();
        if (deliverableHash == 0) revert BadParams();

        if (job.minWorkerStake > 0 && job.lockedStake == 0) {
            registry.lockStake(job.worker, job.minWorkerStake);
            job.lockedStake = job.minWorkerStake;
        }

        m.deliverableHash = deliverableHash;
        m.status = Status.Delivered;
        emit MilestoneDelivered(jobId, milestoneIndex, deliverableHash);
    }

    // ────────────────────────────── Verifier ──────────────────────────────

    function submitVerdict(uint256 jobId, uint256 milestoneIndex, uint8 score, bytes32 verdictHash) external {
        Job storage job = jobs[jobId];
        Milestone storage m = _milestone(jobId, milestoneIndex);
        if (m.status != Status.Delivered) revert WrongStatus();
        if (msg.sender != job.verifier) revert NotAuthorized();
        if (score > 100) revert BadParams();

        m.score = score;
        m.verdictHash = verdictHash;
        m.verdictAt = uint64(block.timestamp);
        m.status = Status.Verified;
        emit MilestoneVerdict(jobId, milestoneIndex, score, score >= job.passScore);
    }

    // ────────────────────────────── Settlement ────────────────────────────

    /// @notice Anyone may settle a milestone once its dispute window closes.
    function settle(uint256 jobId, uint256 milestoneIndex) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage m = _milestone(jobId, milestoneIndex);
        if (m.status != Status.Verified) revert WrongStatus();
        if (block.timestamp <= uint256(m.verdictAt) + job.disputeWindow) revert DisputeWindowOpen();

        bool passed = m.score >= job.passScore;
        _payout(jobId, milestoneIndex, job, m, passed ? job.worker : job.buyer, passed);
    }

    function dispute(uint256 jobId, uint256 milestoneIndex) external {
        Job storage job = jobs[jobId];
        Milestone storage m = _milestone(jobId, milestoneIndex);
        if (m.status != Status.Verified) revert WrongStatus();
        if (msg.sender != job.buyer && msg.sender != job.worker) revert NotAuthorized();
        if (block.timestamp > uint256(m.verdictAt) + job.disputeWindow) revert DisputeWindowClosed();

        m.status = Status.Disputed;
        emit MilestoneDisputed(jobId, milestoneIndex, msg.sender);
    }

    /// @notice Arbiter splits one disputed milestone; may slash part of the
    ///         job's shared bond to the buyer.
    function arbitrate(uint256 jobId, uint256 milestoneIndex, uint256 workerBps, uint256 slashBps) external nonReentrant {
        Job storage job = jobs[jobId];
        Milestone storage m = _milestone(jobId, milestoneIndex);
        if (m.status != Status.Disputed) revert WrongStatus();
        if (msg.sender != arbiter) revert NotAuthorized();
        if (workerBps > 10_000 || slashBps > 10_000) revert BadParams();

        uint256 amount = m.amount;
        uint256 workerAmount = (amount * workerBps) / 10_000;
        uint256 buyerAmount = amount - workerAmount;
        m.status = Status.Resolved;
        job.milestonesResolved += 1;

        uint256 slashed;
        if (job.lockedStake > 0 && slashBps > 0) {
            slashed = (uint256(job.lockedStake) * slashBps) / 10_000;
            if (slashed > job.lockedStake) slashed = job.lockedStake;
            registry.slash(job.worker, slashed, job.buyer);
            job.lockedStake -= uint96(slashed);
            registry.recordDisputeLoss(job.worker);
        }

        registry.recordOutcome(job.worker, m.score, workerBps >= 5_000, workerAmount);

        if (workerAmount > 0) _send(job.worker, workerAmount);
        if (buyerAmount > 0) _send(job.buyer, buyerAmount);
        emit MilestoneArbitrated(jobId, milestoneIndex, workerAmount, buyerAmount, slashed);

        _maybeCompleteJob(jobId, job);
    }

    // ─────────────────────────────── Views ────────────────────────────────

    function getMilestone(uint256 jobId, uint256 milestoneIndex) external view returns (Milestone memory) {
        return _milestone(jobId, milestoneIndex);
    }

    function milestoneCount(uint256 jobId) external view returns (uint256) {
        return milestonesOf[jobId].length;
    }

    // ────────────────────────────── Internal ──────────────────────────────

    function _milestone(uint256 jobId, uint256 milestoneIndex) internal view returns (Milestone storage) {
        Milestone[] storage ms = milestonesOf[jobId];
        if (milestoneIndex >= ms.length) revert BadParams();
        return ms[milestoneIndex];
    }

    function _payout(uint256 jobId, uint256 milestoneIndex, Job storage job, Milestone storage m, address to, bool released)
        internal
    {
        uint256 amount = m.amount;
        m.status = released ? Status.Released : Status.Refunded;
        job.milestonesResolved += 1;

        registry.recordOutcome(job.worker, m.score, released, released ? amount : 0);

        _send(to, amount);
        if (released) emit MilestoneReleased(jobId, milestoneIndex, to, amount);
        else emit MilestoneRefunded(jobId, milestoneIndex, to, amount);

        _maybeCompleteJob(jobId, job);
    }

    /// @dev Once every milestone is terminal, return whatever bond is left
    ///      to the worker's free stake and mark the job done.
    function _maybeCompleteJob(uint256 jobId, Job storage job) internal {
        if (job.milestonesResolved < milestonesOf[jobId].length) return;
        if (!job.bondSettled) {
            job.bondSettled = true;
            if (job.lockedStake > 0) {
                registry.unlockStake(job.worker, job.lockedStake);
                job.lockedStake = 0;
            }
        }
        emit JobCompleted(jobId);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
