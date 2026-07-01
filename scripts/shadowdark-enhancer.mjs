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
import { ItemDrops } from "./encounter/item-drops.mjs";
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
import { SessionRecap } from "./encounter/session-recap.mjs";
import { registerActorTypes } from "./actors/register-actors.mjs";
import { ShadowdarkCharBuilder } from "./char-builder/char-builder-app.mjs";

// Register the Mount/Boat actor sub-types in `i18nInit`. The mount type reuses
// the Shadowdark system's NpcSD model + NpcSheetSD sheet, which the system
// registers in its own `init` hook — and module init hooks can run BEFORE the
// system's. `i18nInit` fires after ALL init hooks (so the SD classes exist via
// game.system.models/sheets) but BEFORE world documents are instantiated (so
// the data model applies to every mount actor, including saved ones). `setup`
// is too late — it fires after the documents are built.
Hooks.once("i18nInit", () => {
  registerActorTypes();
});

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
  MerchantShop.registerSettings();
  SessionRecap.registerSettings();
  ItemDrops.registerSettings();
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

  // Live census partial — shared by the Monsters/Items dashboards (per-source
  // have/gap list with seed-the-paste-box shortcuts).
  foundry.applications.handlebars
    .getTemplate(`modules/${MODULE_ID}/templates/partials/census.hbs`)
    .then((tpl) => Handlebars.registerPartial("sdeCensus", tpl))
    .catch((err) => console.error(`${MODULE_ID} | failed to register sdeCensus partial:`, err));

  // Shared Occupants/Inventory/Description tabs for the Mount & Boat sheets.
  foundry.applications.handlebars
    .getTemplate(`modules/${MODULE_ID}/templates/partials/vehicle-tabs.hbs`)
    .then((tpl) => Handlebars.registerPartial("sdeVehicleBody", tpl))
    .catch((err) => console.error(`${MODULE_ID} | failed to register sdeVehicleBody partial:`, err));

  // Character-builder step body partials (dynamic partial lookup by step).
  const cbPartials = {
    "sde-cb-list": `modules/${MODULE_ID}/templates/char-builder/partials/list.hbs`,
    "sde-cb-stats": `modules/${MODULE_ID}/templates/char-builder/steps/stats.hbs`,
    "sde-cb-ancestry": `modules/${MODULE_ID}/templates/char-builder/steps/ancestry.hbs`,
    "sde-cb-class": `modules/${MODULE_ID}/templates/char-builder/steps/class.hbs`,
    "sde-cb-languages": `modules/${MODULE_ID}/templates/char-builder/steps/languages.hbs`,
    "sde-cb-background": `modules/${MODULE_ID}/templates/char-builder/steps/background.hbs`,
    "sde-cb-alignment": `modules/${MODULE_ID}/templates/char-builder/steps/alignment.hbs`,
    "sde-cb-deity": `modules/${MODULE_ID}/templates/char-builder/steps/deity.hbs`,
    "sde-cb-hp": `modules/${MODULE_ID}/templates/char-builder/steps/hp.hbs`,
    "sde-cb-gold": `modules/${MODULE_ID}/templates/char-builder/steps/gold.hbs`,
    "sde-cb-gear": `modules/${MODULE_ID}/templates/char-builder/steps/gear.hbs`,
    "sde-cb-placeholder": `modules/${MODULE_ID}/templates/char-builder/steps/placeholder.hbs`,
  };
  for (const [name, path] of Object.entries(cbPartials)) {
    foundry.applications.handlebars
      .getTemplate(path)
      .then((tpl) => Handlebars.registerPartial(name, tpl))
      .catch((err) => console.error(`${MODULE_ID} | failed to register ${name} partial:`, err));
  }

  // "Character Builder" launch button on the (v1) Player actor sheet header —
  // GM or the actor's owner. Opens the guided builder.
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet?.actor ?? sheet?.document;
    if (!actor || actor.type !== "Player") return;
    if (!game.user.isGM && !actor.isOwner) return;
    buttons.unshift({
      label: game.i18n.localize("SDE.charBuilder.title"),
      class: "sde-char-builder-launch",
      icon: "fa-solid fa-user-plus",
      onclick: () => ShadowdarkCharBuilder.open(),
    });
  });

  // Expose API. Public, versioned surface (REQ-26) — additive changes bump
  // the minor version, breaking changes the major. Mirrored at
  // game.modules.get(MODULE_ID).api on ready; consumers should listen for
  // the "shadowdarkEnhancer.ready" hook. Reference: docs/API.md.
  game.shadowdarkEnhancer = {
    apiVersion: "1.0.0",
    // Guided, ordered Character Builder — a replacement for the system's
    // random generator. `open({ level0?, actor? })` renders the wizard.
    charBuilder: {
      open: (opts = {}) => ShadowdarkCharBuilder.open(opts),
      app: ShadowdarkCharBuilder,
    },
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
      // Importer hub — 4-tab shell (Import / Tables / Monsters / Items).
      // Back-compat: legacy tab="dashboard" maps to "tables"; retired
      // "journal"/"scenes" tabs coerce to Import; seed forces Import tab.
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
    // Session Recap — per-session loot/XP/combat/merchant/encounter tracker
    // tied to the crawl lifecycle, with a Discord-markdown export. See
    // session-recap.mjs.
    recap: {
      open: () => SessionRecap.open(),
      getData: () => SessionRecap.getData(),
      formatForDiscord: () => SessionRecap.formatForDiscord(),
      isActive: () => SessionRecap.isActive(),
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
  ItemDrops.init();
  MerchantShop.init();
  SessionRecap.init();
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
