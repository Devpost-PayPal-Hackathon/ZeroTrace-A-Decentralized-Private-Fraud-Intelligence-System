// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title FraudRegistry
 * @notice ZeroTrace — on-chain fraud verdict registry for the PayPal AI Hackathon.
 *
 * What goes on-chain:
 *   - A keccak256 commitment hash of the transaction (no raw data, no PII)
 *   - The ZK proof that fraud_score crossed the threshold (Groth16, via Verifier.sol)
 *   - The submitter address + block timestamp
 *
 * What NEVER goes on-chain:
 *   - Transaction amount, parties, merchant identity, raw features
 *
 * Merchant query:
 *   isFlagged(bytes32 txHash) → bool
 *   getFraudRecord(bytes32 txHash) → FraudRecord struct
 */

interface IVerifier {
    function verifyProof(
        uint[2]    calldata a,
        uint[2][2] calldata b,
        uint[2]    calldata c,
        uint[2]    calldata input
    ) external view returns (bool);
}

contract FraudRegistry {

    // ── Structs ───────────────────────────────────────────────────────────────

    struct FraudRecord {
        bytes32 txHash;          // keccak256 commitment — no raw data
        address submitter;       // who submitted the proof
        uint256 timestamp;       // block.timestamp
        uint256 blockNumber;     // block.number
        bool    verified;        // did the ZK verifier accept the proof?
        uint256 threshold;       // fraud score threshold used (e.g. 75 = 0.75)
        string  transactionId;   // off-chain UUID for DB cross-reference (not PII)
    }

    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;
    IVerifier public verifier;

    // txHash → FraudRecord
    mapping(bytes32 => FraudRecord) private records;

    // txHash → exists
    mapping(bytes32 => bool) private flagged;

    // submitter → list of txHashes they submitted
    mapping(address => bytes32[]) private submitterHistory;

    // total counts
    uint256 public totalSubmissions;
    uint256 public totalVerified;

    // ── Events ────────────────────────────────────────────────────────────────

    event FraudRecorded(
        bytes32 indexed txHash,
        address indexed submitter,
        uint256 timestamp,
        bool    verified,
        string  transactionId
    );

    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "FraudRegistry: not owner");
        _;
    }

    modifier notAlreadyFlagged(bytes32 txHash) {
        require(!flagged[txHash], "FraudRegistry: txHash already recorded");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _verifier Address of the deployed Groth16 Verifier contract.
     *                  Pass address(0) during testing to skip ZK verification.
     */
    constructor(address _verifier) {
        owner    = msg.sender;
        verifier = IVerifier(_verifier);
    }

    // ── Core: submit a fraud proof ────────────────────────────────────────────

    /**
     * @notice Submit a ZK proof that a transaction's fraud score crossed the threshold.
     *
     * @param txHash        keccak256 commitment of the transaction (built off-chain)
     * @param transactionId Off-chain UUID for DB cross-reference
     * @param threshold     Fraud score threshold (75 = 0.75 in integer representation)
     * @param a             Groth16 proof pi_a
     * @param b             Groth16 proof pi_b
     * @param c             Groth16 proof pi_c
     * @param input         Public signals: [is_fraud (1), threshold (75)]
     */
    function submitFraudProof(
        bytes32    txHash,
        string     calldata transactionId,
        uint256    threshold,
        uint[2]    calldata a,
        uint[2][2] calldata b,
        uint[2]    calldata c,
        uint[2]    calldata input
    )
        external
        notAlreadyFlagged(txHash)
    {
        bool zkVerified = false;

        // If verifier is set, check the proof; otherwise record unverified
        if (address(verifier) != address(0)) {
            zkVerified = verifier.verifyProof(a, b, c, input);
        }

        FraudRecord memory rec = FraudRecord({
            txHash:        txHash,
            submitter:     msg.sender,
            timestamp:     block.timestamp,
            blockNumber:   block.number,
            verified:      zkVerified,
            threshold:     threshold,
            transactionId: transactionId
        });

        records[txHash]  = rec;
        flagged[txHash]  = true;
        submitterHistory[msg.sender].push(txHash);

        totalSubmissions++;
        if (zkVerified) totalVerified++;

        emit FraudRecorded(txHash, msg.sender, block.timestamp, zkVerified, transactionId);
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * @notice Check if a transaction hash has been flagged as fraud.
     * @param txHash keccak256 commitment of the transaction.
     */
    function isFlagged(bytes32 txHash) external view returns (bool) {
        return flagged[txHash];
    }

    /**
     * @notice Get the full fraud record for a transaction hash.
     */
    function getFraudRecord(bytes32 txHash)
        external
        view
        returns (FraudRecord memory)
    {
        require(flagged[txHash], "FraudRegistry: no record for this txHash");
        return records[txHash];
    }

    /**
     * @notice Get all txHashes submitted by a given address.
     */
    function getSubmitterHistory(address submitter)
        external
        view
        returns (bytes32[] memory)
    {
        return submitterHistory[submitter];
    }

    /**
     * @notice Get registry stats.
     */
    function getStats()
        external
        view
        returns (uint256 submissions, uint256 verified)
    {
        return (totalSubmissions, totalVerified);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * @notice Update the verifier contract address (e.g. after re-running trusted setup).
     */
    function setVerifier(address _verifier) external onlyOwner {
        emit VerifierUpdated(address(verifier), _verifier);
        verifier = IVerifier(_verifier);
    }

    /**
     * @notice Transfer ownership.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "FraudRegistry: zero address");
        owner = newOwner;
    }
}
