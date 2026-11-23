// End-to-end website test in a real (headless) Chrome: clicks through the whole story like a person.
// Needs: the Docker stack running with contracts deployed (see README), and Google Chrome installed.
//   node scripts/ui-test.mjs          (run on the host, not in Docker; uses the local test accounts)
// Env: APP_URL (default http://localhost:5173), CHROME (path to chrome), OUT (screenshot folder).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = process.env.OUT ?? "ui-test-output";
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

// ---------- tiny Chrome DevTools Protocol client ----------
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "it-chrome-"))}`,
  "--window-size=1400,1000", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 100 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  if (!page) await sleep(200);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
let shot = 0;
async function screenshot(name) {
  const { cssContentSize } = await cdp("Page.getLayoutMetrics");
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 6000), scale: 1 } });
  const file = join(OUT, `${String(++shot).padStart(2, "0")}-${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

// ---------- page helpers (run inside the page) ----------
const HELPERS = `window.__t = {
  card(title) {
    const c = [...document.querySelectorAll("section.card")].find((c) => c.querySelector("h3")?.textContent.trim().startsWith(title));
    if (!c) throw new Error("card not found: " + title);
    return c;
  },
  set(el, value) {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  },
  field(title, label) {
    const f = [...this.card(title).querySelectorAll("label.field")].find((f) => f.querySelector(".field-label")?.textContent.trim().startsWith(label));
    if (!f) throw new Error("field not found: " + label + " in " + title);
    return f.querySelector("input, select");
  },
  click(title, text, nth = 0) {
    const root = title ? this.card(title) : document;
    const buttons = [...root.querySelectorAll("button, label.chip")].filter((b) => b.textContent.trim().startsWith(text));
    const b = buttons[nth];
    if (!b) throw new Error("button not found: " + text + " in " + title);
    if (b.disabled) throw new Error("button disabled: " + text);
    b.click();
  },
  check(title, text) {
    const label = [...this.card(title).querySelectorAll("label")].find((l) => l.textContent.includes(text));
    const box = label.querySelector("input[type=checkbox]");
    if (!box.checked) box.click();
  },
  text(title) { return title ? this.card(title).innerText : document.body.innerText; },
  errors(title) { return [...(title ? this.card(title) : document).querySelectorAll(".err")].map((e) => e.innerText); },
};`;
const q = JSON.stringify;
const t = {
  fill: (card, label, value) => js(`__t.set(__t.field(${q(card)}, ${q(label)}), ${q(value)})`),
  click: (card, text, nth = 0) => js(`__t.click(${q(card)}, ${q(text)}, ${nth})`),
  check: (card, text) => js(`__t.check(${q(card)}, ${q(text)})`),
  text: (card) => js(`__t.text(${q(card)})`),
  async waitFor(card, needle, timeout = 30_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if ((await t.text(card)).includes(needle)) return; } catch {}
      await sleep(300);
    }
    const file = await screenshot("FAILED");
    let errs = [];
    try { errs = await js(`__t.errors(${q(card)})`); } catch {}
    throw new Error(`Timed out waiting for "${needle}" in "${card ?? "page"}". Errors on screen: ${errs.join(" | ") || "none"}. Screenshot: ${file}`);
  },
  async account(index, tabLabel) {
    await js(`__t.set(document.querySelector('select[aria-label="Test account"]'), ${index})`);
    await sleep(700);
    if (tabLabel) await js(`[...document.querySelectorAll("nav.tabs button")].find((b) => b.textContent.includes(${q(tabLabel)})).click()`);
    await sleep(700);
  },
};

