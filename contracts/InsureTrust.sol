// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// The generated proof checker (contracts/ClaimVerifier.sol).
interface IClaimVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[8] calldata pub)
        external view returns (bool);
}

/// @title InsureTrust claim settlement
/// @notice Receives a zero-knowledge claim proof, checks it, and pays the hospital automatically.
/// The insurer only ever sees: proof verified + amount + public claim data. No medical details.
contract InsureTrust {
    using SafeERC20 for IERC20;

    // Position of each public value in the proof (must match circuits/claim.circom).
    uint256 constant HOSPITAL_ROOT = 0;
    uint256 constant POLICY = 1;
    uint256 constant NULLIFIER = 2;
    uint256 constant AMOUNT = 3;
    uint256 constant PAYOUT = 4;
    uint256 constant SUBMITTED_AT = 5;
    uint256 constant CHAIN_ID = 6;
    uint256 constant CONTRACT = 7;

    /// A proof must be submitted within this time after it was made (issue #5).
    uint256 public constant MAX_SUBMISSION_AGE = 1 days;

    struct Claim {
        uint256 policyCommitment;
        uint256 nullifier;
        address hospitalPayout;
        uint256 amount; // paise (tINR has 2 decimals)
        uint64 submittedAt;
        uint64 settledAt;
    }

    address public immutable insurer;
    IClaimVerifier public immutable verifier;
    IERC20 public immutable token;

    uint256 public hospitalRoot; // fingerprint of the approved-hospital list
    mapping(uint256 => address) public policyHolder; // policy fingerprint => patient wallet (0 = none/revoked)
    mapping(uint256 => bool) public nullifierUsed; // one-time claim codes already paid
    Claim[] public claims;

    event HospitalRootUpdated(uint256 root);
    event PolicyRegistered(uint256 indexed policyCommitment, address indexed patient);
    event PolicyRevoked(uint256 indexed policyCommitment);
    event ClaimSettled(uint256 indexed claimIndex, uint256 indexed policyCommitment, uint256 nullifier, address hospitalPayout, uint256 amount);

    error NotInsurer();
    error UnknownHospitalRoot();
    error NotPolicyHolder();
    error AlreadyPaid();
    error BadSubmissionTime();
    error WrongDeployment();
    error InvalidProof();

    modifier onlyInsurer() {
        if (msg.sender != insurer) revert NotInsurer();
        _;
    }

    constructor(IClaimVerifier _verifier, IERC20 _token, uint256 _hospitalRoot) {
        insurer = msg.sender;
        verifier = _verifier;
        token = _token;
        hospitalRoot = _hospitalRoot;
        emit HospitalRootUpdated(_hospitalRoot);
    }

    // ---------------- insurer actions ----------------

    /// Replace the approved-hospital list. Removed hospitals can no longer be paid.
    function setHospitalRoot(uint256 root) external onlyInsurer {
        hospitalRoot = root;
        emit HospitalRootUpdated(root);
    }

    /// The insurer approves a policy by registering its fingerprint for one patient.
    function registerPolicy(uint256 policyCommitment, address patient) external onlyInsurer {
        policyHolder[policyCommitment] = patient;
        emit PolicyRegistered(policyCommitment, patient);
    }

    function revokePolicy(uint256 policyCommitment) external onlyInsurer {
        delete policyHolder[policyCommitment];
        emit PolicyRevoked(policyCommitment);
    }

    // ---------------- claim settlement ----------------

    /// The patient submits the proof the hospital made. If every check passes, the hospital is paid.
    function submitClaim(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[8] calldata pub)
        external returns (uint256 claimIndex)
    {
        if (pub[HOSPITAL_ROOT] != hospitalRoot) revert UnknownHospitalRoot();
        // Issue #4: only the patient who owns this policy can submit (patient approval).
        if (policyHolder[pub[POLICY]] != msg.sender) revert NotPolicyHolder();
        if (nullifierUsed[pub[NULLIFIER]]) revert AlreadyPaid();
        // Issue #5: submission time must not be in the future or older than MAX_SUBMISSION_AGE.
        if (pub[SUBMITTED_AT] > block.timestamp || pub[SUBMITTED_AT] + MAX_SUBMISSION_AGE < block.timestamp) {
            revert BadSubmissionTime();
        }
        // The proof only works on this chain and this contract (no copying it elsewhere).
        if (pub[CHAIN_ID] != block.chainid || pub[CONTRACT] != uint256(uint160(address(this)))) revert WrongDeployment();
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        // Mark as paid BEFORE sending money, so a repeat can never slip through.
        nullifierUsed[pub[NULLIFIER]] = true;
        address payout = address(uint160(pub[PAYOUT])); // circuit guarantees it fits in 160 bits
        claimIndex = claims.length;
        claims.push(Claim(pub[POLICY], pub[NULLIFIER], payout, pub[AMOUNT], uint64(pub[SUBMITTED_AT]), uint64(block.timestamp)));
        emit ClaimSettled(claimIndex, pub[POLICY], pub[NULLIFIER], payout, pub[AMOUNT]);

        token.safeTransfer(payout, pub[AMOUNT]);
    }

    function claimCount() external view returns (uint256) {
        return claims.length;
    }
}
