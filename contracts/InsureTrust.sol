// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IClaimVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[9] calldata pub)
        external view returns (bool);
}

/// @title InsureTrust — encrypted health records + ZK-verified insurance claims (W3-01)
/// @notice Stores only hashes, IPFS CIDs and access grants. Never medical data.
contract InsureTrust {
    using SafeERC20 for IERC20;

    // Public signal layout (must match circuits/claim.circom)
    uint256 constant HOSPITAL_ROOT = 0;
    uint256 constant POLICY = 1;
    uint256 constant NULLIFIER = 2;
    uint256 constant AMOUNT = 3;
    uint256 constant CLAIM_DATE = 4;
    uint256 constant RECORD = 5;
    uint256 constant RECIPIENT = 6;
    uint256 constant CHAIN_ID = 7;
    uint256 constant CONTRACT = 8;

    uint256 public constant CLAIM_WINDOW = 30 days;
    uint256 public constant PAISE_TO_TOKEN = 1e16; // 1 paise = 1e16 wei of an 18-decimal token

    struct Record {
        address patient;
        string cid; // IPFS CID of the AES-GCM ciphertext
        uint64 createdAt;
    }

    struct Grant {
        bytes wrappedKey; // record key encrypted to the grantee's ECDH public key
        uint64 expiresAt;
    }

    struct Claim {
        uint256 nullifier;
        uint256 policyCommitment;
        uint256 recordCommitment;
        address recipient;
        uint256 amountPaise;
        uint64 claimDate;
        uint64 settledAt;
    }

    address public immutable insurer;
    IClaimVerifier public immutable verifier;
    IERC20 public immutable token;

    uint256 public hospitalRoot;
    mapping(uint256 => address) public policyHolder; // policyCommitment => patient (0 = none / revoked)
    mapping(uint256 => Record) public records; // recordCommitment => record
    mapping(uint256 => mapping(address => Grant)) internal grants;
    mapping(address => bytes) public encryptionKey; // ECDH public key per account
    mapping(uint256 => bool) public nullifierUsed;
    Claim[] public claims;

    event HospitalRootUpdated(uint256 root);
    event PolicyRegistered(uint256 indexed policyCommitment, address indexed patient);
    event PolicyRevoked(uint256 indexed policyCommitment);
    event RecordRegistered(uint256 indexed recordCommitment, address indexed patient, string cid);
    event EncryptionKeySet(address indexed account, bytes publicKey);
    event AccessGranted(uint256 indexed recordCommitment, address indexed grantee, uint64 expiresAt);
    event AccessRevoked(uint256 indexed recordCommitment, address indexed grantee);
    event RecordViewed(uint256 indexed recordCommitment, address indexed viewer);
    event ClaimSettled(uint256 indexed claimId, uint256 indexed nullifier, uint256 indexed policyCommitment, address recipient, uint256 amountPaise);

    error NotInsurer();
    error NotRecordOwner();
    error RecordExists();
    error UnknownRoot();
    error NotPolicyHolder();
    error UnknownRecord();
    error NullifierUsed();
    error BadClaimDate();
    error WrongChainOrContract();
    error BadRecipient();
    error InvalidProof();
    error NoAccess();

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

    // ---------------- insurer / regulator ----------------

    /// @notice Replacing the root de-lists removed hospitals immediately.
    function setHospitalRoot(uint256 root) external onlyInsurer {
        hospitalRoot = root;
        emit HospitalRootUpdated(root);
    }

    function registerPolicy(uint256 policyCommitment, address patient) external onlyInsurer {
        policyHolder[policyCommitment] = patient;
        emit PolicyRegistered(policyCommitment, patient);
    }

    function revokePolicy(uint256 policyCommitment) external onlyInsurer {
        delete policyHolder[policyCommitment];
        emit PolicyRevoked(policyCommitment);
    }

    // ---------------- records & access ----------------

    function setEncryptionKey(bytes calldata publicKey) external {
        encryptionKey[msg.sender] = publicKey;
        emit EncryptionKeySet(msg.sender, publicKey);
    }

    function registerRecord(uint256 recordCommitment, string calldata cid) external {
        if (records[recordCommitment].patient != address(0)) revert RecordExists();
        records[recordCommitment] = Record(msg.sender, cid, uint64(block.timestamp));
        emit RecordRegistered(recordCommitment, msg.sender, cid);
    }

    /// @param expiresAt unix time; 0 = no expiry
    function grantAccess(uint256 recordCommitment, address grantee, bytes calldata wrappedKey, uint64 expiresAt) external {
        if (records[recordCommitment].patient != msg.sender) revert NotRecordOwner();
        grants[recordCommitment][grantee] = Grant(wrappedKey, expiresAt);
        emit AccessGranted(recordCommitment, grantee, expiresAt);
    }

    /// @notice Stops future access through this app. Cannot erase copies already downloaded.
    function revokeAccess(uint256 recordCommitment, address grantee) external {
        if (records[recordCommitment].patient != msg.sender) revert NotRecordOwner();
        delete grants[recordCommitment][grantee];
        emit AccessRevoked(recordCommitment, grantee);
    }

    function hasAccess(uint256 recordCommitment, address account) public view returns (bool) {
        if (records[recordCommitment].patient == account) return true;
        Grant storage g = grants[recordCommitment][account];
        return g.wrappedKey.length > 0 && (g.expiresAt == 0 || block.timestamp < g.expiresAt);
    }

    function getGrant(uint256 recordCommitment, address account) external view returns (bytes memory wrappedKey, uint64 expiresAt) {
        if (!hasAccess(recordCommitment, account)) revert NoAccess();
        Grant storage g = grants[recordCommitment][account];
        return (g.wrappedKey, g.expiresAt);
    }

    /// @notice On-chain audit trail entry. Best effort: decryption itself happens off-chain.
    function logView(uint256 recordCommitment) external {
        if (!hasAccess(recordCommitment, msg.sender)) revert NoAccess();
        emit RecordViewed(recordCommitment, msg.sender);
    }

    // ---------------- claims ----------------

    /// @notice Called by the patient with a proof generated by the hospital.
    function submitClaim(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[9] calldata pub)
        external returns (uint256 claimId)
    {
        if (pub[HOSPITAL_ROOT] != hospitalRoot) revert UnknownRoot();
        if (policyHolder[pub[POLICY]] != msg.sender) revert NotPolicyHolder();
        if (records[pub[RECORD]].patient != msg.sender) revert UnknownRecord();
        if (nullifierUsed[pub[NULLIFIER]]) revert NullifierUsed();
        if (pub[CLAIM_DATE] > block.timestamp || pub[CLAIM_DATE] + CLAIM_WINDOW < block.timestamp) revert BadClaimDate();
        if (pub[CHAIN_ID] != block.chainid || pub[CONTRACT] != uint256(uint160(address(this)))) revert WrongChainOrContract();
        if (pub[RECIPIENT] == 0 || pub[RECIPIENT] >> 160 != 0) revert BadRecipient();
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        // effects before interaction
        nullifierUsed[pub[NULLIFIER]] = true;
        address recipient = address(uint160(pub[RECIPIENT]));
        claimId = claims.length;
        claims.push(Claim(pub[NULLIFIER], pub[POLICY], pub[RECORD], recipient, pub[AMOUNT], uint64(pub[CLAIM_DATE]), uint64(block.timestamp)));
        emit ClaimSettled(claimId, pub[NULLIFIER], pub[POLICY], recipient, pub[AMOUNT]);

        token.safeTransfer(recipient, pub[AMOUNT] * PAISE_TO_TOKEN);
    }

    function claimCount() external view returns (uint256) {
        return claims.length;
    }
}
