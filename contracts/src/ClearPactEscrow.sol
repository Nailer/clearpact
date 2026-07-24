// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @title  ClearPactEscrow
/// @notice Conditional USDC settlement for agent-to-agent work on Arc.
///
///         A buyer agent escrows native USDC (Arc's gas token) against a job
///         spec and machine-readable acceptance criteria. A worker agent
///         delivers; a designated verifier agent grades the deliverable and
///         posts a scored verdict on-chain. The verdict — not a human — is the
///         settlement trigger: funds release to the worker on a passing score,
///         refund to the buyer on a failing one, after a dispute window in
///         which either side can escalate to arbitration.
///
///         Because USDC is Arc's native value token, escrow needs no ERC-20
///         approve/transferFrom dance: value moves like ETH on Ethereum, but
///         it is dollars.
///
///         Lifecycle:
///           Created ──deliver()──▶ Delivered ──submitVerdict()──▶ Verified
///           Verified ──settle() after window──▶ Released | Refunded
///           Verified ──dispute() within window──▶ Disputed ──arbitrate()──▶ Resolved
///           Created ──cancelExpired() after deadline──▶ Refunded
///           Delivered ──acceptDelivery() by buyer──▶ Released (fast path)
///
///         Credit layer (Part 3): jobs may require a worker bond. The bond is
///         locked in the ReputationRegistry at delivery ("no bond, no work"),
///         released on settlement, and partially slashed to the buyer when an
///         arbiter rules against the worker. Every outcome is recorded to the
///         worker's on-chain track record.
import {ReputationRegistry} from "./ReputationRegistry.sol";

