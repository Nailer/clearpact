// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @title  ReputationRegistry
/// @notice The credit layer of ClearPact: worker agents post native-USDC
///         bonds and accumulate an on-chain track record. Authorized escrow
///         contracts lock a worker's stake for the duration of a job, report
///         outcomes, and slash bonds when the worker loses a dispute.
///
///         Reputation is deterministic and fully recomputable from events —
///         no oracle, no admin discretion:
///           • newcomers start neutral at 50;
///           • average verifier score and pass rate build the base;
///           • each lost dispute applies a heavy penalty.
///
///         Buyers price risk with it: a job can require a minimum bond, and a
///         worker's score is free for anyone to read before hiring.
contract ReputationRegistry {
    // ─────────────────────────────── Types ────────────────────────────────

    struct AgentStats {
        uint64 jobsDelivered;   // verdicts received (or buyer-accepted)
        uint64 jobsPassed;      // outcomes that released funds to the worker
        uint64 disputesLost;    // arbitrations that went against the worker
        uint128 totalEarned;    // lifetime USDC released to the worker
        uint128 scoreSum;       // sum of verifier scores, for the average
    }

    // ─────────────────────────────── State ────────────────────────────────

    address public owner;
    mapping(address => bool) public authorizedEscrows;

    mapping(address => uint256) public freeStakeOf;   // withdrawable bond
    mapping(address => uint256) public lockedStakeOf; // bonded to active jobs
    mapping(address => AgentStats) public statsOf;

    uint256 private _lock = 1;

    // ─────────────────────────────── Events ───────────────────────────────

    event Staked(address indexed agent, uint256 amount, uint256 freeStake);
    event Unstaked(address indexed agent, uint256 amount, uint256 freeStake);
    event StakeLocked(address indexed agent, uint256 amount);
    event StakeUnlocked(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 amount, address indexed beneficiary);
    event OutcomeRecorded(address indexed agent, uint8 score, bool passed, uint256 earned);
    event DisputeLossRecorded(address indexed agent);
    event EscrowAuthorized(address indexed escrow, bool authorized);

    // ─────────────────────────────── Errors ───────────────────────────────

    error NotAuthorized();
    error InsufficientStake();
    error ZeroAmount();
    error TransferFailed();

    // ────────────────────────────── Modifiers ─────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    modifier onlyEscrow() {
        if (!authorizedEscrows[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert NotAuthorized();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────── Admin ────────────────────────────────

    function setEscrow(address escrow, bool authorized) external onlyOwner {
        authorizedEscrows[escrow] = authorized;
        emit EscrowAuthorized(escrow, authorized);
    }

    // ─────────────────────────────── Bonds ────────────────────────────────

    /// @notice Agent posts a native-USDC bond.
    function stake() external payable {
        if (msg.value == 0) revert ZeroAmount();
        freeStakeOf[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value, freeStakeOf[msg.sender]);
    }

    /// @notice Agent withdraws free (unlocked) bond.
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 free = freeStakeOf[msg.sender];
        if (amount > free) revert InsufficientStake();
        freeStakeOf[msg.sender] = free - amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Unstaked(msg.sender, amount, freeStakeOf[msg.sender]);
    }

    // ───────────────────────── Escrow-only hooks ──────────────────────────

    /// @notice Bond part of a worker's free stake to an active job.
    function lockStake(address agent, uint256 amount) external onlyEscrow {
        if (amount == 0) return;
        uint256 free = freeStakeOf[agent];
        if (amount > free) revert InsufficientStake();
        freeStakeOf[agent] = free - amount;
        lockedStakeOf[agent] += amount;
        emit StakeLocked(agent, amount);
    }

    /// @notice Return a job's bond to the worker's free stake.
    function unlockStake(address agent, uint256 amount) external onlyEscrow {
        if (amount == 0) return;
        uint256 locked = lockedStakeOf[agent];
        if (amount > locked) revert InsufficientStake();
        lockedStakeOf[agent] = locked - amount;
        freeStakeOf[agent] += amount;
        emit StakeUnlocked(agent, amount);
    }

    /// @notice Seize part of a worker's locked bond for a beneficiary
    ///         (typically the wronged buyer). Called on lost disputes.
    function slash(address agent, uint256 amount, address beneficiary)
        external
        onlyEscrow
        nonReentrant
    {
        if (amount == 0) return;
        uint256 locked = lockedStakeOf[agent];
        if (amount > locked) revert InsufficientStake();
        lockedStakeOf[agent] = locked - amount;
        (bool ok,) = beneficiary.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Slashed(agent, amount, beneficiary);
    }

    /// @notice Record a job outcome for the worker's track record.
    function recordOutcome(address agent, uint8 score, bool passed, uint256 earned)
        external
        onlyEscrow
    {
        AgentStats storage s = statsOf[agent];
        s.jobsDelivered += 1;
        s.scoreSum += score;
        if (passed) {
            s.jobsPassed += 1;
            s.totalEarned += uint128(earned);
        }
        emit OutcomeRecorded(agent, score, passed, earned);
    }

    /// @notice Record an arbitration that went against the worker.
    function recordDisputeLoss(address agent) external onlyEscrow {
        statsOf[agent].disputesLost += 1;
        emit DisputeLossRecorded(agent);
    }

    // ─────────────────────────────── Views ────────────────────────────────

    /// @notice Total bond (free + locked).
    function totalStakeOf(address agent) external view returns (uint256) {
        return freeStakeOf[agent] + lockedStakeOf[agent];
    }

    /// @notice Deterministic 0–100 credit score.
    ///         Newcomer (no delivered jobs) = 50 (neutral).
    ///         Base = (average verifier score + pass rate) / 2.
    ///         Penalty = 10 points per lost dispute, capped at 40.
    function reputationScore(address agent) external view returns (uint256) {
        AgentStats memory s = statsOf[agent];
        if (s.jobsDelivered == 0) return 50;

        uint256 avgScore = uint256(s.scoreSum) / s.jobsDelivered;          // 0–100
        uint256 passRate = (uint256(s.jobsPassed) * 100) / s.jobsDelivered; // 0–100
        uint256 base = (avgScore + passRate) / 2;

        uint256 penalty = uint256(s.disputesLost) * 10;
        if (penalty > 40) penalty = 40;

        return base > penalty ? base - penalty : 0;
    }
}
