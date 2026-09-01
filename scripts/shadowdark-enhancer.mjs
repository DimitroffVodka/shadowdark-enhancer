/**
 * Shadowdark Enhancer — entry point
 */

export { MODULE_ID } from "./shared/module-id.mjs";
import { MODULE_ID } from "./shared/module-id.mjs";
import { ICONS } from "./shared/icons.mjs";

import { registerSettings } from "./shared/settings.mjs";
import { CrawlState } from "./crawl-strip/crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip/crawl-strip.mjs";
import { registerCrawlTracker, refreshTracker } from "./crawl-strip/crawl-tracker.mjs";
import { init as luckRerollInit } from "./luck-reroll/luck-reroll.mjs";
import { init as spellMishapInit } from "./spell-mishap/spell-mishap.mjs";
import { init as prayerRollInit } from "./character-sheet/prayer-roll.mjs";
import { init as scavengerInit } from "./scavenger/scavenger.mjs";
import { Parry } from "./parry/parry.mjs";
import { Taunt } from "./taunt/taunt.mjs";
import { CrawlBar }      from "./crawl-bar/crawl-bar.mjs";
import { registerHiddenSync } from "./crawl-strip/hidden-sync.mjs";
import { registerTurnSkip } from "./crawl-strip/turn-skip.mjs";
import { MovementTracker } from "./crawl-strip/movement-tracker.mjs";
import { EncounterCheck } from "./encounter/encounter-check.mjs";
import { migrateEncounterSources } from "./encounter/encounter-sources.mjs";
import { MonsterCreator } from "./monster-creator/encounter-creator.mjs";
import {
  listMonsterSpellSources,
  previewMonsterSpellLibrary,
  runMonsterSpellLibraryRefresh,
} from "./monster-creator/monster-spell-library.mjs";
import { runMonsterSpellUpdateGate } from "./monster-creator/monster-spell-update-gate.mjs";
import { createMutatedActor } from "./monster-creator/monster-mutator.mjs";
import { registerQuickAdjustHUD } from "./monster-creator/quick-adjust-app.mjs";
import { catalog as monsterTableCatalog } from "./monster-creator/monster-table-runtime.mjs";
import { LootCatalog } from "./loot/loot-catalog.mjs";
import { LootGenerator } from "./loot/loot-generator.mjs";
import { LootDelivery } from "./loot/loot-delivery.mjs";
import { LootDrops } from "./loot/loot-drops.mjs";
import { ItemDrops } from "./loot/item-drops.mjs";
import { LootTableTag } from "./loot/loot-table-tag.mjs";
import { TableRegistry } from "./importer/tables/table-registry.mjs";
import {
  MAGIC_SET_DEFS,
  catalog as magicCatalog,
  buildSetSeed as magicBuildSetSeed,
  buildChildSeed as magicBuildChildSeed,
} from "./magic-forge/magic-table-runtime.mjs";
import { boundCount } from "./loot/loot-table-catalog.mjs";
import { installCompoundRollTable } from "./importer/tables/compound-table.mjs";
import { installLoadingDialogGuard } from "./shared/loading-dialog-guard.mjs";
import { TableEnricher } from "./importer/tables/table-enrich.mjs";
import { MonsterImporterAPI } from "./importer/monsters/monster-importer-app.mjs";
import { segmentDump } from "./importer/dump-segmenter.mjs";
import { parseItem } from "./importer/items/item-parser.mjs";
import { ItemImporter } from "./importer/items/item-importer.mjs";
// Curated-icon maps register themselves on import (A4). Loaded here, once and
// unconditionally, so every consumer sees the same registry regardless of which
// of them happens to be reached first. Each map module owns its data rows.
import "./shared/curated-icon-maps/index.mjs";
import { MonsterLinker } from "./importer/monsters/monster-linker.mjs";
import { LootLinker } from "./loot/loot-linker.mjs";
import { ensureLootPack } from "./loot/loot-pack.mjs";
import { findSuitePack } from "./shared/compendium-suite.mjs";
import { generatedItemId, planGeneratedItems, reconcileGeneratedItems } from "./shared/generated-items.mjs";
import { buildBundle, exportBundle, applyBundle } from "./importer/bundle-io.mjs";
import { MerchantShop } from "./merchant/merchant-shop.mjs";
import { PartyXP } from "./party-xp/party-xp.mjs";
import { SessionRecap } from "./session-recap/session-recap.mjs";
import { DowntimeSession } from "./downtime/downtime-session.mjs";
import { Renown } from "./renown/renown.mjs";
import { registerActorTypes } from "./actors/register-actors.mjs";
// Imported for its top-level createChatMessage hook: the out-of-combat
// initiative sync must be live on the GM from load, not only after the GM
// personally triggers the lazy import in crawl-strip. Otherwise a player who
// rolls OoC initiative first reaches a GM whose hook isn't registered yet and
// the roll never lands in CrawlState.
import "./crawl-strip/initiative-manager.mjs";
import { registerArtGalleryQuery } from "./char-builder/art-gallery.mjs";
import { ClassAbilityUses } from "./char-builder/class-ability-uses.mjs";
import { MonsterTokenArt } from "./monster-art/monster-token-art.mjs";
import { TokenArtCatalog } from "./monster-art/token-art-catalog.mjs";
import { PdfSheetExport } from "./pdf-export/pdf-sheet-export.mjs";
import { initRivalClassTable } from "./forge-loot/rival-class-table-adapter.mjs";

