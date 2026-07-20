/**
 * Shadowdark Enhancer — entry point
 */

export { MODULE_ID } from "./module-id.mjs";
import { MODULE_ID } from "./module-id.mjs";
import { ICONS } from "./icons.mjs";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { CrawlBar }      from "./crawl-bar.mjs";
import { registerHiddenSync } from "./hidden-sync.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { EncounterCheck } from "./encounter/encounter-check.mjs";
import { EncounterRollerApp } from "./encounter/encounter-roller-app.mjs";
import { MonsterCreator } from "./encounter/encounter-creator.mjs";
import { createMutatedActor } from "./encounter/monster-mutator.mjs";
import { catalog as monsterTableCatalog } from "./encounter/monster-table-runtime.mjs";
import { LootCatalog } from "./encounter/loot-catalog.mjs";
import { LootGenerator } from "./encounter/loot-generator.mjs";
import { LootDelivery } from "./encounter/loot-delivery.mjs";
import { LootGeneratorApp } from "./encounter/loot-generator-app.mjs";
import { LootDrops } from "./encounter/loot-drops.mjs";
import { ItemDrops } from "./encounter/item-drops.mjs";
import { LootTableTag } from "./encounter/loot-table-tag.mjs";
import { TableRegistry } from "./encounter/table-registry.mjs";
import { MagicForgeApp } from "./encounter/magic-forge-app.mjs";
import {
  MAGIC_SET_DEFS,
  catalog as magicCatalog,
  buildSetSeed as magicBuildSetSeed,
  buildChildSeed as magicBuildChildSeed,
} from "./encounter/magic-table-runtime.mjs";
import { LootSetupApp } from "./encounter/loot-setup-app.mjs";
import { boundCount } from "./encounter/loot-setup-manifest.mjs";
import { ImporterHubApp } from "./encounter/importer-hub-app.mjs";
import { installCompoundRollTable } from "./encounter/compound-table.mjs";
import { installLoadingDialogGuard } from "./loading-dialog-guard.mjs";
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
// Imported for its top-level createChatMessage hook: the out-of-combat
// initiative sync must be live on the GM from load, not only after the GM
// personally triggers the lazy import in crawl-strip. Otherwise a player who
// rolls OoC initiative first reaches a GM whose hook isn't registered yet and
// the roll never lands in CrawlState.
import "./initiative-manager.mjs";
import { ShadowdarkCharBuilder } from "./char-builder/char-builder-app.mjs";
import { registerArtGalleryQuery } from "./char-builder/art-gallery.mjs";
import { ClassAbilityUses } from "./char-builder/class-ability-uses.mjs";
import { MonsterTokenArt } from "./monster-art/monster-token-art.mjs";
import { TokenArtCatalog } from "./monster-art/token-art-catalog.mjs";
import { TokenArtManagerApp } from "./monster-art/token-art-manager-app.mjs";
import { PdfSheetExport } from "./pdf-export/pdf-sheet-export.mjs";

// Foundry can retain a module stylesheet across reloads while fetching fresh
// templates, producing unstyled block-flow UI. Keep the manifest stylesheet as
// the startup fallback, then layer a content-addressed copy above it. The layout
// contract test requires this revision to change whenever the CSS file changes.
const STYLESHEET_REV = "a47a9d5f1189";

