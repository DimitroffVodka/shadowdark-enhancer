/**
 * The wizard's Done page offers installed monster art: when the card appears, what its button does, and that a failure
 * leaves the button to try again. The game side (TokenArtCatalog.importOffer / applyAll) is a stand-in here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;

async function afterRun(env = {}) {
  const ctl = new WizardController({
    t, release: async () => {},
    run: async () => ({ imported: 1, already: 0, needsYou: [], hex: [] }),
    ...env,
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  return ctl;
}

test("Done shows the art card only when the game offers sources", async () => {
  assert.equal((await afterRun()).viewModel().done.art, null, "an env with no art support offers nothing");
  assert.equal((await afterRun({ artOffer: async () => null })).viewModel().done.art, null);
  const art = (await afterRun({ artOffer: async () => ({ sources: ["Monster Manual", "Shadowdark Community Tokens"] }) })).viewModel().done.art;
  assert.equal(art.sources, "Monster Manual, Shadowdark Community Tokens");
  assert.equal(art.offer, true);
});

test("an offer that throws is no card, not a broken Done page", async () => {
  const ctl = await afterRun({ artOffer: async () => { throw new Error("browse failed"); } });
  assert.equal(ctl.state.page, "done");
  assert.equal(ctl.viewModel().done.art, null);
});

test("Apply runs once and its result replaces the button", async () => {
  let calls = 0;
  const ctl = await afterRun({ artOffer: async () => ({ sources: ["A"] }), applyArt: async () => { calls += 1; return { mapped: 40, total: 66 }; } });
  await ctl.dispatch("applyArt");
  await ctl.dispatch("applyArt");
  assert.equal(calls, 1);
  const art = ctl.viewModel().done.art;
  assert.equal(art.offer, false);
  assert.match(art.line, /art\.applied.*"mapped":40,"total":66/);
});

test("a failed apply says why and leaves the button for another try", async () => {
  let fail = true;
  const ctl = await afterRun({ artOffer: async () => ({ sources: ["A"] }), applyArt: async () => { if (fail) throw new Error("disk full"); return { mapped: 1, total: 1 }; } });
  await ctl.dispatch("applyArt");
  let art = ctl.viewModel().done.art;
  assert.equal(art.offer, true);
  assert.match(art.line, /disk full/);
  fail = false;
  await ctl.dispatch("applyArt");
  art = ctl.viewModel().done.art;
  assert.equal(art.offer, false);
  assert.match(art.line, /art\.applied/);
});

test("the offer is made after the Terrain page too", async () => {
  const ctl = await afterRun({
    run: async () => ({ imported: 1, already: 0, needsYou: [], hex: [{ id: "h", title: "H", status: "ready", legend: true, sceneId: "s" }] }),
    legendOpen: async () => ({ cards: () => [], apply: async () => true, close() {} }),
    artOffer: async () => ({ sources: ["A"] }),
  });
  assert.equal(ctl.state.page, "terrain");
  assert.equal(ctl.state.art, null);
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
  assert.equal(ctl.viewModel().done.art.offer, true);
});
