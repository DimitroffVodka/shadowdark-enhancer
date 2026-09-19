import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { buildRev, scriptFiles } from "../tools/build-rev.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), "utf8");

test("the shipped build revision matches the scripts on disk", async () => {
  const [entry, manifest] = await Promise.all([
    read("scripts/shadowdark-enhancer.mjs"),
    read("module.json").then(JSON.parse),
  ]);
  const rev = buildRev();

  assert.match(entry, new RegExp(`const BUILD_REV = "${rev}";`), "run `npm run inventory`");
  assert.equal(manifest.flags?.buildRev, rev, "run `npm run inventory`");
});

test("the runtime compares the two stamps and warns the GM after ready", async () => {
  const entry = await read("scripts/shadowdark-enhancer.mjs");

  // Fetched fresh — a cached module.json would defeat the whole mechanism.
  assert.match(entry, /module\.json\?v=\$\{Date\.now\(\)\}/);
  assert.match(entry, /cache: "no-store"/);
  assert.match(entry, /onDisk === BUILD_REV\) return;/);
  // A plain reload re-serves the same cached bytes; the entries must be
  // replaced first or "Reload now" does nothing.
  assert.match(entry, /cache: "reload"/);
  // From the installed files, not the resource timeline: the timeline lists
  // only what this tab has loaded, which misses every lazy import.
  assert.match(entry, /for \(const url of await moduleScriptUrls\(\)\)/);
  assert.match(entry, /FilePicker\.implementation\.browse/);
  assert.match(entry, /serviceWorker\?\.getRegistrations\(\)/);
  assert.match(entry, /Hooks\.once\("ready", \(\) => \{ if \(game\.user\?\.isGM\) checkBuildRev\(\); \}\);/);
});

test("the revision covers every script, by content and by path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sde-rev-"));
  const scripts = path.join(dir, "scripts");
  fs.mkdirSync(path.join(scripts, "sub"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "shadowdark-enhancer.mjs"), 'const BUILD_REV = "000000000000";\n');
  fs.writeFileSync(path.join(scripts, "sub", "a.mjs"), "export const a = 1;\n");

  const base = buildRev(dir);
  assert.equal(scriptFiles(dir).length, 2);

  fs.writeFileSync(path.join(scripts, "sub", "a.mjs"), "export const a = 2;\n");
  assert.notEqual(buildRev(dir), base, "an edit must move the revision");

  fs.renameSync(path.join(scripts, "sub", "a.mjs"), path.join(scripts, "sub", "b.mjs"));
  const renamed = buildRev(dir);
  fs.renameSync(path.join(scripts, "sub", "b.mjs"), path.join(scripts, "sub", "a.mjs"));
  assert.notEqual(renamed, buildRev(dir), "a rename must move the revision");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("stamping the entry does not move the revision it stamps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sde-rev-"));
  const entry = path.join(dir, "scripts", "shadowdark-enhancer.mjs");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'const BUILD_REV = "000000000000";\nexport const x = 1;\n');

  const before = buildRev(dir);
  fs.writeFileSync(entry, `const BUILD_REV = "${before}";\nexport const x = 1;\n`);

  // Otherwise `inventory:check` fails the instant `npm run inventory` succeeds.
  assert.equal(buildRev(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});