function ensureFreshStylesheet() {
  const id = `${MODULE_ID}-fresh-stylesheet`;
  document.getElementById(id)?.remove();
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/shadowdark-enhancer.css?v=${STYLESHEET_REV}`;
  document.head.append(link);
}

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
  ensureFreshStylesheet();
  console.log(`${MODULE_ID} | init`);
  registerSettings();
  MerchantShop.registerSettings();
  SessionRecap.registerSettings();
  ItemDrops.registerSettings();
  MonsterTokenArt.register();
  // "Export to PDF" header button on owned Shadowdark player sheets.
  PdfSheetExport.register();
  // Char-builder art gallery: registered on every client, but only ever executed on
  // the GM's, so permission-less players can browse the curated folder by proxy.
  registerArtGalleryQuery();
  LootDelivery.init();
  LootTableTag.init();
  TableRegistry.init();
  // Compound generators: wrap RollTable.draw so flagged tables roll every
  // column and post one combined card (sidebar sheet Roll + our hub button).
  installCompoundRollTable();

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

  // Recursive Manage-tree node partial (importer hub's Manage strip).
  foundry.applications.handlebars
    .getTemplate(`modules/${MODULE_ID}/templates/partials/tree-node.hbs`)
    .then((tpl) => Handlebars.registerPartial("sdeTreeNode", tpl))
    .catch((err) => console.error(`${MODULE_ID} | failed to register sdeTreeNode partial:`, err));

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
    "sde-cb-origins": `modules/${MODULE_ID}/templates/char-builder/steps/origins.hbs`,
    "sde-cb-hp": `modules/${MODULE_ID}/templates/char-builder/steps/hp.hbs`,
    "sde-cb-gold": `modules/${MODULE_ID}/templates/char-builder/steps/gold.hbs`,
    "sde-cb-hp-gold": `modules/${MODULE_ID}/templates/char-builder/steps/hp-gold.hbs`,
    "sde-cb-gear": `modules/${MODULE_ID}/templates/char-builder/steps/gear.hbs`,
    "sde-cb-preview": `modules/${MODULE_ID}/templates/char-builder/steps/preview.hbs`,
    "sde-cb-placeholder": `modules/${MODULE_ID}/templates/char-builder/steps/placeholder.hbs`,
  };
  for (const [name, path] of Object.entries(cbPartials)) {
    foundry.applications.handlebars
      .getTemplate(path)
      .then((tpl) => Handlebars.registerPartial(name, tpl))
      .catch((err) => console.error(`${MODULE_ID} | failed to register ${name} partial:`, err));
  }

  // "Character Builder" launch button in the Actors sidebar header — the single
  // entry point. It opens the builder with no actor (it creates a fresh one on
  // finish), so players don't need an existing sheet to start. Shown to every
  // user regardless of the ACTOR_CREATE permission (deliberate: players may not
  // hold that perm in every world but should still be able to launch the
  // builder). Sits alongside the core Create Actor / Create Folder buttons.
  //
  // The actor-sheet header button was removed in favour of this one. The
  // edit-in-place path it fed (builder writes back onto the launching actor
  // rather than spawning a duplicate) is still supported by commit.mjs and
  // reachable via `game.shadowdarkEnhancer.charBuilder.open({ actor })`.
  Hooks.on("renderActorDirectory", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const header = root?.querySelector(".directory-header");
    if (!header) return;
    if (header.querySelector(".sde-char-builder-launch")) return;
    // The core action-buttons row is only rendered when the user may create an
    // actor/folder; for permission-less players it can be absent. Reuse it when
    // present, otherwise build our own row so the button still shows.
    let actions = header.querySelector(".header-actions.action-buttons");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "header-actions action-buttons flexrow";
      header.prepend(actions);
    }
    // Mirror the Shadowdark system's own character-generator-button markup so
    // the button inherits the system's header styling; our own class is kept
    // for the click handler + dedup guard.
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "character-generator-button sde-char-builder-launch";
    btn.innerHTML =
      ICONS.charBuilder +
      `<b class="button-text">${game.i18n.localize("SDE.charBuilder.title")}</b>`;
    btn.addEventListener("click", () => ShadowdarkCharBuilder.open());
    actions.appendChild(btn);

    // GM-only: re-skin NPC tokens/portraits with art from a locally-installed
    // art module (default: the licensed Monster Manual). Reference-only.
    if (game.user.isGM && !actions.querySelector(".sde-monster-art-launch")) {
      const artBtn = document.createElement("button");
      artBtn.type = "button";
      artBtn.className = "sde-monster-art-launch";
      artBtn.innerHTML = `${ICONS.monsterArt}<span>${game.i18n.localize("SDE.tokenArt.button")}</span>`;
      artBtn.addEventListener("click", () => TokenArtManagerApp.open());
      actions.appendChild(artBtn);
    }
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
    // Monster token/portrait art — re-skin Shadowdark NPCs with art referenced
    // (never copied) from a locally-installed art module, default the licensed
    // dnd-monster-manual. See monster-art/monster-token-art.mjs.
    tokenArt: {
      // Full multi-source per-monster manager (Actors sidebar → "Monster Art").
      openManager: () => TokenArtManagerApp.open(),
      // Legacy single-source dialog (compendium overlay / re-skin / turn off).
      open: () => MonsterTokenArt.openDialog(),
      // Compendium-art overlay: skin EVERY future monster drag (GM). Generates
      // the shadowdark.monsters → art mapping and injects it (no relaunch).
      applyToCompendium: () => MonsterTokenArt.generateCompendiumMapping(),
      // Turn the compendium overlay back off (restore default art).
      restoreCompendium: () => MonsterTokenArt.disableCompendiumMapping(),
      // Re-skin already-placed monsters; pass { scene, actors, portraits, dryRun, minScore }.
      apply: (opts) => MonsterTokenArt.apply(opts),
      // Pure match: name → { token, portrait, score } | null (needs a file set).
      resolve: (name, sets, source, minScore) => MonsterTokenArt.resolveArt(name, sets, source, minScore),
      buildFileSets: (source) => MonsterTokenArt.buildFileSets(source),
      // Multi-source manager: catalog of all art sources + per-monster resolve.
      catalog: () => TokenArtCatalog.build(),
      // Full cross-source token library (every file) for the manual image browser.
      library: () => TokenArtCatalog.buildLibrary(),
      resolveCatalog: (cat) => TokenArtCatalog.resolve(cat),
      applyResolved: (table) => MonsterTokenArt.applyResolvedMapping(table),
    },
    // Bulk monster importer: paste a raw PDF statblock dump → preview/edit grid →
    // create NPC actors into the managed world compendium. See monster-importer-app.mjs.
    monsters: MonsterImporterAPI,
    mutator: {
      // Clone a bestiary/world actor, apply structurally authorized mechanics or
      // GM-adjudicated Features from validated IMPORTED matrix results, and
      // create a NEW world actor (source untouched). `resultRefs` are
      // { manifestId, tableUuid, resultId }
      // references — old static string ids throw a deprecation error before
      // anything is persisted. See monster-mutator.mjs.
      create: (baseUuid, resultRefs, customName = null) =>
        createMutatedActor(baseUuid, resultRefs, customName),
      createFromResults: (baseUuid, resultRefs, customName = null) =>
        createMutatedActor(baseUuid, resultRefs, customName),
      // Async: current locked/partial/ready/ambiguous/invalid state + dynamic
      // columns/results for the Generator and Make It Weird sets, read from the
      // GM's imported sde-tables matrices. See monster-table-runtime.mjs.
      catalog: () => monsterTableCatalog(),
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
      // Read-only Phase-1 Core magic-item table catalog: live readiness derived
      // from the GM's OWN imported sde-tables, plus import-seed builders and set
      // metadata. No persistent raw-prose API — result text is only ever the
      // GM's own imported content, read live at call time.
      catalog: () => magicCatalog(),
      sets: () => MAGIC_SET_DEFS,
      buildSetSeed: (setKey) => magicBuildSetSeed(setKey),
      buildChildSeed: (manifestId) => magicBuildChildSeed(manifestId),
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
      // Dedicated Class Importer — classes have their own guided workspace
      // (body → roll tables → titles) instead of the generic paste box.
      openClassImporter: async () => {
        const { ClassImporterApp } = await import("./encounter/class-importer-app.mjs");
        return ClassImporterApp.open();
      },
      // Dedicated Spell Importer — organizes spells by Class → Tier → Alignment
      // and tags them (system.class + tier + the shadowdark-extras alignment flag).
      openSpellImporter: async () => {
        const { SpellImporterApp } = await import("./encounter/spell-importer-app.mjs");
        return SpellImporterApp.open();
      },
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
  // Guarantee the system's "Searching Distant Lands…" loading spinner is never
  // orphaned when an Item sheet's getData() throws (e.g. a transient failure in
  // the compendium-scan path right after importing a class) — see
  // loading-dialog-guard.mjs. Installed at ready when shadowdark.apps/sheets are
  // available; sheets can't open before ready anyway.
  installLoadingDialogGuard();
  // Foundry-conventional API discovery point + interop ready signal (REQ-26).
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = game.shadowdarkEnhancer;
  Hooks.callAll("shadowdarkEnhancer.ready", game.shadowdarkEnhancer);
  // Surface our enhanced spells in SDX's Medkit so already-learned copies can be
  // updated to the automated versions. SDX sets its api during its own `ready`
  // hook, which may fire after ours, so poll briefly. No-op if SDX isn't present.
  (function registerMedkitPack(tries = 0) {
    const api = game.modules.get("shadowdark-extras")?.api;
    if (api?.registerMedkitPack) { api.registerMedkitPack("world.spells"); return; }
    if (game.modules.get("shadowdark-extras")?.active && tries < 20) {
      setTimeout(() => registerMedkitPack(tries + 1), 250);
    }
  })();
  CrawlState.init();
  registerHiddenSync();
  // Seed the char-builder Name/Trinket table sources from the legacy boolean
  // settings (one-shot, GM-only). Fire-and-forget — errors log inside.
  ClassAbilityUses.init();
  MovementTracker.init();
  CrawlStrip.init();
  CrawlBar.init();
  // If the GM enabled the monster compendium-art overlay, inject it now so every
  // monster drag carries the referenced art (all clients; GM-only settings write).
  MonsterTokenArt.initCompendiumArt();
  LootDrops.init();
  ItemDrops.init();
  MerchantShop.init();
  // Seed the two shipped default merchants (Base / Western Reaches). GM-only,
  // idempotent; fills in the WR merchant once its item pack is present.
  if (game.user.isGM) MerchantShop.seedDefaultMerchants();
  SessionRecap.init();
  checkCoexistence();
  if (game.user.isGM && !game.settings.get(MODULE_ID, "lootSetupSeen")) {
    const bound = boundCount(game.settings.get(MODULE_ID, "lootTierTables") ?? {});
    if (bound < 4) {
      ui.notifications.info("Shadowdark Enhancer: set up your loot tables so the Loot Generator produces real items — open the Loot Generator and click “Set up loot tables”.");
    }
    game.settings.set(MODULE_ID, "lootSetupSeen", true);
  }
  // When the module version changes, quietly bring already-imported monsters up
  // to fresh-import fidelity (icons, casing, spell items, art) — the retired
  // Maintenance → "Backfill monsters" button, now automatic. Idempotent and
  // non-destructive; deferred so it never delays ready; silent unless it
  // actually upgraded something. Version stamp only advances on success, so a
  // failed sweep retries next load.
  if (game.user.isGM) {
    const cur = String(game.modules.get(MODULE_ID)?.version ?? "");
    if (cur && game.settings.get(MODULE_ID, "backfillVersion") !== cur) {
      setTimeout(async () => {
        // Guard to the SINGLE active GM (game.users.activeGM), same as the
        // spell↔class sweep below: this writes to a compendium pack and then
        // stamps a world setting, so several GMs online would otherwise run it
        // concurrently. Checked at fire time, not at `ready` — activeGM can
        // differ five seconds later.
        if (game.users.activeGM?.id !== game.user.id) return;
        try {
          const { backfillTargets } = await import("./encounter/monster-backfill.mjs");
          const result = await backfillTargets({ scope: "pack", dryRun: false });
          if (result?.changed?.length) {
            ui.notifications.info(`Shadowdark Enhancer: ${result.changed.length} imported monster(s) upgraded to current import fidelity.`);
          }
          await game.settings.set(MODULE_ID, "backfillVersion", cur);
        } catch (err) {
          console.error(`${MODULE_ID} | auto-backfill after update failed:`, err);
        }
      }, 5000);
    }
    // Spell↔class self-heal, EVERY load (index-scan cheap, idempotent, silent
    // when there's nothing to do): spells imported before their caster class
    // existed link up as soon as both are present, whichever was created first.
    // Guard to the SINGLE active GM (game.users.activeGM) so a table with
    // several GMs online doesn't run the pack-write sweep concurrently — the
    // same pattern used by the merchant/loot/session-recap workers.
    setTimeout(async () => {
      if (game.users.activeGM?.id !== game.user.id) return;
      try {
        const { relinkSpellsToClasses } = await import("./encounter/item-importer.mjs");
        const n = await relinkSpellsToClasses();
        if (n) ui.notifications.info(`Shadowdark Enhancer: linked ${n} spell(s) to their caster class.`);
      } catch (err) {
        console.error(`${MODULE_ID} | spell↔class re-link sweep failed:`, err);
      }
    }, 5000);
    // Borrowed-list caster self-heal, EVERY load (index-scan cheap, idempotent,
    // silent when there's nothing to do): a Wizard-variant borrower (Green
    // Knight casts the neutral Druid list) whose spells were imported after the
    // class — or an existing world that predates this wiring — gets its class
    // uuid stamped onto its variant's spells so the level-up spellbook offers
    // exactly that list. Deferred so it never delays ready.
    setTimeout(async () => {
      try {
        const { tagBorrowedSpellLists } = await import("./encounter/class-unit-importer.mjs");
        const n = await tagBorrowedSpellLists();
        if (n) ui.notifications.info(`Shadowdark Enhancer: tagged ${n} spell(s) to a borrowed-list caster class.`);
      } catch (err) {
        console.error(`${MODULE_ID} | borrowed-list spell tag sweep failed:`, err);
      }
    }, 5000);
  }
});

function checkCoexistence() {
  if (!game.settings.get(MODULE_ID, "warnIfCrawlHelperEnabled")) return;
  if (game.modules.get("shadowdark-crawl-helper")?.active) {
    ui.notifications.warn(game.i18n.localize("SDE.notifications.crawlHelperConflict"));
  }
}
