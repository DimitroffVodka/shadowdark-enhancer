/**
 * #291: the shipped "The Merchant - Western Reaches" stocks what the importer
 * really wrote, by rule (imported pack, source western-reaches, priced gear),
 * not by the spelling of a name. The names below are the importer's own
 * ("Glow Paste, Jar", "Rope, Morzo Silk") against the spec's older spelling.
 */
import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "shadowdark-enhancer";
const PACK_ID = "world.shadowdark-enhancer--items";

const row = (id, name, type, gp, source, flags = {}) => ({
  _id: id, name, type, img: "x.webp", uuid: `Compendium.${PACK_ID}.Item.${id}`,
  system: { cost: { gp, sp: 0, cp: 0 }, source: { title: source } }, flags: { [MODULE_ID]: flags },
});

const ROWS = [
  row("glow", "Glow Paste, Jar", "Basic", 2, "western-reaches", { imported: true }),
  row("rope", "Rope, Morzo Silk", "Basic", 50, "western-reaches", { imported: true }),
  row("mrs", "Mithral Round shield", "Armor", 60, "western-reaches", { imported: true }),
  row("why4TIl3qVtU23pQ", "Candle", "Basic", 1, "western-reaches", { imported: true }),
  row("egg", "Basilisk Egg", "Basic", 0, "western-reaches"),
  row("spell", "Light Spell Thing", "Spell", 3, "western-reaches"),
  row("prop", "Bent tin fork", "Basic", 1, "western-reaches", { fromTreasureTable: true }),
  row("cs", "Dried rose", "Basic", 1, "cursed-scroll-1", { imported: true }),
];

async function build() {
  const asDoc = (r) => ({ ...r, id: r._id, toObject: () => ({ name: r.name, type: r.type }) });
  const pack = {
    documentName: "Item",
    index: ROWS,
    getIndex: async () => ({ contents: ROWS }),
    getDocument: async (id) => asDoc(ROWS.find((r) => r._id === id)),
  };
  globalThis.game = { packs: { get: (id) => (id === PACK_ID ? pack : null), filter: (f) => [pack].filter(f) } };
  globalThis.fromUuid = async (uuid) => {
    const r = ROWS.find((x) => x.uuid === uuid);
    return r ? asDoc(r) : null;
  };
  globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
  const { buildDefaultMerchantConfigs } = await import("../scripts/merchant/merchant-defaults.mjs");
  return buildDefaultMerchantConfigs();
}

test("the Western Reaches merchant stocks priced Western Reaches gear whatever the importer spelled, each once", async () => {
  const cfg = await build();
  const names = cfg["The Merchant - Western Reaches"].inventory.map((e) => e.name);
  assert.deepEqual(names.sort(), ["Candle", "Glow Paste, Jar", "Mithral Round shield", "Rope, Morzo Silk"]);
});

test("the Base merchant stocks none of it", async () => {
  const cfg = await build();
  assert.equal(cfg["The Merchant - Base"].inventory.length, 0);
});
