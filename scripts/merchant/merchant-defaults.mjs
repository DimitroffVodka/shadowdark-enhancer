/**
 * Shadowdark Enhancer — Default Merchant Configs
 *
 * Two saved merchants shipped with the module:
 *   • "The Merchant - Base"            — base Shadowdark system gear only
 *   • "The Merchant - Western Reaches" — base gear + the enhancer item pack
 *
 * Metadata only (name / uuid / type — no descriptions or rules text, same
 * copyright contract as char-content-manifest). The actual item data is
 * resolved LIVE at seed time from whatever's installed, so a fresh world
 * builds a working shop: base items resolve from the system; the Western
 * Reaches items resolve once their pack is imported. Unresolvable entries are
 * simply skipped, so the merchant self-heals as content lands.
 */

/** Shared shop settings, captured from the reference merchant. */
export const DEFAULT_MERCHANT_SETTINGS = {
  sellRatio: 50,
  buyMultiplier: 100,
  catalogEnabled: true,
  gambleEnabled: false,
};

/**
 * Every stocked item, tagged `base` (system gear) vs. enhancer content.
 * `uuid` is tried first; if it doesn't resolve (content not imported, or a
 * system id shift), the resolver falls back to a name+type lookup.
 */
export const DEFAULT_MERCHANT_ITEMS = [
  // ── Base Shadowdark system gear ────────────────────────────────────────────
  { name: "Chainmail", uuid: "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0", type: "Armor", base: true },
  { name: "Leather Armor", uuid: "Compendium.shadowdark.gear.Item.EoTEHXApVDS7rHfw", type: "Armor", base: true },
  { name: "Mithral Chainmail", uuid: "Compendium.shadowdark.gear.Item.UDyHeJCreIFZ9y2I", type: "Armor", base: true },
  { name: "Mithral Plate Mail", uuid: "Compendium.shadowdark.gear.Item.BAJQqFdkN9lGFAyZ", type: "Armor", base: true },
  { name: "Plate Mail", uuid: "Compendium.shadowdark.gear.Item.o0261gnDqGC5hQB1", type: "Armor", base: true },
  { name: "Round Shield", uuid: "Compendium.shadowdark.gear.Item.RSNMsNqyV39N9C29", type: "Armor", base: true },
  { name: "Shield", uuid: "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE", type: "Armor", base: true },
  { name: "Arrows", uuid: "Compendium.shadowdark.gear.Item.XXwA9ZWajYEDmcea", type: "Basic", base: true },
  { name: "Backpack", uuid: "Compendium.shadowdark.gear.Item.oSnfz4qcWlUL6cDZ", type: "Basic", base: true },
  { name: "Bottle", uuid: "Compendium.shadowdark.gear.Item.bGrhQMkhE2qwjL4j", type: "Basic", base: true },
  { name: "Caltrops", uuid: "Compendium.shadowdark.gear.Item.SzpjMuJrhF5nMJ7H", type: "Basic", base: true },
  { name: "Crawling Kit", uuid: "Compendium.shadowdark.gear.Item.fJHwwn6TEfbdr8CM", type: "Basic", base: true },
  { name: "Crossbow Bolts", uuid: "Compendium.shadowdark.gear.Item.iv8fMPiRYfsN8ICy", type: "Basic", base: true },
  { name: "Crowbar", uuid: "Compendium.shadowdark.gear.Item.GbO6CggW71qMkgrG", type: "Basic", base: true },
  { name: "Flask", uuid: "Compendium.shadowdark.gear.Item.W2fFimb0y85wmOMb", type: "Basic", base: true },
  { name: "Flint and Steel", uuid: "Compendium.shadowdark.gear.Item.ERprfuTIFRFEix9G", type: "Basic", base: true },
  { name: "Grappling Hook", uuid: "Compendium.shadowdark.gear.Item.fqsLWV46NWH0L53l", type: "Basic", base: true },
  { name: "Holy Symbol", uuid: "Compendium.shadowdark.gear.Item.uS2iSw8NLx8V0jb7", type: "Basic", base: true },
  { name: "Iron Spikes", uuid: "Compendium.shadowdark.gear.Item.EPndk3DPOEOSvbga", type: "Basic", base: true },
  { name: "Lantern", uuid: "Compendium.shadowdark.gear.Item.lCWOUkVp4N1geMRt", type: "Basic", base: true },
  { name: "Mirror", uuid: "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO", type: "Basic", base: true },
  { name: "Oil, flask", uuid: "Compendium.shadowdark.gear.Item.80bCpXdZcj0Cz1fE", type: "Basic", base: true },
  { name: "Rations", uuid: "Compendium.shadowdark.gear.Item.GX6OmWQiE7MzTmjX", type: "Basic", base: true },
  { name: "Rope, 60'", uuid: "Compendium.shadowdark.gear.Item.6ZRwVHFlh5QiyZWC", type: "Basic", base: true },
  { name: "Torch", uuid: "Compendium.shadowdark.gear.Item.z3xc7HGysC4ZCU8e", type: "Basic", base: true },
  { name: "Bastard Sword", uuid: "Compendium.shadowdark.gear.Item.1T8oUkfkBtYTLNF3", type: "Weapon", base: true },
  { name: "Blowgun", uuid: "Compendium.shadowdark.gear.Item.FkcwP4cmpdM5pcOm", type: "Weapon", base: true },
  { name: "Bolas", uuid: "Compendium.shadowdark.gear.Item.iMu2tHuqGfJ7XjsS", type: "Weapon", base: true },
  { name: "Boomerang", uuid: "Compendium.shadowdark.gear.Item.dILnVh0uKk3lRjbH", type: "Weapon", base: true },
  { name: "Club", uuid: "Compendium.shadowdark.gear.Item.JM2XN855QYNhgtre", type: "Weapon", base: true },
  { name: "Club (Obsidian)", uuid: "Compendium.shadowdark.gear.Item.ZAWTt3ORcrZRXgfQ", type: "Weapon", base: true },
  { name: "Crossbow", uuid: "Compendium.shadowdark.gear.Item.eeVEJexfirwWzOVu", type: "Weapon", base: true },
  { name: "Dagger", uuid: "Compendium.shadowdark.gear.Item.C3mc5OlKPSJNMrng", type: "Weapon", base: true },
  { name: "Dagger (Obsidian)", uuid: "Compendium.shadowdark.gear.Item.TQ0x7zmYfTCykZOh", type: "Weapon", base: true },
  { name: "Greataxe", uuid: "Compendium.shadowdark.gear.Item.9Pnhl6SOsbf6qDmt", type: "Weapon", base: true },
  { name: "Greatsword", uuid: "Compendium.shadowdark.gear.Item.eqUuf9OGupuGPsBM", type: "Weapon", base: true },
  { name: "Handaxe", uuid: "Compendium.shadowdark.gear.Item.3DxwBvjceq0FxcsC", type: "Weapon", base: true },
  { name: "Javelin", uuid: "Compendium.shadowdark.gear.Item.B3ZPeUtbChN8lrDm", type: "Weapon", base: true },
  { name: "Longbow", uuid: "Compendium.shadowdark.gear.Item.GzA5T0aewhouRsa3", type: "Weapon", base: true },
  { name: "Longsword", uuid: "Compendium.shadowdark.gear.Item.ZPUhNMmwXXrtbCXi", type: "Weapon", base: true },
  { name: "Mace", uuid: "Compendium.shadowdark.gear.Item.jGZyVuFJnW7QcBFX", type: "Weapon", base: true },
  { name: "Morningstar", uuid: "Compendium.shadowdark.gear.Item.BThyJ1NC6JcRXxeX", type: "Weapon", base: true },
  { name: "Pike", uuid: "Compendium.shadowdark.gear.Item.4nmzFv43ua8nZDS7", type: "Weapon", base: true },
  { name: "Razor Chain", uuid: "Compendium.shadowdark.gear.Item.LW3MgxeOaEPPaiY2", type: "Weapon", base: true },
  { name: "Scimitar", uuid: "Compendium.shadowdark.gear.Item.DKBDkJ3LcRv8scLv", type: "Weapon", base: true },
  { name: "Shortbow", uuid: "Compendium.shadowdark.gear.Item.UfHAWj5weH111Bea", type: "Weapon", base: true },
  { name: "Shortsword", uuid: "Compendium.shadowdark.gear.Item.KQTWQwznjK80gVEU", type: "Weapon", base: true },
  { name: "Shuriken", uuid: "Compendium.shadowdark.gear.Item.sDHZZx1xaCRPmhXY", type: "Weapon", base: true },
  { name: "Sling", uuid: "Compendium.shadowdark.gear.Item.FWgFPQDKkBiTMYhd", type: "Weapon", base: true },
  { name: "Spear", uuid: "Compendium.shadowdark.gear.Item.brIFMH0sOVmqX02N", type: "Weapon", base: true },
  { name: "Spear (Obsidian)", uuid: "Compendium.shadowdark.gear.Item.NaoAGwkshXqkDyoV", type: "Weapon", base: true },
  { name: "Spear-thrower", uuid: "Compendium.shadowdark.gear.Item.YFoaXoW5JCM4z768", type: "Weapon", base: true },
  { name: "Staff", uuid: "Compendium.shadowdark.gear.Item.9eTpsuEuzL3Vaxge", type: "Weapon", base: true },
  { name: "Stave", uuid: "Compendium.shadowdark.gear.Item.P4aAkDkgwR9zcATw", type: "Weapon", base: true },
  { name: "Warhammer", uuid: "Compendium.shadowdark.gear.Item.z98LNu4yOIe1B1eg", type: "Weapon", base: true },
  { name: "Whip", uuid: "Compendium.shadowdark.gear.Item.GgSheZNm2cOQYpZP", type: "Weapon", base: true },
  // ── Western Reaches enhancer items (world.shadowdark-enhancer--items) ───────
  { name: "Mithral Round Shield", uuid: "Compendium.world.shadowdark-enhancer--items.Item.tiF2bMLGiHzkqpz7", type: "Armor", base: false },
  { name: "Mithral Shield", uuid: "Compendium.world.shadowdark-enhancer--items.Item.1Ul0uluE5vkMM1CP", type: "Armor", base: false },
  { name: "Ball Bearing", uuid: "Compendium.world.shadowdark-enhancer--items.Item.3I0tw0dq0z1Zh8tm", type: "Basic", base: false },
  { name: "Bolas", uuid: "Compendium.world.shadowdark-enhancer--items.Item.2NrXk8njo8pH1FDE", type: "Basic", base: false },
  { name: "Candle", uuid: "Compendium.world.shadowdark-enhancer--items.Item.why4TIl3qVtU23pQ", type: "Basic", base: false },
  { name: "Charcoal, jar", uuid: "Compendium.world.shadowdark-enhancer--items.Item.tMVvvZ4tpMv5ZlIH", type: "Basic", base: false },
  { name: "Flash Seed", uuid: "Compendium.world.shadowdark-enhancer--items.Item.gyNNDixvOY0T0RG1", type: "Basic", base: false },
  { name: "Flask or bottle", uuid: "Compendium.world.shadowdark-enhancer--items.Item.phZ2x4OUUgc7pz0v", type: "Basic", base: false },
  { name: "Glow paste, jar", uuid: "Compendium.world.shadowdark-enhancer--items.Item.hbdHThbcpX0ylYEY", type: "Basic", base: false },
  { name: "Holy water, flask", uuid: "Compendium.world.shadowdark-enhancer--items.Item.luSapVOItujuBEML", type: "Basic", base: false },
  { name: "Lantern Hook", uuid: "Compendium.world.shadowdark-enhancer--items.Item.XQlhc3HCeTqzbk6k", type: "Basic", base: false },
  { name: "Miner's putty, jar", uuid: "Compendium.world.shadowdark-enhancer--items.Item.Bk2E5k1ztA1gzsHQ", type: "Basic", base: false },
  { name: "Morzo Silk Rope", uuid: "Compendium.world.shadowdark-enhancer--items.Item.Gtk9FfflJgUEDaBY", type: "Basic", base: false },
  { name: "Net", uuid: "Compendium.world.shadowdark-enhancer--items.Item.n4iEwIsqvnF8OPvc", type: "Basic", base: false },
  { name: "Saddle", uuid: "Compendium.world.shadowdark-enhancer--items.Item.PkgatA7pzzTvDrg1", type: "Basic", base: false },
  { name: "Spear-thrower", uuid: "Compendium.world.shadowdark-enhancer--items.Item.KJg6ZNQnyIQgwIRN", type: "Basic", base: false },
  { name: "Tallow, jar", uuid: "Compendium.world.shadowdark-enhancer--items.Item.kk915gYrIZLwgVtD", type: "Basic", base: false },
  { name: "Traveler's Lamp", uuid: "Compendium.world.shadowdark-enhancer--items.Item.DxyJ09J1tniF30KE", type: "Basic", base: false },
  { name: "Wagon", uuid: "Compendium.world.shadowdark-enhancer--items.Item.zg5LYmkZV4AmaFOf", type: "Basic", base: false },
  { name: "Chakram", uuid: "Compendium.world.shadowdark-enhancer--items.Item.0EasD2joo5FSOjg3", type: "Weapon", base: false },
  { name: "Falchion", uuid: "Compendium.world.shadowdark-enhancer--items.Item.I5KUJ0dJZDk69e3t", type: "Weapon", base: false },
  { name: "Lance", uuid: "Compendium.world.shadowdark-enhancer--items.Item.vzi5OhYMGJFGm9eL", type: "Weapon", base: false },
  { name: "Rapier", uuid: "Compendium.world.shadowdark-enhancer--items.Item.oIYIX8DkmRoQTMgN", type: "Weapon", base: false },
  { name: "Sai", uuid: "Compendium.world.shadowdark-enhancer--items.Item.Sw6kwBGrJv3dRsOy", type: "Weapon", base: false },
  { name: "Stave", uuid: "Compendium.world.shadowdark-enhancer--items.Item.bsE1NB9e67PiroPt", type: "Weapon", base: false },
];