// Foundry can retain a module stylesheet across reloads while fetching fresh
// templates, producing unstyled block-flow UI. Keep the manifest stylesheet as
// the startup fallback, then layer a content-addressed copy above it. The layout
// contract test requires this revision to change whenever the CSS file changes.
const STYLESHEET_REV = "4c7a54a7eb49";

function ensureFreshStylesheet() {
  const id = `${MODULE_ID}-fresh-stylesheet`;
  document.getElementById(id)?.remove();
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `modules/${MODULE_ID}/styles/shadowdark-enhancer.css?v=${STYLESHEET_REV}`;
  // Foundry pulls the manifest stylesheet in via an @import (inside a shared
  // inline <style>) and/or a plain <link>. That copy is served from cache and
  // can be STALE — an old build's `!important` rules then win over this
  // content-addressed copy regardless of specificity, so edited styles never
  // appear until a manual cache-clear (which Foundry's Ctrl+Shift+R interception
  // makes awkward). Once the fresh copy has loaded, drop the stale one so only
  // the current CSS applies. Gated on `load` so there's never a frame without
  // our stylesheet; re-run at `ready` as a backstop for late @import injection.
  const cssPath = `modules/${MODULE_ID}/styles/shadowdark-enhancer.css`;
  const drop = () => dropStaleModuleStylesheet(cssPath, id);
  link.addEventListener("load", drop, { once: true });
  document.head.append(link);
  if (link.sheet) drop();          // already cached/parsed synchronously
  Hooks.once("ready", drop);
}

