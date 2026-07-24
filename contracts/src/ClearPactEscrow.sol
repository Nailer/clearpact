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
    }

    // ─────────────────────────────── State ────────────────────────────────

    /// @notice Arbiter of disputed jobs. MVP: protocol deployer; Part 3+
    ///         evolves this toward staked arbitration.
    address public immutable arbiter;

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
    event JobArbitrated(uint256 indexed jobId, uint256 workerAmount, uint256 buyerAmount);

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

    constructor(address _arbiter) {
        if (_arbiter == address(0)) revert ZeroAddress();
        arbiter = _arbiter;
    }

    // ─────────────────────────────── Buyer ────────────────────────────────

    /// @notice Buyer escrows msg.value (native USDC) for a job.
    function createJob(
        address worker,
        address verifier,
        bytes32 specHash,
        uint8 passScore,
        uint64 deadline,
        uint32 disputeWindow
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
            status: Status.Created
        });

        emit JobCreated(
            jobId, msg.sender, worker, verifier, msg.value, specHash, deadline, disputeWindow, passScore
        );
    }

    /// @notice Buyer accepts the delivery directly, skipping verification.
    function acceptDelivery(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Delivered) revert WrongStatus();
        if (msg.sender != job.buyer) revert NotAuthorized();
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
    function deliver(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        if (job.status != Status.Created) revert WrongStatus();
        if (msg.sender != job.worker) revert NotAuthorized();
        if (block.timestamp > job.deadline) revert DeadlinePassed();
        if (deliverableHash == 0) revert BadParams();

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

    /// @notice Arbiter splits a disputed escrow between worker and buyer.
    /// @param workerBps share of the escrow paid to the worker, in basis points.
    function arbitrate(uint256 jobId, uint256 workerBps) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != Status.Disputed) revert WrongStatus();
        if (msg.sender != arbiter) revert NotAuthorized();
        if (workerBps > 10_000) revert BadParams();

        uint256 amount = job.amount;
        uint256 workerAmount = (amount * workerBps) / 10_000;
        uint256 buyerAmount = amount - workerAmount;
        job.status = Status.Resolved;

        if (workerAmount > 0) _send(job.worker, workerAmount);
        if (buyerAmount > 0) _send(job.buyer, buyerAmount);
        emit JobArbitrated(jobId, workerAmount, buyerAmount);
    }

    // ─────────────────────────────── Views ────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    // ────────────────────────────── Internal ──────────────────────────────

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
