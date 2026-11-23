// Deploy the InsureTrust contracts and save their addresses for the website (app/src/deployments.json).
//   Local:   docker compose run --rm dev npm run deploy:local
//   Sepolia: docker compose run --rm dev npm run deploy:sepolia     (needs .env — see .env.example)
// The deploying account becomes the insurer. The pool is funded with test tINR (no real value).
import { network } from "hardhat";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const connection = await network.create();
const { ethers } = connection;
const [insurer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();
console.log(`Deploying to ${connection.networkName} (chain ${chainId}) from ${insurer.address}`);
const firstBlock = (await ethers.provider.getBlockNumber()) + 1; // the website reads events from here on

const deploy = async (name: string, args: unknown[] = []) => {
  const contract = await ethers.deployContract(name, args);
  await contract.waitForDeployment();
  console.log(`  ${name}: ${await contract.getAddress()}`);
  return contract;
};
const token = await deploy("TestINR");
const verifier = await deploy("ClaimVerifier");
const insureTrust = await deploy("InsureTrust", [verifier, token, 0n]); // insurer approves hospitals later
const healthRecords = await deploy("HealthRecords");

const POOL = 1_000_000_00n; // ₹10,00,000 test pool, in paise
await (await token.mint(insureTrust, POOL)).wait();
console.log("  Pool funded with ₹10,00,000 tINR (test token)");

const latest = await ethers.provider.getBlock("latest");
const file = "app/src/deployments.json";
const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
all[chainId.toString()] = {
  network: connection.networkName,
  insureTrust: await insureTrust.getAddress(),
  healthRecords: await healthRecords.getAddress(),
  token: await token.getAddress(),
  verifier: await verifier.getAddress(),
  insurer: insurer.address,
  fromBlock: firstBlock,
  deploymentId: latest!.hash, // changes on every fresh deploy, so old browser data isn't mixed in
  deployedAt: new Date().toISOString(),
};
writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
console.log(`Saved addresses to ${file}`);