// Remove the stale manifest copy of our stylesheet: delete any @import rule that
// pulls it in (leaving other modules' imports in the shared <style> untouched)
// and disable any non-content-addressed <link> to it. Never touches the fresh
// `?v=` copy (id === keepId, or any href carrying `?v=`). Idempotent.
function dropStaleModuleStylesheet(cssPath, keepId) {
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin
      if (!rules) continue;
      for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i];
        if (r.type === CSSRule.IMPORT_RULE && (r.href || "").includes(cssPath)) {
          try { sheet.deleteRule(i); } catch { /* live sheet churn */ }
        }
      }
    }
    for (const l of document.querySelectorAll('link[rel~="stylesheet"]')) {
      if (l.id === keepId) continue;
      const href = l.getAttribute("href") || "";
      if (href.includes(cssPath) && !href.includes("?v=")) l.disabled = true;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | could not drop stale stylesheet`, err);
  }
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
  // Keep the derived Rival class table in step with class imports.  The
  // listener is GM-gated and debounced; ClassIndex.invalidate() itself stays a
  // synchronous cache operation with a fire-and-forget notification.
  initRivalClassTable({ game });
  registerSettings();
  // Register Western Reaches as an official source tag for items, so it appears
  // in the Source dropdown alongside the system's built-in books.
  const sd = game.shadowdark;
  if (sd?.config?.OFFICIAL_SOURCES && !sd.config.OFFICIAL_SOURCES["western-reaches"]) {
    sd.config.OFFICIAL_SOURCES["western-reaches"] = "Shadowdark RPG: Western Reaches";
  }
  MerchantShop.registerSettings();
  SessionRecap.registerSettings();
  ItemDrops.registerSettings();
  Renown.registerSettings();
  MonsterTokenArt.register();
  // Out-of-combat tracker as a sidebar tab, beside Combat. Must run in init:
  // Game#initializeUI constructs CONFIG.ui entries during setup, and anything
  // registered after that pass never gets an instance.
  registerCrawlTracker();
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
    btn.addEventListener("click", async () =>
      (await import("./char-builder/char-builder-app.mjs")).ShadowdarkCharBuilder.open());
    actions.appendChild(btn);

    // GM-only: re-skin NPC tokens/portraits with art from a locally-installed
    // art module (default: the licensed Monster Manual). Reference-only.
    if (game.user.isGM && !actions.querySelector(".sde-monster-art-launch")) {
      const artBtn = document.createElement("button");
      artBtn.type = "button";
      artBtn.className = "sde-monster-art-launch";
      artBtn.innerHTML = `${ICONS.monsterArt}<span>${game.i18n.localize("SDE.tokenArt.button")}</span>`;
      artBtn.addEventListener("click", async () =>
        (await import("./monster-art/token-art-manager-app.mjs")).TokenArtManagerApp.open());
      actions.appendChild(artBtn);
    }
  });

  // Expose API. Public, versioned surface (REQ-26) — additive changes bump
  // the minor version, breaking changes the major. Mirrored at
  // game.modules.get(MODULE_ID).api on ready; consumers should listen for
  // the "shadowdarkEnhancer.ready" hook. Reference: docs/API.md.
  game.shadowdarkEnhancer = {
    // 1.4.0 — additive: Forge & Loot preview shell namespace (G4).
    apiVersion: "1.4.0",
    // Guided, ordered Character Builder — a replacement for the system's
    // random generator. `open({ level0?, actor? })` renders the wizard.
    charBuilder: {
      open: async (opts = {}) =>
        (await import("./char-builder/char-builder-app.mjs")).ShadowdarkCharBuilder.open(opts),
      // Lazy since the 0.11.x lazy-load pass: the wizard parses on first use.
      // The bare-class `app` property became the async `appClass()` accessor
      // (docs/API.md) — a sync class handle would force the whole tree eager.
      appClass: async () =>
        (await import("./char-builder/char-builder-app.mjs")).ShadowdarkCharBuilder,
    },
    // Vehicles. `importBoats()` is the macro-friendly entry for the Western
    // Reaches boats (p118) — the Importer Hub Manage tree exposes the same per
    // boat via Unlock rows. Parses the cited page from the user's own PDF; no
    // stats are bundled.
    actors: {
      importBoats: async () => {
        const { ImporterHubApp } = await import("./importer/importer-hub-app.mjs");
        return ImporterHubApp.openContentUnlock({ name: "Canoe", src: "WR", type: "Boat", page: "118" });
      },
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
      openRoller: async (tab, seed) =>
        (await import("./encounter/encounter-roller-app.mjs")).EncounterRollerApp.open(tab, seed),
      setActiveTable: (uuid) => game.settings.set(MODULE_ID, "encounterTableUuid", uuid || ""),
      getThreshold: () => game.settings.get(MODULE_ID, "encounterThreshold"),
      setThreshold: (n) => game.settings.set(MODULE_ID, "encounterThreshold", n),
    },
    monsterCreator: {
      open: () => MonsterCreator.open(),
    },
    // Locally generated, GM-only copies of embedded monster Spell items. Source
    // Actors keep their embedded copies; attaching from the Creator makes a new
    // embedded copy on the destination NPC.
    monsterSpells: {
      listSources: () => listMonsterSpellSources({ game }),
      preview: (opts) => previewMonsterSpellLibrary({ ...(opts ?? {}), game }),
      refresh: (opts) => runMonsterSpellLibraryRefresh({ ...(opts ?? {}), game }),
    },
    // Monster token/portrait art — re-skin Shadowdark NPCs with art referenced
    // (never copied) from a locally-installed art module, default the licensed
    // dnd-monster-manual. See monster-art/monster-token-art.mjs.
    tokenArt: {
      // Full multi-source per-monster manager (Actors sidebar → "Monster Art").
      openManager: async () =>
        (await import("./monster-art/token-art-manager-app.mjs")).TokenArtManagerApp.open(),
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
      open: async () => (await import("./loot/loot-generator-app.mjs")).LootGeneratorApp.open(),
      openSetup: async () => (await import("./loot/loot-setup-app.mjs")).LootSetupApp.open(),
      // Resolve one loot-row text against every installed Item pack (A7).
      // Exact/alias only; returns the reason, so an ambiguous row is
      // distinguishable from an unmatched one. See loot-resolution.mjs.
      resolve: async (text) => LootLinker.resolveLootItem(text, await LootLinker.buildItemIndex()),
      // Stable identity + replace-always reconciliation for generated Items in
      // the managed Items pack. `plan` is pure and writes nothing; `reconcile`
      // applies it. GM-only. See shared/generated-items.mjs.
      generated: {
        identity: (source, name) => generatedItemId(source, name),
        plan: async (desired, { source = "" } = {}) => {
          const pack = findSuitePack("sde-items");
          if (!pack) return null;
          return planGeneratedItems({
            desired,
            existing: (await pack.getDocuments()).map((d) => d.toObject()),
            packCollection: pack.collection,
            source,
          });
        },
        reconcile: async (desired, { source = "" } = {}) => {
          if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can reconcile generated items."); return null; }
          const pack = await ensureLootPack();
          return pack ? reconcileGeneratedItems(pack, desired, { source }) : null;
        },
      },
    },
    // Shared preview-first shell for the future NPC and Rival Crawlers
    // generators. Generator rules and document writes stay behind its adapter
    // seam; opening the shell alone performs no persistence.
    forgeLoot: {
      open: async (opts = {}) => (await import("./forge-loot/forge-loot-app.mjs")).ForgeLootApp.open(opts),
    },
    forge: {
      open: async () => (await import("./magic-forge/magic-forge-app.mjs")).MagicForgeApp.open(),
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
      openHub: async (tab, seed) =>
        (await import("./importer/importer-hub-app.mjs")).ImporterHubApp.open(
          (!tab || tab === "dashboard") ? "tables" : tab,
          seed,
        ),
      // Dedicated Class Importer — classes have their own guided workspace
      // (body → roll tables → titles) instead of the generic paste box.
      openClassImporter: async () => {
        const { ClassImporterApp } = await import("./importer/char-content/class-importer-app.mjs");
        return ClassImporterApp.open();
      },
      // Dedicated Spell Importer — organizes spells by Class → Tier → Alignment
      // and tags them (system.class + tier + the shadowdark-extras alignment flag).
      openSpellImporter: async () => {
        const { SpellImporterApp } = await import("./importer/spells/spell-importer-app.mjs");
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
    // Downtime — the between-crawls activity window (carousing, training,
    // research). Ships the mechanical skeleton only; outcome text is unlocked
    // per source from the GM's own book. See downtime-app.mjs.
    downtime: {
      open: async () => (await import("./downtime/downtime-app.mjs")).DowntimeApp.open(),
      // Table session: the GM opens downtime for the whole party, each player
      // picks their own activity and rolls their own dice.
      startSession: (sourceSlug) => DowntimeSession.start(sourceSlug),
      endSession: () => DowntimeSession.end(),
      lockRolls: () => DowntimeSession.setPhase("roll"),
      releaseRolls: () => DowntimeSession.setPhase("select"),
      sessionState: () => foundry.utils.deepClone(DowntimeSession.state),
    },
    // Renown — the Western Reaches fame track (p233). The number itself is the
    // SYSTEM's field (`system.renown`); this is the single write path plus the
    // band ladder that the reaction roll and the downtime window read.
    renown: {
      // GM award / dock dialog, which doubles as the party renown roster.
      open: (opts) => Renown.openDialog(opts),
      // The one write path. GM-only; logs to the Session Recap and posts a card.
      award: (args) => Renown.award(args),
      // Set renown to the book's starting value (the character's CHA modifier).
      seedFromCha: (actor, opts) => Renown.seedFromCha(actor, opts),
      // The same seed, but only if this character is still owed one. What the
      // `renownOnCreate` setting fires on a new character; pass force to re-seed.
      maybeSeedFromCha: (actor, opts) => Renown.maybeSeedFromCha(actor, opts),
      // Reads: value, band ({key,label,bonus,note}), bonus (0–3).
      valueOf: (actor) => Renown.valueOf(actor),
      bandOf: (actor) => Renown.bandOf(actor),
      bonusOf: (actor) => Renown.bonusOf(actor),
      // Party roster, highest renown first.
      party: () => Renown.party(),
      // The permanent per-character ledger, and the whole party's grouped by
      // the player who owned the character when each change was made.
      history: (actor) => Renown.history(actor),
      historyByPlayer: () => Renown.historyByPlayer(),
    },
    // Pit Fighting — CS2's bouts (pgs 20–24). Mechanics only: the venue, twist,
    // prize and foe text all come from RollTables the GM imports from their own
    // book, and the window names any that are missing instead of inventing them.
    pitFighting: {
      // The bout roller (GM only). Lazy — nothing loads until it is opened.
      open: async () => (await import("./pit-fighting/pit-fighting-app.mjs")).PitFightingApp.open(),
      // Headless set-up: rolls venue / stakes / twist, picks the encounter table
      // and reads what it can out of the imported tables.
      setUpBout: async (args) =>
        (await import("./pit-fighting/pit-fighting-app.mjs")).PitFighting.setUpBout(args),
      // Award a bout's fame; routes through Renown.award, so it is logged there.
      awardFame: async (args) =>
        (await import("./pit-fighting/pit-fighting-app.mjs")).PitFighting.awardFame(args),
    },
  };
});

// Quench regression batches (dev installs only). Lazy: nothing loads unless
// the Quench module is active and fires quenchReady. test/ never ships in the
// release zip, so on a released install the import 404s and the catch no-ops.
Hooks.on("quenchReady", async (quench) => {
  const batches = [
    ["../test/quench/combat-state.batch.mjs",         "registerCombatStateBatch"],
    ["../test/quench/importer-roundtrip.batch.mjs",   "registerImporterRoundtripBatch"],
    ["../test/quench/merchant-transaction.batch.mjs", "registerMerchantTransactionBatch"],
    ["../test/quench/movement-rollback.batch.mjs",    "registerMovementRollbackBatch"],
    ["../test/quench/creator-update.batch.mjs",       "registerCreatorUpdateBatch"],
    ["../test/quench/gear-currency.batch.mjs",        "registerGearCurrencyBatch"],
  ];
  for (const [path, fn] of batches) {
    try {
      const mod = await import(path);
      mod[fn](quench);
    } catch (err) {
      console.debug(`${MODULE_ID} | Quench batch ${path} not available (expected on a release install)`, err);
    }
  }
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  // Renown's level-up watcher. GM clients only; the award itself is gated to
  // the single ACTIVE GM inside, so the always-on Bridge client cannot make it
  // fire twice.
  Renown.init();
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
  // The sidebar rendered during setup, before the line above read the saved
  // crawl state, so the tracker tab's rail button is still hidden on a world
  // reloaded mid-crawl. Re-evaluate it now that the state is real.
  refreshTracker();
  registerHiddenSync();
  registerTurnSkip();
  // Seed the char-builder Name/Trinket table sources from the legacy boolean
  // settings (one-shot, GM-only). Fire-and-forget — errors log inside.
  ClassAbilityUses.init();
  MovementTracker.init();
  CrawlStrip.init();
  luckRerollInit();
  spellMishapInit();
  prayerRollInit();
  scavengerInit();
  Parry.init();
  Taunt.init();
  CrawlBar.init();
  // If the GM enabled the monster compendium-art overlay, inject it now so every
  // monster drag carries the referenced art (all clients; GM-only settings write).
  MonsterTokenArt.initCompendiumArt();
  LootDrops.init();
  ItemDrops.init();
  // Token HUD "adjust monster level" button (GM-only, NPC tokens).
  registerQuickAdjustHUD();
  MerchantShop.init();
  // Seed the two shipped default merchants (Base / Western Reaches). GM-only,
  // idempotent; fills in the WR merchant once its item pack is present.
  if (game.user.isGM) MerchantShop.seedDefaultMerchants();
  SessionRecap.init();
  // Downtime sessions: sync listener, GM query handler, announcement-card
  // wiring. Runs on EVERY client (players included) — players need the listener
  // for the state nudge and the card button. The raw socket carries only the
  // payload-free nudge; every player action that mutates world state arrives as
  // an authenticated user query, so the GM knows who asked.
  DowntimeSession.init();
  checkCoexistence();
  if (game.user.isGM && !game.settings.get(MODULE_ID, "lootSetupSeen")) {
    const bound = boundCount(game.settings.get(MODULE_ID, "lootTierTables") ?? {});
    if (bound < 4) {
      ui.notifications.info("Shadowdark Enhancer: set up your loot tables so the Loot Generator produces real items — open the Loot Generator and click “Set up loot tables”.");
    }
    game.settings.set(MODULE_ID, "lootSetupSeen", true);
  }
  // Repair encounter-source lists that name a compendium the Shadowdark system
  // has since renamed (4.x: shadowdark.bestiary → shadowdark.monsters). Changing
  // the registered default only fixes worlds that never toggled the Browse tab's
  // source pills; a world that DID toggle them has a stored array still naming
  // the old pack, which resolves to nothing and silently browses one dead source.
  // Idempotent and silent — after the first repair migrateEncounterSources
  // returns null, so this costs one settings read per load. Guarded to the single
  // active GM because it writes a world setting.
  if (game.users.activeGM?.id === game.user.id) {
    try {
      const migrated = migrateEncounterSources(game.settings.get(MODULE_ID, "encounterSources"));
      if (migrated) {
        game.settings.set(MODULE_ID, "encounterSources", migrated);
        console.log(`${MODULE_ID} | encounter sources migrated to renamed system packs:`, migrated);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | encounter-source migration failed:`, err);
    }
  }
  // Monster Spell upkeep: the legacy-pack consolidation (#54) every activation,
  // and the Core + managed Enhancer Actors refresh once per module version
  // (#75). Both write, so both are gated to the single active GM checked at fire
  // time — see monster-spell-update-gate.mjs for the rule that the version stamp
  // advances only after a complete successful refresh, and for why a failed
  // consolidation defers the refresh while the retired pack still holds content.
  if (game.user.isGM) {
    setTimeout(() => {
      runMonsterSpellUpdateGate({ game }).catch(err => {
        console.error(`${MODULE_ID} | Monster Spell update gate failed:`, err);
      });
    }, 1000);

    // When the module version changes, quietly bring already-imported monsters
    // up to fresh-import fidelity. The version stamp advances only on success.
    // Keep a completion promise so the E2 text pass cannot race this legacy
    // full-fidelity worker: that worker rebuilds system.notes and embedded Items
    // from a draft and could otherwise put plain text back after E2 enriched it.
    let legacyBackfillDone = Promise.resolve(true);
    const cur = String(game.modules.get(MODULE_ID)?.version ?? "");
    if (cur && game.settings.get(MODULE_ID, "backfillVersion") !== cur) {
      legacyBackfillDone = new Promise((resolve) => {
        setTimeout(async () => {
          // Guard to the SINGLE active GM (game.users.activeGM), same as the
          // spell↔class sweep below: this writes to a compendium pack and then
          // stamps a world setting, so several GMs online would otherwise run it
          // concurrently. Checked at fire time, not at `ready` — activeGM can
          // differ five seconds later.
          if (game.users.activeGM?.id !== game.user.id) {
            // Nothing was attempted on this client. That is a legitimate no-op;
            // E2 has its own active-GM gate and may make the same decision.
            resolve(true);
            return;
          }
          try {
            const { backfillTargets } = await import("./importer/monsters/monster-backfill.mjs");
            const result = await backfillTargets({ scope: "pack", dryRun: false });
            if (!result || !Array.isArray(result.failed) || result.failed.length > 0) {
              console.error(`${MODULE_ID} | auto-backfill did not complete:`, result);
              resolve(false);
              return;
            }
            if (result?.changed?.length) {
              ui.notifications.info(`Shadowdark Enhancer: ${result.changed.length} imported monster(s) upgraded to current import fidelity.`);
            }
            await game.settings.set(MODULE_ID, "backfillVersion", cur);
            resolve(true);
          } catch (err) {
            console.error(`${MODULE_ID} | auto-backfill after update failed:`, err);
            // Preserve the failure for the dependent E2 consumer. Its
            // missing-only pass must wait for the legacy worker to be healthy;
            // otherwise the next activation's legacy rebuild can erase E2's
            // markup while E2's own stamp falsely says it is current.
            resolve(false);
          }
        }, 5000);
      });
    }
    // E2: fill only missing monster-context markup in managed Enhancer Actors.
    // A6 owns the active-GM/version gate and per-document retry report; this
    // consumer owns its independent stamp and transform policy. Awaiting the
    // legacy worker above keeps its full draft rebuild from racing these writes.
    setTimeout(async () => {
      try {
        const { runMonsterTextBackfillAfterLegacy } = await import("./importer/monsters/monster-text-backfill.mjs");
        const result = await runMonsterTextBackfillAfterLegacy({ game, legacyBackfillDone });
        if (result?.status === "completed" && result.applied?.length) {
          ui.notifications.info(`Shadowdark Enhancer: enriched monster text for ${result.applied.length} imported monster(s).`);
        } else if (result?.status === "failed") {
          console.error(`${MODULE_ID} | automatic monster text backfill did not complete:`, result);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | automatic monster text backfill failed:`, err);
      }
    }, 5000);
    // E3: persist the reviewed source/name creature taxonomy on managed
    // imported NPCs and Mounts. A6 owns the active-GM/version/pack lifecycle;
    // SDX is optional and is consulted only through its runtime map, so an
    // absent SDX install is a clean SDE-only run.
    setTimeout(async () => {
      try {
        const { runCreatureTypeBackfill } = await import("./importer/monsters/creature-type-backfill.mjs");
        const result = await runCreatureTypeBackfill({ game });
        if (result?.status === "completed" && result.counts?.applied) {
          ui.notifications.info(`Shadowdark Enhancer: assigned creature types to ${result.counts.applied} imported Actor(s).`);
        } else if (result?.status === "failed") {
          console.error(`${MODULE_ID} | automatic creature-type backfill did not complete:`, result);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | automatic creature-type backfill failed:`, err);
      }
    }, 5000);
    // Spell↔class self-heal, EVERY load (index-scan cheap, idempotent, silent
    // when there's nothing to do): spells imported before their caster class
    // existed link up as soon as both are present, whichever was created first.
    // Guard to the SINGLE active GM (game.users.activeGM) so a table with
    // several GMs online doesn't run the pack-write sweep concurrently — the
    // same pattern used by the merchant/loot/session-recap workers.
    setTimeout(async () => {
      if (game.users.activeGM?.id !== game.user.id) return;
      try {
        const { relinkSpellsToClasses } = await import("./importer/items/item-importer.mjs");
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
    // exactly that list. Deferred so it never delays ready. Guarded to the
    // SINGLE active GM like the sweep above — it writes spell items, so several
    // GMs online would otherwise run it concurrently.
    setTimeout(async () => {
      if (game.users.activeGM?.id !== game.user.id) return;
      try {
        const { tagBorrowedSpellLists } = await import("./importer/char-content/class-unit-importer.mjs");
        const n = await tagBorrowedSpellLists();
        if (n) ui.notifications.info(`Shadowdark Enhancer: tagged ${n} spell(s) to a borrowed-list caster class.`);
      } catch (err) {
        console.error(`${MODULE_ID} | borrowed-list spell tag sweep failed:`, err);
      }
    }, 5000);
    // Class-grant self-heal, EVERY load (index-scan cheap, idempotent, silent
    // when there's nothing to do): classes imported before natural weapons and
    // priced gear were told apart granted BOTH, so the char-builder issued every
    // new Duelist a free Rapier and Falchion. Strip the gear back out so
    // existing worlds don't need a re-import. Same single-active-GM guard as the
    // sweeps above — it writes Class items.
    setTimeout(async () => {
      if (game.users.activeGM?.id !== game.user.id) return;
      try {
        const { pruneBoughtGearGrants } = await import("./importer/char-content/class-unit-importer.mjs");
        const n = await pruneBoughtGearGrants();
        if (n) ui.notifications.info(`Shadowdark Enhancer: ${n} class(es) no longer hand out purchasable gear at character creation.`);
      } catch (err) {
        console.error(`${MODULE_ID} | class-grant prune sweep failed:`, err);
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
