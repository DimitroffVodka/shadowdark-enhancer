/**
 * Shadowdark Enhancer — entry point
 */

export { MODULE_ID } from "./module-id.mjs";
import { MODULE_ID } from "./module-id.mjs";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { CrawlBar }      from "./crawl-bar.mjs";
import { registerHiddenSync } from "./hidden-sync.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { EncounterCheck } from "./encounter/encounter-check.mjs";
import { EncounterRollerApp } from "./encounter/encounter-roller-app.mjs";
import { MonsterCreator } from "./encounter/encounter-creator.mjs";
import { createMutatedActor, MUTATIONS } from "./encounter/monster-mutator.mjs";
import { LootCatalog } from "./encounter/loot-catalog.mjs";
import { LootGenerator } from "./encounter/loot-generator.mjs";
import { LootDelivery } from "./encounter/loot-delivery.mjs";
import { LootGeneratorApp } from "./encounter/loot-generator-app.mjs";
import { LootDrops } from "./encounter/loot-drops.mjs";
import { LootTableTag } from "./encounter/loot-table-tag.mjs";
import { TableRegistry } from "./encounter/table-registry.mjs";
import { MagicForgeApp } from "./encounter/magic-forge-app.mjs";
import { LootSetupApp } from "./encounter/loot-setup-app.mjs";
import { boundCount } from "./encounter/loot-setup-manifest.mjs";
import { ImporterHubApp } from "./encounter/importer-hub-app.mjs";
import { TableEnricher } from "./encounter/table-enrich.mjs";
import { MonsterImporterAPI } from "./encounter/monster-importer-app.mjs";
import { segmentDump } from "./encounter/dump-segmenter.mjs";
import { parseItem } from "./encounter/item-parser.mjs";
import { ItemImporter } from "./encounter/item-importer.mjs";
import { MonsterLinker } from "./encounter/monster-linker.mjs";
import { LootLinker } from "./encounter/loot-linker.mjs";
import { buildBundle, exportBundle, applyBundle } from "./encounter/bundle-io.mjs";
import { MerchantShop } from "./merchant-shop.mjs";
import { PartyXP } from "./encounter/party-xp.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
  MerchantShop.registerSettings();
  LootDelivery.init();
  LootTableTag.init();
  TableRegistry.init();

  // Handlebars helpers
  Handlebars.registerHelper("includes", (arr, val) => {
    if (!Array.isArray(arr)) return false;
    return arr.includes(val);
  });

  Handlebars.registerHelper("array", (...args) => {
    // Handlebars passes the "options" object as the last argument
    return args.slice(0, -1);
  });

  // Number.isFinite as a Handlebars predicate — used to render "—"
  // instead of "NaN" for NPCs without a level value set.
  Handlebars.registerHelper("isFinite", (v) => Number.isFinite(v));

  // Join an array for display (Monster Importer renders attack ranges as
  // "close, near"). Handlebars passes its options object as the last arg, so
  // a non-string separator falls back to ", ".
  Handlebars.registerHelper("join", (arr, sep) =>
    Array.isArray(arr) ? arr.join(typeof sep === "string" ? sep : ", ") : "");

  // Catalog accordion partial — shared by the Monsters/Items/Journal/Scenes
  // manifest dashboards (Tables-style have/missing list).
  foundry.applications.handlebars
    .getTemplate(`modules/${MODULE_ID}/templates/partials/catalog.hbs`)
    .then((tpl) => Handlebars.registerPartial("sdeCatalog", tpl))
    .catch((err) => console.error(`${MODULE_ID} | failed to register sdeCatalog partial:`, err));

  // Expose API. Public, versioned surface (REQ-26) — additive changes bump
  // the minor version, breaking changes the major. Mirrored at
  // game.modules.get(MODULE_ID).api on ready; consumers should listen for
  // the "shadowdarkEnhancer.ready" hook. Reference: docs/API.md.
  game.shadowdarkEnhancer = {
    apiVersion: "1.0.0",
    // Universal dump segmentation (D9): one paste → typed buckets.
    import: {
      // Pure, synchronous. Returns { monsters, items, tables, skipped }.
      segment: (text) => segmentDump(text),
    },
    // Bulk items importer (Phase 11). parse is pure; create is GM-only and
    // files into the sde-items suite pack with conflict handling.
    items: {
      parse: (blockText) => parseItem(blockText),
      create: (drafts, opts) => ItemImporter.createItems(drafts, opts),
    },
    // Name → compendium resolution, Core/system-first (D3).
    linker: {
      resolveMonster: async (name) => {
        const want = String(name ?? "").trim().toLowerCase();
        if (!want) return null;
        const index = await MonsterLinker.buildIndex();
        const hit = index.find((e) => (e.nameLower ?? e.name.toLowerCase()) === want);
        return hit ? { uuid: hit.uuid, name: hit.name } : null;
      },
      resolveItem: async (name) => {
        const want = String(name ?? "").trim().toLowerCase();
        if (!want) return null;
        const index = await LootLinker.buildItemIndex();
        const hit = index.find((e) => e.nameLower === want);
        return hit ? { uuid: hit.uuid, name: hit.name } : null;
      },
      invalidate: () => { MonsterLinker.invalidate(); LootLinker.invalidate(); },
    },
    // Suite export/import bundle (Phase 13). All GM-only; apply never
    // overwrites or deletes existing documents (D6).
    bundle: {
      build: () => buildBundle(),
      export: () => exportBundle(),
      apply: (b) => applyBundle(b),
    },
    encounter: {
      check: () => EncounterCheck.check(),
      openRoller: (tab, seed) => EncounterRollerApp.open(tab, seed),
      setActiveTable: (uuid) => game.settings.set(MODULE_ID, "encounterTableUuid", uuid || ""),
      getThreshold: () => game.settings.get(MODULE_ID, "encounterThreshold"),
      setThreshold: (n) => game.settings.set(MODULE_ID, "encounterThreshold", n),
    },
    monsterCreator: {
      open: () => MonsterCreator.open(),
    },
    // Bulk monster importer: paste a raw PDF statblock dump → preview/edit grid →
    // create NPC actors into the managed world compendium. See monster-importer-app.mjs.
    monsters: MonsterImporterAPI,
    mutator: {
      // Clone a bestiary/world actor, apply mutation ids, create a NEW
      // world actor (source untouched). See monster-mutator.mjs.
      create: (baseUuid, mutationIds, customName = null) =>
        createMutatedActor(baseUuid, mutationIds, customName),
      catalog: () => MUTATIONS,
    },
    loot: {
      // Generate a treasure hoard for a level and post a claimable loot card.
      // See loot-generator.mjs + loot-delivery.mjs.
      generateHoard: async (level, rolls = 1, tableUuid = null) => {
        const batch = await LootGenerator.generate(level, { rolls, tableUuid });
        if (batch.error === "no-table") {
          ui.notifications.warn("No loot table set for that tier — load one from a PDF or build via the Importer, then map it in the Loot Generator.");
          return null;
        }
        return LootDelivery.postCard(batch);
      },
      // Rewrite loot RollTables so their rows are real, draggable compendium
      // items (coins stay text). Pass a table, or omit to relink all loot
      // tables. See loot-catalog.mjs.
      linkTables: (table) => table
        ? LootCatalog.linkTableItems(table)
        : LootCatalog.linkLootTables(),
      open: () => LootGeneratorApp.open(),
      openSetup: () => LootSetupApp.open(),
    },
    forge: {
      open: () => MagicForgeApp.open(),
    },
    // Party XP (standalone GM tool). Tag an item with an XP value (or type a
    // flat amount) and award it in full to every selected party member —
    // Shadowdark RAW treasure/quest XP. See party-xp.mjs.
    partyXp: {
      open: (opts) => PartyXP.open(opts),
      // Award `amount` XP to each actor in actorIds (default: the whole party).
      award: (amount, opts) => PartyXP.award(amount, opts),
      // Tag a party-XP value onto an item so the tool reads it back later.
      assignToItem: (item, xp) => PartyXP.assignToItem(item, xp),
      // Resolve an item's XP: tagged value wins, else loot-quality score.
      xpOfItem: (item) => PartyXP.xpOfItem(item),
    },
    tables: {
      all: () => TableRegistry.all(),
      byGroup: (g) => TableRegistry.byGroup(g),
      lootTables: () => TableRegistry.lootTables(),
      encounterTables: () => TableRegistry.encounterTables(),
      groups: () => TableRegistry.groups(),
      organize: (opts) => TableRegistry.organize(opts),
      // Importer hub — 3-tab shell (Import / Tables / Monsters).
      // Back-compat: legacy tab="dashboard" maps to "tables"; seed forces Import tab.
      openHub: (tab, seed) => ImporterHubApp.open(
        (!tab || tab === "dashboard") ? "tables" : tab,
        seed,
      ),
      // Enrich an imported table to the Ruins standard: encounter -> monster
      // @UUID links + [[/r]] counts; treasure -> real compendium items.
      enrich: (uuid, kind) => TableEnricher.enrich(uuid, kind),
      // Re-link EVERY sde-tables doc to imported monsters/items (REQ-24
      // sweep). GM-only, idempotent, link-preserving.
      relinkAll: () => TableEnricher.sweepPack(),
    },
    // Merchant Shop (ported from Vagabond Crawler). GM opens the shop for all
    // players; buy/sell against actor coins, transaction log, optional gamble.
    merchant: {
      open: (opts) => MerchantShop.open(opts),
      close: () => MerchantShop.close(),
      openLocally: () => MerchantShop.openLocally(),
      getLog: () => MerchantShop.getLog(),
      clearLog: () => MerchantShop.clearLog(),
    },
  };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  // Foundry-conventional API discovery point + interop ready signal (REQ-26).
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = game.shadowdarkEnhancer;
  Hooks.callAll("shadowdarkEnhancer.ready", game.shadowdarkEnhancer);
  CrawlState.init();
  registerHiddenSync();
  MovementTracker.init();
  CrawlStrip.init();
  CrawlBar.init();
  LootDrops.init();
  MerchantShop.init();
  checkCoexistence();
  if (game.user.isGM && !game.settings.get(MODULE_ID, "lootSetupSeen")) {
    const bound = boundCount(game.settings.get(MODULE_ID, "lootTierTables") ?? {});
    if (bound < 4) {
      ui.notifications.info("Shadowdark Enhancer: set up your loot tables so the Loot Generator produces real items — open the Loot Generator and click “Set up loot tables”.");
    }
    game.settings.set(MODULE_ID, "lootSetupSeen", true);
  }
});

function checkCoexistence() {
  if (!game.settings.get(MODULE_ID, "warnIfCrawlHelperEnabled")) return;
  if (game.modules.get("shadowdark-crawl-helper")?.active) {
    ui.notifications.warn(game.i18n.localize("SDE.notifications.crawlHelperConflict"));
  }
}
