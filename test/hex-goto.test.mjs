// "Go to this hex": the viewed scene answers from its own numbering; when it cannot, the Hex Tagger's pin for
// that number is the fallback. A scene of another book must not answer with its own pin for a repeated number.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } }, utils: { randomID: () => "id", escapeHTML: (s) => String(s) } };
globalThis._replace = (v) => v;
globalThis.Hooks = { on() {}, callAll() {} };
const { gotoHex } = await import("../scripts/hex-map/hex-goto.mjs");

const MOD = "shadowdark-enhancer";
/** A scene with one Hex Tagger pin (a Note flagged hexPin) for hex 1403 at (x, y). */
function scene(id, { mapId = null, x, y }) {
  const note = { id: `${id}-note`, x, y, flags: { [MOD]: { hexPin: { num: 1403 } } } };
  return {
    id, uuid: `Scene.${id}`,
    getFlag: (mod, key) => (mod === MOD && key === "hexMapId" ? mapId : undefined),
    notes: { contents: [note], get: (nid) => (nid === note.id ? note : undefined) },
    view: async function () { viewed.push(this.id); globalThis.canvas.scene = this; },
  };
}
const viewed = [];
function world(current) {
  const here = scene("here", { mapId: current, x: 10, y: 10 }), there = scene("there", { x: 500, y: 500 });
  const pans = [];
  viewed.length = 0;
  globalThis.game = { user: { isGM: true }, scenes: { contents: [here, there], get: (id) => [here, there].find((s) => s.id === id) } };
  globalThis.ui = { notifications: { warn() {}, info() {} } };
  globalThis.canvas = { ready: true, scene: here, stage: { scale: { x: 1 } }, animatePan: async (o) => { pans.push(o); } };
  return { pans };
}

test("a link from another book does not pan to this scene's pin with the same number", async () => {
  // The viewed scene is Gloaming's (CS1) map; the link is the Western Reaches' 1403, pinned on another scene.
  const { pans } = world("hex-cs1");
  assert.equal(await gotoHex(1403, "GMWR"), true);
  assert.deepEqual(viewed, ["there"], "the scene holding the pin is viewed");
  assert.deepEqual([pans[0].x, pans[0].y], [500, 500]);
});

test("with no book named, a scene that cannot answer still goes to the pin on the viewed scene first", async () => {
  const { pans } = world(null);
  assert.equal(await gotoHex(1403), true);
  assert.deepEqual(viewed, [], "no scene change");
  assert.deepEqual([pans[0].x, pans[0].y], [10, 10]);
});
