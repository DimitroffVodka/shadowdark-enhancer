// What a table's row names, on rows shaped like a real TableResult: `uuid` is the
// row's own id, and a Build Table row keeps its creature in `documentUuid`.
import test from "node:test";
import assert from "node:assert/strict";

class ApplicationV2 {}
// The roller's imports subclass Foundry's canvas classes as they load; any path will do here.
const anyClass = new Proxy(class {}, { get: (base, key) => (key in base ? base[key] : anyClass) });
globalThis.foundry = {
  canvas: anyClass,
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base },
    handlebars: { renderTemplate: async () => "" },
    ux: { TextEditor: { implementation: { enrichHTML: async (text) => text } } },
  },
  utils: { randomID: () => "entry" },
};
globalThis.game = { i18n: { localize: (key) => key } };
globalThis.Hooks = { on() {}, once() {} };
globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };
globalThis.Roll = class { evaluate() { return { total: 3 }; } };
class Actor {
  constructor(uuid, name) {
    Object.assign(this, { uuid, name, type: "NPC", img: "art/wolf.webp", prototypeToken: { texture: { src: "art/wolf.webp" } } });
  }
}
globalThis.Actor = Actor;

const { rollEntry } = await import("../scripts/encounter/encounter-draw.mjs");
const { EncounterRollerApp } = await import("../scripts/encounter/encounter-roller-app.mjs");

const wolf = new Actor("Compendium.x.y.Actor.wolf", "Wolf");

/** A TableResult: its own uuid, which resolves to the row, and its link, if any. */
const row = (id, fields = {}) => ({
  id,
  uuid: `RollTable.t.TableResult.${id}`,
  documentUuid: null,
  name: "",
  description: "",
  range: [1, 1],
  getFlag: () => undefined,
  ...fields,
});

const built = row("built", {
  type: "document",
  name: "Wolf",
  documentUuid: wolf.uuid,
  getFlag: (_id, key) => (key === "appearing" ? "2d4" : undefined),
});
const linkedInText = row("text", { description: "[[/r 1d4]] @UUID[Compendium.x.y.Actor.wolf]{Wolf}" });
const flavor = row("flavor", { name: "Distant howling" });

const docs = new Map([[wolf.uuid, wolf], ...[built, linkedInText, flavor].map((r) => [r.uuid, r])]);
const table = { name: "Forest", formula: "1d6", results: [built, linkedInText, flavor] };
docs.set("RollTable.t", table);
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;

test("a Build Table row rolls its creature, ready to place", async () => {
  const entry = await rollEntry(built);
  assert.equal(entry.kind, "monster");
  assert.equal(entry.uuid, wolf.uuid);
  assert.equal(entry.name, "Wolf");
  assert.deepEqual(entry.creatures.map((c) => [c.uuid, c.countFormula]), [[wolf.uuid, "2d4"]]);
});

test("a row naming its creature in the text still rolls it", async () => {
  const entry = await rollEntry(linkedInText);
  assert.equal(entry.kind, "monster");
  assert.equal(entry.uuid, wolf.uuid);
});

test("a row with no creature stays flavor", async () => {
  assert.equal((await rollEntry(flavor)).kind, "flavor");
});

test("the table preview shows what the rows will roll", async () => {
  const preview = await EncounterRollerApp.prototype._buildTablePreview("RollTable.t");
  assert.deepEqual(preview.rows.map((r) => [r.id, r.name, r.flavor, r.actorUuid, r.appearing]), [
    ["built", "Wolf", false, wolf.uuid, "2d4"],
    ["text", "Wolf", false, wolf.uuid, "1d4"],
    ["flavor", "Distant howling", true, null, ""],
  ]);
});
