/**
 * TokenArtCatalog.importOffer: what the import guide's Done page offers. The game is a stand-in with a managed
 * imported-monster pack; discoverSources is replaced, since it browses the disk.
 */
import test from "node:test";
import assert from "node:assert/strict";

const pack = (size) => ({
  documentName: "Actor",
  metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
  getIndex: async () => ({ size }),
});
globalThis.game = { packs: [pack(3)], user: { isGM: true }, settings: { get: () => undefined } };
globalThis.foundry = { applications: { apps: {} }, utils: { deepClone: (v) => structuredClone(v) } };

const { TokenArtCatalog } = await import("../scripts/monster-art/token-art-catalog.mjs");
const found = (...labels) => { TokenArtCatalog.discoverSources = async () => labels.map((label) => ({ id: label.toLowerCase(), label })); };

test("the sources are named once each, in the order found, even when one is found twice", async () => {
  found("Monster Core", "Community Tokens", "Monster Manual", "Community Tokens", "Community Tokens (Monster 2024)");
  assert.deepEqual(await TokenArtCatalog.importOffer(), { sources: ["Monster Core", "Community Tokens", "Monster Manual", "Community Tokens (Monster 2024)"] });
});

test("a source with no label is named by its id", async () => {
  TokenArtCatalog.discoverSources = async () => [{ id: "some-art-pack" }];
  assert.deepEqual(await TokenArtCatalog.importOffer(), { sources: ["some-art-pack"] });
});

test("no installed art is no offer", async () => {
  found();
  assert.equal(await TokenArtCatalog.importOffer(), null);
});

test("no imported monsters is no offer, however much art is installed", async () => {
  found("Monster Manual");
  globalThis.game.packs = [pack(0)];
  assert.equal(await TokenArtCatalog.importOffer(), null);
  globalThis.game.packs = [];
  assert.equal(await TokenArtCatalog.importOffer(), null);
});
