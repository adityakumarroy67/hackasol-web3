// Personal keys, re-created from a wallet signature and kept in MEMORY ONLY (never saved).
// Same wallet -> same keys, on any device, so nothing needs backing up.
import { ZeroHash } from "ethers";
import * as C from "../../lib/claim.js";
import * as R from "../../lib/records.js";
import { send } from "./chain.js";

const recordKeyCache = new Map(); // address -> Promise<keys for opening records>
const hospitalKeyCache = new Map(); // address -> Promise<hospital claim-signing key>

export function recordKeysFor(session) {
  const id = session.address.toLowerCase();
  if (!recordKeyCache.has(id)) recordKeyCache.set(id, R.deriveKeys(session.signer).catch((e) => { recordKeyCache.delete(id); throw e; }));
  return recordKeyCache.get(id);
}
export const recordKeysUnlocked = (session) => recordKeyCache.has(session.address.toLowerCase());

export function hospitalKeyFor(session) {
  const id = session.address.toLowerCase();
  if (!hospitalKeyCache.has(id)) hospitalKeyCache.set(id, C.hospitalFromWallet(session.signer).catch((e) => { hospitalKeyCache.delete(id); throw e; }));
  return hospitalKeyCache.get(id);
}

// Put my public encryption key on-chain (first time only) so others can share records with me.
export async function publishEncryptionKey(session) {
  const keys = await recordKeysFor(session);
  const mine = R.bytesToHex(keys.publicKey);
  const onChain = await session.healthRecords.encryptionKey(session.address);
  if (onChain.toLowerCase() !== mine.toLowerCase()) await send(session.healthRecords.setEncryptionKey(mine));
  return keys;
}

export async function encryptionKeyOf(session, address) {
  const key = await session.healthRecords.encryptionKey(address);
  return key === ZeroHash ? null : R.hexToBytes(key);
}
