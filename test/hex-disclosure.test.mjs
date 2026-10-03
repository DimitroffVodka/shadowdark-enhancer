import test from "node:test";
import assert from "node:assert/strict";
import { playerProjection } from "../scripts/hex-map/hex-records.mjs";
import { explorerView } from "../scripts/hex-map/hex-explorer.mjs";
import { coordinateVisible } from "../scripts/hex-map/coordinate-overlay.mjs";
import { registerHexRules } from "../scripts/overland/hex-rules.mjs";
import { registerHexFog, ownsHexFog } from "../scripts/hex-map/hex-fog.mjs";
const M = "shadowdark-enhancer";
test("real registered token/note getters, coordinate and tooltip consume one native disclosure", () => {
  const cells = {}, scene = { id: "s", uuid: "Scene.s", flags: { [M]: { hexRecords: { adopted: true } } }, grid: { isHexagonal: true, getOffset: () => ({ i: 1, j: 2 }) }, getFlag: (m, k) => scene.flags[m]?.[k] };
  globalThis.game = { user: { isGM: false }, modules: { get: () => null }, journal: { contents: [{ flags: { [M]: { hexRecordProjection: { sceneUuid: scene.uuid, cells } } } }] } };
  class Token { _isLightSource() { return true; } get isVisible() { return true; } }
  class Note { get isVisible() { return true; } }
  globalThis.CONFIG = { Token: { objectClass: Token }, Note: { objectClass: Note } };
  globalThis.Hooks = { on: () => {} };
  registerHexRules(); registerHexFog();
  const token = new globalThis.CONFIG.Token.objectClass(), note = new globalThis.CONFIG.Note.objectClass();
  token.document = note.document = { parent: scene, x: 0, y: 0 }; token.center = { x: 0, y: 0 };
  try {
    for (const [discovery, terrain, location] of [
      [{ revealed: false }, false, false],
      [{ revealed: true }, true, false],
      [{ revealed: true, visited: true }, true, true],
      [{ revealed: true, visited: true, locationRevealed: false }, true, false],
      [{ revealed: true, locationRevealed: true }, true, true],
    ]) {
      const r = { sceneUuid: scene.uuid, offset: { i: 1, j: 2 }, num: 102, terrain: "mountain", title: "SECRET", notes: [{ text: "Public", visible: true }, { text: "SECRET NOTE", visible: true, location: true }], discovery };
      const p = playerProjection(r);
      cells["1_2"] = p;
      assert.equal(coordinateVisible(scene, token.center), terrain);
      assert.equal(token.isVisible, location);
      assert.equal(note.isVisible, location);
      assert.equal(!!explorerView(p), terrain);
      assert.equal(explorerView(p)?.title === "SECRET", location);
      assert.equal(JSON.stringify(explorerView(p)).includes("SECRET NOTE"), location);
    }
    token.isOwner = true; cells["1_2"] = null; assert.equal(token.isVisible, true);
    note.isAuthor = true; assert.equal(note.isVisible, true);
    note.isAuthor = false; note.document.page = { isOwner: true }; assert.equal(note.isVisible, true);
    delete note.document.page;
    globalThis.game.user.isGM = true; token.isOwner = false; note.isAuthor = false;
    assert.equal(token.isVisible, true); assert.equal(note.isVisible, true);
  } finally { for (const key of ["game", "CONFIG", "Hooks"]) delete globalThis[key]; }
});
test("ownership claims neither unadopted scenes nor old overlapping SDX; settings never written", () => {
  const scene = { grid: { isHexagonal: true }, flags: {}, getFlag: (m, k) => scene.flags[m]?.[k] };
  let sets = 0;
  globalThis.game = { modules: { get: () => ({ active: true, api: { hex: { isFogEnabled: () => true } } }) }, settings: { get: () => [], set: () => sets++ } };
  try {
    assert.equal(ownsHexFog(scene), false);
    scene.flags[M] = { hexRecords: { adopted: true } };
    assert.equal(ownsHexFog(scene), false);
    globalThis.game.modules.get = () => ({ active: true, api: { hex: { enhancerOwnershipGuardVersion: 1 } } });
    assert.equal(ownsHexFog(scene), true);
    assert.equal(sets, 0);
  } finally { delete globalThis.game; }
});
