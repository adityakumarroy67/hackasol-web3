// Usage: node scripts/build-circuit.js <name>
// circuits/<name>.circom -> circuits/build/<name>.zkey + <name>_js/<name>.wasm + contracts/<Name>Verifier.sol
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const name = process.argv[2] ?? "claim";
const Name = name[0].toUpperCase() + name.slice(1);
const out = "circuits/build";
const ptau = `${out}/pot14.ptau`;
// PSE Perpetual Powers of Tau (80 contributions), 2^14 constraints.
const PTAU_URL = "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_14.ptau";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const snarkjs = (...args) => run(process.execPath, ["node_modules/snarkjs/build/cli.cjs", ...args]);

mkdirSync(out, { recursive: true });
if (!existsSync(ptau)) {
  console.log("Downloading ptau...");
  const res = await fetch(PTAU_URL);
  if (!res.ok) throw new Error(`ptau download failed: ${res.status}`);
  writeFileSync(ptau, Buffer.from(await res.arrayBuffer()));
}

run("circom", [`circuits/${name}.circom`, "--r1cs", "--wasm", "--O2", "-l", "node_modules", "-o", out]);
snarkjs("groth16", "setup", `${out}/${name}.r1cs`, ptau, `${out}/${name}_0.zkey`);
// ponytail: single dev contribution; team adds theirs via `snarkjs zkey contribute` before final deploy.
snarkjs("zkey", "contribute", `${out}/${name}_0.zkey`, `${out}/${name}.zkey`, `--name=dev`, `-e=${randomBytes(32).toString("hex")}`);
snarkjs("zkey", "export", "verificationkey", `${out}/${name}.zkey`, `${out}/${name}_vkey.json`);
snarkjs("zkey", "export", "solidityverifier", `${out}/${name}.zkey`, `${out}/verifier.sol`);

const sol = readFileSync(`${out}/verifier.sol`, "utf8").replace("contract Groth16Verifier", `contract ${Name}Verifier`);
writeFileSync(`contracts/${Name}Verifier.sol`, sol);
console.log(`Built ${name}: contracts/${Name}Verifier.sol`);
