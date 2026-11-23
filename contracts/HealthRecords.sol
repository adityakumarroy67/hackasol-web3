// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title HealthRecords — patient-controlled access to encrypted medical records
/// @notice The blockchain stores only:
///   - each file's content ID (CID): a fingerprint of the ENCRYPTED file kept off-chain (IPFS)
///   - "wrapped" record keys: the record's key, locked so only one person can open it
///   - access events (granted / viewed / revoked), which form the access history
/// No medical data is ever stored here.
/// Honest limits: everything on a blockchain is public, so privacy comes from the encryption.
/// Revoking stops access through this system, but cannot erase a copy someone already decrypted.
contract HealthRecords {
    struct Record {
        address patient; // owner: decides who can read it
        address issuer; // who added it (normally the hospital)
        string cid; // content ID of the encrypted file
        uint64 createdAt;
    }

    struct Grant {
        bytes wrappedKey; // the record key, locked for one person
        uint64 expiresAt; // 0 = no expiry
    }

    Record[] public records;
    mapping(address => uint256[]) private recordIds; // patient => their record ids
    mapping(uint256 => mapping(address => Grant)) private grants; // record id => person => grant
    mapping(address => bytes32) public encryptionKey; // each person's public encryption key (X25519)
    mapping(address => mapping(address => bool)) public canAddRecords; // patient => hospital => allowed

    event EncryptionKeySet(address indexed account, bytes32 publicKey);
    event RecordWriterSet(address indexed patient, address indexed writer, bool allowed);
    event RecordAdded(uint256 indexed recordId, address indexed patient, address indexed issuer, string cid);
    event AccessGranted(uint256 indexed recordId, address indexed grantee, uint64 expiresAt);
    event AccessRevoked(uint256 indexed recordId, address indexed grantee);
    event RecordViewed(uint256 indexed recordId, address indexed viewer);

    error UnknownRecord();
    error NotPatient();
    error EmptyKey();
    error BadExpiry();
    error CannotRevokePatient();
    error NoAccess();
    error NotAllowedToAdd();

    /// Publish your public encryption key so others can share records with you.
    function setEncryptionKey(bytes32 publicKey) external {
        encryptionKey[msg.sender] = publicKey;
        emit EncryptionKeySet(msg.sender, publicKey);
    }

    /// The patient chooses which hospitals may add records to their locker (and can take it back).
    function setRecordWriter(address writer, bool allowed) external {
        canAddRecords[msg.sender][writer] = allowed;
        emit RecordWriterSet(msg.sender, writer, allowed);
    }

    /// A hospital the patient allowed adds an encrypted record to their locker. The patient owns it.
    function addRecord(address patient, string calldata cid, bytes calldata keyForPatient) external returns (uint256 recordId) {
        if (msg.sender != patient && !canAddRecords[patient][msg.sender]) revert NotAllowedToAdd();
        if (keyForPatient.length == 0) revert EmptyKey();
        recordId = records.length;
        records.push(Record(patient, msg.sender, cid, uint64(block.timestamp)));
        recordIds[patient].push(recordId);
        grants[recordId][patient] = Grant(keyForPatient, 0);
        emit RecordAdded(recordId, patient, msg.sender, cid);
    }

    /// The patient lets someone (e.g. a doctor) read a record until `expiresAt` (0 = no expiry).
    function grantAccess(uint256 recordId, address grantee, bytes calldata wrappedKey, uint64 expiresAt) external {
        _onlyPatient(recordId);
        if (wrappedKey.length == 0) revert EmptyKey();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert BadExpiry();
        grants[recordId][grantee] = Grant(wrappedKey, expiresAt);
        emit AccessGranted(recordId, grantee, expiresAt);
    }

    /// The patient removes someone's access.
    function revokeAccess(uint256 recordId, address grantee) external {
        _onlyPatient(recordId);
        if (grantee == msg.sender) revert CannotRevokePatient(); // the patient can't lock themselves out
        delete grants[recordId][grantee];
        emit AccessRevoked(recordId, grantee);
    }

    function hasAccess(uint256 recordId, address account) public view returns (bool) {
        Grant storage g = grants[recordId][account];
        return g.wrappedKey.length > 0 && (g.expiresAt == 0 || block.timestamp < g.expiresAt);
    }

    /// The locked record key for `account`. Only that account's private key can unlock it.
    function keyFor(uint256 recordId, address account) external view returns (bytes memory) {
        if (!hasAccess(recordId, account)) revert NoAccess();
        return grants[recordId][account].wrappedKey;
    }

    /// Adds an entry to the on-chain access history when someone opens a record.
    function logView(uint256 recordId) external {
        if (!hasAccess(recordId, msg.sender)) revert NoAccess();
        emit RecordViewed(recordId, msg.sender);
    }

    function recordsOf(address patient) external view returns (uint256[] memory) {
        return recordIds[patient];
    }

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function _onlyPatient(uint256 recordId) private view {
        if (recordId >= records.length) revert UnknownRecord();
        if (records[recordId].patient != msg.sender) revert NotPatient();
    }
}