// ---------- the story ----------
const results = [];
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); results.push(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`); console.log(results.at(-1)); }
  catch (e) { results.push(`✖ ${name}: ${e.message}`); console.log(results.at(-1)); throw e; }
}
const INSURER = 0, AARAV = 1, SANJEEVANI = 5, NARMADA = 6, DR_RAO = 8;
let exitCode = 0;
try {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: APP_URL });
  await sleep(2500);
  await js(HELPERS);

  await step("welcome screen loads", async () => { await t.waitFor(null, "Get started"); await screenshot("welcome"); });
  await step("start as Sanjeevani hospital and create its signing key", async () => {
    await js(`__t.set(document.querySelector('select[aria-label="Start as"]'), ${SANJEEVANI})`);
    await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start").click()`);
    await t.waitFor("Your hospital", "Create signing key");
    await t.click("Your hospital", "Create signing key");
    await t.waitFor("Your hospital", "Waiting for insurer approval");
  });
  await step("Narmada hospital creates its signing key", async () => {
    await t.account(NARMADA, "Hospital");
    await t.click("Your hospital", "Create signing key");
    await t.waitFor("Your hospital", "Waiting for insurer approval");
  });
  await step("Dr. Rao publishes an encryption key", async () => {
    await t.account(DR_RAO, "Hospital");
    await t.click("Doctor: records shared with me", "Publish my encryption key");
    await t.waitFor("Doctor: records shared with me", "Encryption key published");
  });
  await step("Aarav unlocks his health locker", async () => {
    await t.account(AARAV, "Patient");
    await t.click("Your health locker", "Unlock my locker");
    await t.waitFor("Your health locker", "Unlocked");
  });
  await step("insurer approves both hospitals on-chain", async () => {
    await t.account(INSURER, "Insurer");
    await t.check("Approved hospitals", "Sanjeevani");
    await t.check("Approved hospitals", "Narmada");
    await t.click("Approved hospitals", "Save approved list on-chain");
    await t.waitFor("Approved hospitals", "Saved on-chain");
  });
  let aaravAddress;
  await step("insurer issues a Gold policy to Aarav", async () => {
    aaravAddress = await js(`Object.entries(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("insuretrust:")))).people).find(([, p]) => p.name === "Aarav")[0]`);
    await t.fill("Issue a policy", "Patient", aaravAddress);
    await t.click("Issue a policy", "Issue policy");
    await t.waitFor("Issue a policy", "Policy issued");
    await screenshot("insurer");
  });
  await step("Aarav shares the policy with Sanjeevani", async () => {
    await t.account(AARAV, "Patient");
    await t.click("My insurance", "Share with hospital");
    await t.waitFor("My insurance", "They can now prepare claims");
  });
  await step("Sanjeevani writes an encrypted record for Aarav (stored on IPFS)", async () => {
    await t.account(SANJEEVANI, "Hospital");
    await t.waitFor("Your hospital", "Approved by insurer");
    await t.click("Write a medical record", "Encrypt & add");
    await t.waitFor("Write a medical record", "Record locked and added");
  });
  await step("an over-limit claim is explained before proving", async () => {
    await t.fill("Prepare an insurance claim", "Amount", "999999");
    await t.waitFor("Prepare an insurance claim", "above the policy limit");
    await t.fill("Prepare an insurance claim", "Amount", "42000");
    await t.waitFor("Prepare an insurance claim", "All policy rules pass");
  });
  await step("Sanjeevani creates the zero-knowledge proof IN THE BROWSER", async () => {
    await t.click("Prepare an insurance claim", "Create proof");
    await t.waitFor("Prepare an insurance claim", "Zero-knowledge proof created", 120_000);
    await screenshot("hospital");
  });
  await step("Aarav approves: contract verifies the proof and pays ₹42,000", async () => {
    await t.account(AARAV, "Patient");
    await t.click("Claims waiting for your approval", "Approve & submit claim");
    await t.waitFor("My claim history", "Paid ✓", 60_000);
  });
  await step("paying the same claim twice is refused", async () => {
    await t.click("My claim history", "Try to submit again");
    await t.waitFor("My claim history", "already paid");
  });
  await step("Aarav opens his record and shares it with Dr. Rao for 7 days", async () => {
    await t.click("My medical records", "Open");
    await t.waitFor("My medical records", "Acute appendicitis");
    await t.click("My medical records", "Share");
    await t.waitFor("My medical records", "can open this record");
    await screenshot("patient");
  });
  await step("Dr. Rao opens the shared record (view is logged on-chain)", async () => {
    await t.account(DR_RAO, "Hospital");
    await t.click("Doctor: records shared with me", "Open");
    await t.waitFor("Doctor: records shared with me", "Acute appendicitis");
    await t.waitFor("Doctor: records shared with me", "recorded in the patient's access history");
  });
  await step("Aarav revokes Dr. Rao; history shows given → opened → removed", async () => {
    await t.account(AARAV, "Patient");
    await t.click("My medical records", "Revoke");
    await t.waitFor("My medical records", "no access");
    await js(`__t.card("My medical records").querySelector("details")?.setAttribute("open", "")`);
    await t.waitFor("My medical records", "Access removed for");
  });
  await step("Dr. Rao can no longer open it", async () => {
    await t.account(DR_RAO, "Hospital");
    await t.waitFor("Doctor: records shared with me", "Access ended or revoked");
  });
  await step("insurer dashboard shows the paid claim, verified on-chain", async () => {
    await t.account(INSURER, "Insurer");
    await t.waitFor("Paid claims", "verified on-chain");
    await t.waitFor("Paid claims", "₹42,000");
    await screenshot("insurer-dashboard");
  });
} catch {
  exitCode = 1;
} finally {
  if (consoleErrors.length) console.log("Page errors:\n  " + consoleErrors.slice(0, 5).join("\n  "));
  console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} steps passed. Screenshots in ${OUT}/`);
  ws.close();
  chrome.kill();
  process.exit(exitCode);
}