contract ClearPactEscrow {
    // ─────────────────────────────── Types ────────────────────────────────

    enum Status {
        None,       // job id unused
        Created,    // funded by buyer, awaiting delivery
        Delivered,  // worker posted deliverable hash, awaiting verdict
        Verified,   // verifier posted verdict, dispute window open
        Disputed,   // a party escalated within the window
        Released,   // funds paid to worker
        Refunded,   // funds returned to buyer
        Resolved    // arbiter split funds
    }

    struct Job {
        address buyer;
        address worker;
        address verifier;
        uint96  amount;           // escrowed native USDC (18 decimals on Arc)
        bytes32 specHash;         // hash of job spec + acceptance criteria
        bytes32 deliverableHash;  // hash of delivered work (off-chain payload)
        bytes32 verdictHash;      // hash of verifier's full signed verdict
        uint64  deadline;         // unix time worker must deliver by
        uint32  disputeWindow;    // seconds after verdict during which dispute() is allowed
        uint64  verdictAt;        // unix time verdict was posted
        uint8   score;            // verifier score 0–100
        uint8   passScore;        // minimum score that counts as acceptance
        Status  status;
        uint96  minWorkerStake;   // bond the worker must lock to deliver
        uint96  lockedStake;      // bond actually locked for this job
    }

    // ─────────────────────────────── State ────────────────────────────────

    /// @notice Arbiter of disputed jobs. MVP: protocol deployer; later
    ///         evolves toward staked arbitration.
    address public immutable arbiter;

    /// @notice Credit layer: bonds, slashing, and agent track records.
    ReputationRegistry public immutable registry;

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;

    uint256 private _lock = 1;

    // ─────────────────────────────── Events ───────────────────────────────

    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        address indexed worker,
        address verifier,
        uint256 amount,
        bytes32 specHash,
        uint64 deadline,
        uint32 disputeWindow,
        uint8 passScore
    );
    event WorkDelivered(uint256 indexed jobId, bytes32 deliverableHash);
    event VerdictSubmitted(uint256 indexed jobId, uint8 score, bool passed, bytes32 verdictHash);
    event JobReleased(uint256 indexed jobId, address indexed worker, uint256 amount);
    event JobRefunded(uint256 indexed jobId, address indexed buyer, uint256 amount);
    event JobDisputed(uint256 indexed jobId, address indexed by);
    event JobArbitrated(
        uint256 indexed jobId, uint256 workerAmount, uint256 buyerAmount, uint256 slashedAmount
    );

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

    // ────────────────────────────── Modifiers ─────────────────────────────

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

    /// @notice Buyer escrows msg.value (native USDC) for a job.
    /// @param minWorkerStake bond the worker must have staked in the registry;
    ///        locked at delivery, slashable on a lost dispute. Zero = no bond.
    function createJob(
        address worker,
        address verifier,
        bytes32 specHash,
        uint8 passScore,
        uint64 deadline,
        uint32 disputeWindow,
        uint96 minWorkerStake
    ) external payable returns (uint256 jobId) {
        if (msg.value == 0 || msg.value > type(uint96).max) revert ZeroAmount();
        if (worker == address(0) || verifier == address(0)) revert ZeroAddress();
        if (worker == msg.sender || passScore > 100 || deadline <= block.timestamp) revert BadParams();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            buyer: msg.sender,
            worker: worker,
            verifier: verifier,
            amount: uint96(msg.value),
            specHash: specHash,
            deliverableHash: 0,
            verdictHash: 0,
            deadline: deadline,
            disputeWindow: disputeWindow,
            verdictAt: 0,
            score: 0,
            passScore: passScore,
            status: Status.Created,
            minWorkerStake: minWorkerStake,
            lockedStake: 0
        });

        emit JobCreated(
            jobId, msg.sender, worker, verifier, msg.value, specHash, deadline, disputeWindow, passScore
        );
    }

    /// @notice Buyer accepts the delivery directly, skipping verification.
    ///         Recorded as a perfect-score outcome for the worker.
    function acceptDelivery(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Delivered) revert WrongStatus();
        if (msg.sender != job.buyer) revert NotAuthorized();

        _unlockBond(job);
        registry.recordOutcome(job.worker, 100, true, job.amount);
        _payout(jobId, job, job.worker, true);
    }

    /// @notice Buyer reclaims escrow when the worker missed the deadline.
    function cancelExpired(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Created) revert WrongStatus();
        if (msg.sender != job.buyer) revert NotAuthorized();
        if (block.timestamp <= job.deadline) revert DisputeWindowOpen();
        _payout(jobId, job, job.buyer, false);
    }

    // ─────────────────────────────── Worker ───────────────────────────────

    /// @notice Worker posts the deliverable hash before the deadline.
    ///         Locks the required bond: no bond, no work.
    function deliver(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Created) revert WrongStatus();
        if (msg.sender != job.worker) revert NotAuthorized();
        if (block.timestamp > job.deadline) revert DeadlinePassed();
        if (deliverableHash == 0) revert BadParams();

        if (job.minWorkerStake > 0) {
            registry.lockStake(job.worker, job.minWorkerStake); // reverts if underbonded
            job.lockedStake = job.minWorkerStake;
        }

        job.deliverableHash = deliverableHash;
        job.status = Status.Delivered;
        emit WorkDelivered(jobId, deliverableHash);
    }

    // ────────────────────────────── Verifier ──────────────────────────────

    /// @notice Verifier grades the deliverable; opens the dispute window.
    function submitVerdict(uint256 jobId, uint8 score, bytes32 verdictHash) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Delivered) revert WrongStatus();
        if (msg.sender != job.verifier) revert NotAuthorized();
        if (score > 100) revert BadParams();

        job.score = score;
        job.verdictHash = verdictHash;
        job.verdictAt = uint64(block.timestamp);
        job.status = Status.Verified;
        emit VerdictSubmitted(jobId, score, score >= job.passScore, verdictHash);
    }

    // ────────────────────────────── Settlement ────────────────────────────

    /// @notice Anyone may settle once the dispute window has closed.
    ///         Passing verdict pays the worker; failing verdict refunds the buyer.
    function settle(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Verified) revert WrongStatus();
        if (block.timestamp <= uint256(job.verdictAt) + job.disputeWindow) revert DisputeWindowOpen();

        bool passed = job.score >= job.passScore;
        _unlockBond(job);
        registry.recordOutcome(job.worker, job.score, passed, passed ? job.amount : 0);
        _payout(jobId, job, passed ? job.worker : job.buyer, passed);
    }

    /// @notice Buyer or worker escalates within the dispute window.
    function dispute(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Verified) revert WrongStatus();
        if (msg.sender != job.buyer && msg.sender != job.worker) revert NotAuthorized();
        if (block.timestamp > uint256(job.verdictAt) + job.disputeWindow) revert DisputeWindowClosed();

        job.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender);
    }

    /// @notice Arbiter splits a disputed escrow between worker and buyer, and
    ///         may slash part of the worker's bond to compensate the buyer.
    ///         A ruling with workerBps < 5000 counts as a lost dispute on the
    ///         worker's record.
    /// @param workerBps share of the escrow paid to the worker, in basis points.
    /// @param slashBps  share of the worker's locked bond seized for the buyer.
    function arbitrate(uint256 jobId, uint256 workerBps, uint256 slashBps) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Disputed) revert WrongStatus();
        if (msg.sender != arbiter) revert NotAuthorized();
        if (workerBps > 10_000 || slashBps > 10_000) revert BadParams();

        uint256 amount = job.amount;
        uint256 workerAmount = (amount * workerBps) / 10_000;
        uint256 buyerAmount = amount - workerAmount;
        job.status = Status.Resolved;

        // Bond: slash the ruled share to the buyer, return the rest.
        uint256 slashed;
        uint256 lockedStake = job.lockedStake;
        if (lockedStake > 0) {
            slashed = (lockedStake * slashBps) / 10_000;
            if (slashed > 0) registry.slash(job.worker, slashed, job.buyer);
            registry.unlockStake(job.worker, lockedStake - slashed);
            job.lockedStake = 0;
        }

        // Track record: majority ruling decides pass/loss.
        bool workerWon = workerBps >= 5_000;
        if (!workerWon) registry.recordDisputeLoss(job.worker);
        registry.recordOutcome(job.worker, job.score, workerWon, workerAmount);

        if (workerAmount > 0) _send(job.worker, workerAmount);
        if (buyerAmount > 0) _send(job.buyer, buyerAmount);
        emit JobArbitrated(jobId, workerAmount, buyerAmount, slashed);
    }

    // ─────────────────────────────── Views ────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    // ────────────────────────────── Internal ──────────────────────────────

    /// @dev Return a job's locked bond to the worker's free stake.
    function _unlockBond(Job storage job) internal {
        uint256 lockedStake = job.lockedStake;
        if (lockedStake > 0) {
            registry.unlockStake(job.worker, lockedStake);
            job.lockedStake = 0;
        }
    }

    function _payout(uint256 jobId, Job storage job, address to, bool released) internal {
        uint256 amount = job.amount;
        job.status = released ? Status.Released : Status.Refunded;
        _send(to, amount);
        if (released) emit JobReleased(jobId, to, amount);
        else emit JobRefunded(jobId, to, amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