/** The two shipped merchants. `filter` selects rows from DEFAULT_MERCHANT_ITEMS. */
export const DEFAULT_MERCHANTS = [
  { key: "The Merchant - Base", shopName: "The Merchant - Base", filter: (i) => i.base },
  { key: "The Merchant - Western Reaches", shopName: "The Merchant - Western Reaches", filter: () => true },
];

/** Marker set on seeded configs so re-seeding may refresh them; cleared the
 *  moment a GM saves over one (the save path rebuilds the object without it),
 *  which makes an edited default become a user-owned merchant. */
export const DEFAULT_MARKER = "sdeDefault";

/** Resolve one metadata row to a live shop inventory entry, or null. */
async function _resolveEntry(spec) {
  let doc = await fromUuid(spec.uuid).catch(() => null);
  if (!doc) {
    // Fallback: same name + type in any Item compendium.
    for (const p of game.packs.filter((p) => p.documentName === "Item")) {
      const hit = p.index.find((e) => e.name === spec.name && e.type === spec.type);
      if (hit) { doc = await p.getDocument(hit._id).catch(() => null); if (doc) break; }
    }
  }
  if (!doc) return null;
  return {
    id: doc.id,
    name: doc.name,
    img: doc.img,
    uuid: doc.uuid,
    type: doc.type,
    cost: foundry.utils.deepClone(doc.system?.cost ?? { gp: 0, sp: 0, cp: 0 }),
    stock: -1,
    itemData: doc.toObject(),
    category: doc.type || "Other",
  };
}

/**
 * Build the two default merchant configs from live content. Keyed by merchant
 * name; each is a full savedShopConfigs entry (with the DEFAULT_MARKER flag).
 */
export async function buildDefaultMerchantConfigs() {
  const out = {};
  for (const def of DEFAULT_MERCHANTS) {
    const inventory = [];
    for (const spec of DEFAULT_MERCHANT_ITEMS.filter(def.filter)) {
       
      const entry = await _resolveEntry(spec);
      if (entry) inventory.push(entry);
    }
    out[def.key] = {
      name: def.key,
      mode: "compendium",
      actorId: null,
      shopName: def.shopName,
      sellRatio: DEFAULT_MERCHANT_SETTINGS.sellRatio,
      buyMultiplier: DEFAULT_MERCHANT_SETTINGS.buyMultiplier,
      catalogEnabled: DEFAULT_MERCHANT_SETTINGS.catalogEnabled,
      gambleEnabled: DEFAULT_MERCHANT_SETTINGS.gambleEnabled,
      inventory,
      gambleOptions: [],
      [DEFAULT_MARKER]: true,
    };
  }
  return out;
}
