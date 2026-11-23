// The website talks to the contracts through hand-written interfaces (app/src/abi.js).
// This checks every function, event and error there against the compiled contracts.
import { expect } from "chai";
import hre from "hardhat";
import { Interface } from "ethers";
import { HEALTH_RECORDS_ABI, INSURE_TRUST_ABI, TOKEN_ABI } from "../app/src/abi.js";

describe("website ABI matches the compiled contracts", () => {
  for (const [name, abi] of [["InsureTrust", INSURE_TRUST_ABI], ["HealthRecords", HEALTH_RECORDS_ABI], ["TestINR", TOKEN_ABI]] as const) {
    it(name, async () => {
      const compiled = new Interface((await hre.artifacts.readArtifact(name)).abi);
      const site = new Interface(abi as unknown as string[]);
      site.forEachFunction((f) => expect(compiled.getFunction(f.selector)?.format("minimal"), f.format()).to.equal(f.format("minimal")));
      site.forEachEvent((e) => expect(compiled.getEvent(e.topicHash)?.format("minimal"), e.format()).to.equal(e.format("minimal")));
      site.forEachError((e) => expect(compiled.getError(e.selector)?.format("minimal"), e.format()).to.equal(e.format("minimal")));
    });
  }
});
