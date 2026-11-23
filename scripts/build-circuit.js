// Usage: npm run circuit -- <name> --new-setup      (default name: claim; see the guard below)
// circuits/<name>.circom  ->  circuits/build/<name>.zkey (proving key)
//                             circuits/build/<name>_js/<name>.wasm (witness generator)
//                             circuits/build/<name>_vkey.json (verification key)
//                             contracts/<Name>Verifier.sol (on-chain proof checker)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--")) ?? "claim";
const Name = name[0].toUpperCase() + name.slice(1);

// The committed verifier and app/public/zk files match the contract deployed on Sepolia. A rebuild
// makes a NEW random proving key, so after it every contract must be redeployed. Ask before that.
if (existsSync(`contracts/${Name}Verifier.sol`) && !args.includes("--new-setup")) {
  console.error(`contracts/${Name}Verifier.sol already exists and matches the deployed contract.\n` +
    `Rebuilding replaces it and app/public/zk with a new key, so you must redeploy afterwards.\n` +
    `To do that on purpose: npm run circuit -- ${name} --new-setup`);
  process.exit(1);
}
const out = "circuits/build";
// PSE Perpetual Powers of Tau (80 independent contributions), capacity 2^15 = 32,768 constraints.
const ptau = `${out}/pot15.ptau`;
const PTAU_URL = "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_15.ptau";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const snarkjs = (...args) => run(process.execPath, ["node_modules/snarkjs/build/cli.cjs", ...args]);

mkdirSync(out, { recursive: true });
if (!existsSync(ptau)) {
  console.log("Downloading Powers of Tau (2^15, ~36 MB)...");
  const res = await fetch(PTAU_URL);
  if (!res.ok) throw new Error(`ptau download failed: ${res.status}`);
  writeFileSync(ptau, Buffer.from(await res.arrayBuffer()));
}

run("circom", [`circuits/${name}.circom`, "--r1cs", "--wasm", "--O2", "-l", "node_modules", "-o", out]);
snarkjs("groth16", "setup", `${out}/${name}.r1cs`, ptau, `${out}/${name}_0.zkey`);
// One random development contribution. Before the final deploy, each team member
// adds their own with `snarkjs zkey contribute` so no single person knows the secret.
snarkjs("zkey", "contribute", `${out}/${name}_0.zkey`, `${out}/${name}.zkey`, "--name=dev", `-e=${randomBytes(32).toString("hex")}`);
snarkjs("zkey", "export", "verificationkey", `${out}/${name}.zkey`, `${out}/${name}_vkey.json`);
snarkjs("zkey", "export", "solidityverifier", `${out}/${name}.zkey`, `${out}/verifier.sol`);

const sol = readFileSync(`${out}/verifier.sol`, "utf8").replace("contract Groth16Verifier", `contract ${Name}Verifier`);
mkdirSync("contracts", { recursive: true });
writeFileSync(`contracts/${Name}Verifier.sol`, sol);

// The website proves in the browser with the same files (they must match the verifier above).
mkdirSync("app/public/zk", { recursive: true });
copyFileSync(`${out}/${name}_js/${name}.wasm`, `app/public/zk/${name}.wasm`);
copyFileSync(`${out}/${name}.zkey`, `app/public/zk/${name}.zkey`);
copyFileSync(`${out}/${name}_vkey.json`, `app/public/zk/${name}_vkey.json`);
console.log(`Built ${name}: contracts/${Name}Verifier.sol + app/public/zk/`);
