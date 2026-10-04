import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
};

// Dialogs that carry their own classes (and their own CSS, or a test of their own below) keep them; every other DialogV2 call takes the shared look.
const OWN_CLASSES = new Set(["scripts/char-builder/art-gallery.mjs", "scripts/char-builder/steps/preview-step.mjs", "scripts/hex-map/hex-map-flow.mjs", "scripts/dying/dying.mjs"]);

test("every DialogV2 call without its own classes takes the shared dialog look", () => {
  const bad = [];
  for (const file of files("scripts")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/DialogV2(\.(confirm|prompt|wait|input|query))?\(\{/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const call = `${line}\n${lines[i + 1] ?? ""}`;
      if (!call.includes('classes: ["sde-ui", "sde-dialog"')) bad.push(`${file}:${i + 1}`);
    });
  }
  const unexpected = bad.filter((b) => !OWN_CLASSES.has(b.replace(/:\d+$/, "")));
  assert.deepEqual(unexpected, []);
});

test("the dying menu is a list of actions: dlg-choices, its own hook class and an icon on every button", () => {
  const src = readFileSync("scripts/dying/dying.mjs", "utf8");
  assert.match(src, /classes: \["sde-ui", "sde-dialog", "dlg-choices", "sde-dying-menu"\]/);
  for (const action of ["check", "stabilize", "add", "remove", "conscious", "rise"]) {
    assert.match(src, new RegExp(`action: "${action}", icon: "fa-solid fa-`), action);
  }
});

test("the dialog stylesheet section ships the footer and choice-list rules", () => {
  const css = readFileSync("styles/shadowdark-enhancer.css", "utf8");
  assert.match(css, /\.sde-dialog \.form-footer button\.default/);
  assert.match(css, /\.sde-dialog\.dlg-choices \.form-footer/);
});
