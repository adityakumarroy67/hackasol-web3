// Contract functions/events the website uses (human-readable ABI).
// test/abi.test.ts checks every line against the compiled contracts, so typos are caught.

export const INSURE_TRUST_ABI = [
  "function insurer() view returns (address)",
  "function hospitalRoot() view returns (uint256)",
  "function policyHolder(uint256) view returns (address)",
  "function nullifierUsed(uint256) view returns (bool)",
  "function claimCount() view returns (uint256)",
  "function claims(uint256) view returns (uint256 policyCommitment, uint256 nullifier, address hospitalPayout, uint256 amount, uint64 submittedAt, uint64 settledAt)",
  "function setHospitalRoot(uint256 root)",
  "function registerPolicy(uint256 policyCommitment, address patient)",
  "function revokePolicy(uint256 policyCommitment)",
  "function submitClaim(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[8] pub) returns (uint256 claimIndex)",
  "event HospitalRootUpdated(uint256 root)",
  "event PolicyRegistered(uint256 indexed policyCommitment, address indexed patient)",
  "event PolicyRevoked(uint256 indexed policyCommitment)",
  "event ClaimSettled(uint256 indexed claimIndex, uint256 indexed policyCommitment, uint256 nullifier, address hospitalPayout, uint256 amount)",
  "error NotInsurer()",
  "error UnknownHospitalRoot()",
  "error NotPolicyHolder()",
  "error AlreadyPaid()",
  "error BadSubmissionTime()",
  "error WrongDeployment()",
  "error InvalidProof()",
];

export const HEALTH_RECORDS_ABI = [
  "function encryptionKey(address) view returns (bytes32)",
  "function records(uint256) view returns (address patient, address issuer, string cid, uint64 createdAt)",
  "function recordsOf(address patient) view returns (uint256[])",
  "function hasAccess(uint256 recordId, address account) view returns (bool)",
  "function keyFor(uint256 recordId, address account) view returns (bytes)",
  "function setEncryptionKey(bytes32 publicKey)",
  "function addRecord(address patient, string cid, bytes keyForPatient) returns (uint256 recordId)",
  "function grantAccess(uint256 recordId, address grantee, bytes wrappedKey, uint64 expiresAt)",
  "function revokeAccess(uint256 recordId, address grantee)",
  "function logView(uint256 recordId)",
  "event EncryptionKeySet(address indexed account, bytes32 publicKey)",
  "event RecordAdded(uint256 indexed recordId, address indexed patient, address indexed issuer, string cid)",
  "event AccessGranted(uint256 indexed recordId, address indexed grantee, uint64 expiresAt)",
  "event AccessRevoked(uint256 indexed recordId, address indexed grantee)",
  "event RecordViewed(uint256 indexed recordId, address indexed viewer)",
  "error UnknownRecord()",
  "error NotPatient()",
  "error EmptyKey()",
  "error BadExpiry()",
  "error CannotRevokePatient()",
  "error NoAccess()",
];

export const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
];
