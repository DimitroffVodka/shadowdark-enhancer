/**
 * The Mounts leaf's Import button for a core-bestiary row (Horse, Camel, …).
 *
 * The row copies the system's own NPC, so it must not seed the paste box or
 * grab a PDF page, and — because an ApplicationV2 action does not re-render —
 * it must re-render the hub itself, or the row keeps reading "locked" after a
 * successful copy. A book mount keeps the seeded-unlock route it always had.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The hub reads game.journal (source-PDF registry) while it is imported.
globalThis.game = { journal: null, user: { isGM: true } };
const { installHubManage } = await import("../scripts/importer/importer-hub-manage.mjs");

function rig(report = { created: [], skipped: [], replaced: [], missing: [], pack: "sde-actors" }) {
  class FakeHub {}
  installHubManage(FakeHub);
  const log = { renders: 0, copied: [], seeded: [], info: [], warn: [] };
  const hub = Object.assign(new FakeHub(), {
    render: async () => { log.renders += 1; },
    _createSystemMounts: async (names) => { log.copied.push(names); return report; },
    _seedGenericUnlock: async (seed) => { log.seeded.push(seed.name); },
  });
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { info: (m) => log.info.push(m), warn: (m) => log.warn.push(m) } };
  return { hub, log, restore() { globalThis.ui = previousUi; } };
}

const click = (hub, dataset) => hub._onCharSeedPaste(null, { dataset });

test("a core mount row copies from the system, re-renders, and never seeds a PDF grab", async () => {
  const r = rig({ created: ["Horse"], skipped: [], replaced: [], missing: [], pack: "sde-actors" });
  try {
    await click(r.hub, { name: "Horse", type: "Mount", src: "CORE" });
    assert.deepEqual(r.log.copied, [["Horse"]]);
    assert.deepEqual(r.log.seeded, [], "no paste-box seed for a creature the system already holds");
    assert.equal(r.log.renders, 1, "the row must flip to imported without a later render");
    assert.equal(r.log.info.length, 1);
    assert.match(r.log.info[0], /SDE\.importer\.done\.mounts/);
  } finally {
    r.restore();
  }
});

test("a core mount the bestiary lacks warns and still refreshes the tree", async () => {
  const r = rig({ created: [], skipped: [], replaced: [], missing: ["Horse"], pack: "sde-actors" });
  try {
    await click(r.hub, { name: "Horse", type: "Mount", src: "CORE" });
    assert.equal(r.log.renders, 1);
    assert.equal(r.log.info.length, 0);
    assert.equal(r.log.warn.length, 1);
    assert.match(r.log.warn[0], /SDE\.importer\.skipReason\.notInSystem/);
  } finally {
    r.restore();
  }
});

test("a book mount row still takes the seeded unlock and never the system copy", async () => {
  const r = rig();
  try {
    await click(r.hub, { name: "Donkey", type: "Mount", src: "WR", pages: "116-117" });
    assert.deepEqual(r.log.copied, []);
    assert.deepEqual(r.log.seeded, ["Donkey"]);
  } finally {
    r.restore();
  }
});
