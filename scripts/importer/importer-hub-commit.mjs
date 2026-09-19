/**
 * Importer Hub — per-type commit flows (monsters/items/spells/tables/char)
 *
 * Conflict dialogs, quality gates, magic-bundle plan, and the GM-gated commits into the sde-* packs.
 * Split out of importer-hub-app.mjs (2026-07); methods are moved VERBATIM and
 * installed onto ImporterHubApp.prototype by installHubCommit(cls) — `this` is
 * always the live hub app instance. The import of ImporterHubApp is circular
 * with the shell on purpose and only dereferenced at runtime inside method
 * bodies (never at module top level).
 */

import { TableImporter } from "./tables/table-importer.mjs";
import { MAGIC_SET_DEFS, matchBundleTables } from "../magic-forge/magic-table-runtime.mjs";
import { resolveSpellClass, ClassIndex } from "./char-content/class-index.mjs";
import { MonsterImporter } from "./monsters/monster-importer.mjs";
import { BoatImporter } from "./boats/boat-importer.mjs";
import { commitHexDrafts } from "./hex/hex-commit.mjs";
import { datasetFromEntry, handoffDataset } from "./hex/hex-handoff.mjs";
import { validateHexDataset } from "./hex/hex-dataset.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { installMethods, t } from "./importer-hub-shared.mjs";
import { ImporterHubApp } from "./importer-hub-app.mjs";
import { buildUnlockRecord, readStored } from "../downtime/downtime-core.mjs";
import {
  SOURCES as DOWNTIME_SOURCES,
  SOURCE_SLUGS as DOWNTIME_SLUGS,
  EXPECTED_SLOT_COUNT as DOWNTIME_SLOT_COUNT,
} from "../downtime/downtime-skeleton.mjs";

class HubCommitMethods {

  // ── Import-tab commit actions ─────────────────────────────────────────────

  /** Conflict dialog for monster name collisions (rename/replace/skip). */
  _monsterConflictDialog() {
    return async (name) => {
      // An unattended batch run pre-answers this (importer-hub-batch.mjs):
      // "skip" keeps what's already in the library, so a second run over the
      // same books creates nothing and duplicates nothing.
      if (this._batchAuto) return this._batchAuto.conflict;
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: t("SDE.importer.conflict.monsterTitle") },
        content: `<p>${t("SDE.importer.conflict.monster", { name: safe })}</p>`,
        buttons: [
          { action: "rename",  label: t("SDE.importer.conflict.importCopy"), default: true },
          { action: "replace", label: t("SDE.importer.conflict.replace") },
          { action: "skip",    label: t("SDE.importer.conflict.skip") },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /** Conflict dialog for table name collisions (rename/replace/cancel). */
  _tableConflictDialog() {
    return async (name) => {
      // Batch run: "cancel" skips THIS table and the commit loop carries on to
      // the next one — tables have no "skip" action, and cancel is its shape.
      if (this._batchAuto) return this._batchAuto.tableConflict;
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: t("SDE.importer.conflict.tableTitle") },
        content: `<p>${t("SDE.importer.conflict.table", { name: safe })}</p>`,
        buttons: [
          { action: "rename",  label: t("SDE.importer.conflict.createCopy"), default: true },
          { action: "replace", label: t("SDE.importer.conflict.replace") },
          { action: "cancel",  label: t("SDE.importer.btn.cancel") },
        ],
        rejectClose: false,
      }).catch(() => "cancel");
      return choice ?? "cancel";
    };
  }

  /** Conflict dialog for item name collisions (rename/replace/skip). */
  _itemConflictDialog() {
    return async (name) => {
      if (this._batchAuto) return this._batchAuto.conflict;
      const safe = foundry.utils.escapeHTML(name);
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: t("SDE.importer.conflict.itemTitle") },
        content: `<p>${t("SDE.importer.conflict.item", { name: safe })}</p>`,
        buttons: [
          { action: "rename",  label: t("SDE.importer.conflict.keepBoth"), default: true },
          { action: "replace", label: t("SDE.importer.conflict.replace") },
          { action: "skip",    label: t("SDE.importer.conflict.skip") },
        ],
        rejectClose: false,
      }).catch(() => "skip");
      return choice ?? "skip";
    };
  }

  /**
   * Shared commit-report line: "N created[, N updated][, N replaced][, N
   * skipped][, N kept beside a Monster Spell]" — the single formatter for every
   * per-type commit notification (was copy-pasted per handler; review
   * 2026-07-11 maintainability).
   *
   * The last part is A8/#93: a Replace that landed on a generated Monster Spell
   * was turned into a Keep-both. Each one already raised its own named warning;
   * this makes the count visible in the summary the GM reads either way.
   */
  static _commitSummary(result) {
    const parts = [`${result.created.length} created`];
    if (result.updated?.length) parts.push(`${result.updated.length} updated`);
    if (result.replaced?.length) parts.push(`${result.replaced.length} replaced`);
    if (result.skipped?.length) parts.push(`${result.skipped.length} skipped`);
    if (result.collisions?.length) parts.push(`${result.collisions.length} kept beside a Monster Spell`);
    return parts.join(", ");
  }

  /**
   * Read-only one-line stat summary for a Weapon/Armor draft, mirroring the
   * system's item subtext (AC/attribute/properties for armor; type/range/damage/
   * properties for weapons). Empty string for plain gear (no stat line shown).
   */
  static _gearStatLine(draft) {
    if (!draft) return "";
    const props = (draft.propNames ?? []).join(", ");
    if (draft.type === "Armor") {
      const base = Number(draft.ac?.base) || 0;
      const mod = Number(draft.ac?.modifier) || 0;
      const ac = base || mod ? `AC ${base || ""}${mod ? (mod > 0 ? `+${mod}` : mod) : ""}`.trim() : "";
      const attr = draft.ac?.attribute ? draft.ac.attribute.toUpperCase() : "";
      return [ac, attr, props].filter(Boolean).join(" • ");
    }
    if (draft.type === "Weapon") {
      const dmg = [draft.damage?.oneHanded, draft.damage?.twoHanded].filter(Boolean).join(" / ");
      const type = draft.wtype ? draft.wtype[0].toUpperCase() + draft.wtype.slice(1) : "";
      return [type, draft.range, dmg, props].filter(Boolean).join(" • ");
    }
    return "";
  }

  /**
   * Preview description edits: keep deliberately-typed HTML (sanitized again
   * at the commit choke point, review #1), wrap plain text as one paragraph
   * (D4). Shared by the item and spell field-edit wiring.
   */
  static _wrapEditedHtml(v) {
    const trimmed = String(v ?? "").trim();
    return trimmed.startsWith("<") ? trimmed : (trimmed ? `<p>${trimmed}</p>` : "<p></p>");
  }

  /** Commit: create all pending items into sde-items. GM-gated. */
  async _onHubCommitItems() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.items")); return; }
    if (!this._importItems.length) { ui.notifications.warn(t("SDE.importer.empty.items")); return; }

    const source = this._importSource.trim();
    const drafts = this._importItems.map((p) => p.draft);
    // Siege weapons carry Blast/Exploding — not in the core properties pack.
    // Materialize them as Property items + stamp UUIDs before the create.
    if (drafts.some((d) => d.siegeProperties?.length)) {
      const { prepareSiegeProperties } = await import("./boats/siege-importer.mjs");
      if (!(await prepareSiegeProperties(drafts))) return;
    }
    // The Paladin's Lance carries three WR-only properties absent from the
    // system pack. Materialize/reuse their canonical Property docs before the
    // weapon itself is created, just like the siege-property path above.
    if (drafts.some((d) => d.lanceProperties?.length)) {
      const { prepareLanceProperties } = await import("./items/wr-property-importer.mjs");
      if (!(await prepareLanceProperties(drafts))) return;
    }
    const { ItemImporter } = await import("./items/item-importer.mjs");
    const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
    if (!result) return;

    ui.notifications.info(t("SDE.importer.done.items", { summary: ImporterHubApp._commitSummary(result), source: source ? ` / ${source}` : "" }));
    this._importItems = [];
    this._invalidateItemsCache();
    this.render();
  }

  /**
   * Resolve each spell draft's class name → UUID, then create all pending
   * spells into sde-items. Returns the createItems result (or null).
   */
  async _commitSpells(source) {
    if (!this._importSpells.length) return null;
    const drafts = this._importSpells.map((p) => p.draft);
    // A class imported earlier this session (e.g. Necromancer) must resolve —
    // same staleness guard as the Spell Importer app's commit.
    ClassIndex.invalidate();
    const unresolved = [];
    for (const d of drafts) {
      const w = await resolveSpellClass(d);
      if (w) unresolved.push(d.name);
    }
    const { ItemImporter } = await import("./items/item-importer.mjs");
    const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
    if (unresolved.length) {
      ui.notifications.warn(t("SDE.importer.done.spellsUnlinked", { n: unresolved.length, names: unresolved.slice(0, 3).join(", ") + (unresolved.length > 3 ? "…" : "") }));
    }
    return result;
  }

  /** Commit: create all pending spells into sde-items. GM-gated. */
  async _onHubCommitSpells() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.spells")); return; }
    if (!this._importSpells.length) { ui.notifications.warn(t("SDE.importer.empty.spells")); return; }

    const source = this._importSource.trim();
    const result = await this._commitSpells(source);
    if (!result) return;

    ui.notifications.info(t("SDE.importer.done.spells", { summary: ImporterHubApp._commitSummary(result), source: source ? ` / ${source}` : "" }));
    this._importSpells = [];
    this._invalidateItemsCache();
    this.render();
  }

  /** Commit: create all pending monsters into sde-actors. GM-gated. */
  async _onHubCommitMonsters() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.monsters")); return; }
    if (!this._importMonsters.length) { ui.notifications.warn(t("SDE.importer.empty.monsters")); return; }

    const source = this._importSource.trim();
    const drafts = this._importMonsters.map((p) => p.draft);
    const isMount = this._importSeed?.type === "Mount";
    let result;
    if (isMount) {
      const { MountImporter } = await import("./boats/mount-importer.mjs");
      result = await MountImporter.createMounts(drafts, { source });
    } else {
      result = await MonsterImporter.createMonsters(drafts, { source, onConflict: this._monsterConflictDialog() });
    }
    if (!result) return;

    ui.notifications.info(t(isMount ? "SDE.importer.done.mounts" : "SDE.importer.done.monsters", { summary: ImporterHubApp._commitSummary(result), pack: MonsterImporter.PACK_LABEL, source: source ? ` / ${source}` : "" }));
    this._importMonsters = [];
    this._invalidateMonstersCache();
    this.render();
    return result;
  }

  /** Commit: create all pending boats into the sde-actors compendium. GM-gated. */
  async _onHubCommitBoats() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.boats")); return; }
    if (!this._importBoats.length) { ui.notifications.warn(t("SDE.importer.empty.boats")); return; }
    const source = this._importSource.trim();
    const drafts = this._importBoats.map((p) => p.draft);
    const report = await BoatImporter.createBoats(drafts, { source });
    const bits = [];
    if (report.created.length) bits.push(`${report.created.length} created`);
    if (report.skipped.length) bits.push(`${report.skipped.length} already present`);
    ui.notifications.info(t("SDE.importer.done.boats", { bits: bits.join(", ") || t("SDE.importer.done.nothingToDo"), pack: MonsterImporter.PACK_LABEL, source: source ? ` / ${source}` : "" }));
    this._importBoats = [];
    this._invalidateManageTree?.();
    this.render();
  }

  /**
   * Commit: hex-key drafts → JournalEntry pages in the sde-journal pack, one
   * entry per crawl inside the source folder (hex-commit.mjs). GM-gated like
   * every commit. Deliberately NOT part of Commit All: a hex key is a whole
   * crawl the GM files on purpose, and its entry name is read from the strip.
   */
  async _onHubCommitHexes() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.hexes")); return; }
    if (!this._importHexes.length && !this._importHexSummary.length) { ui.notifications.warn(t("SDE.importer.empty.hexes")); return; }
    const source = this._importSource.trim();
    const titleInput = this.element?.querySelector?.("input[data-hex-title]");
    const crawlTitle = String(titleInput?.value ?? this._importHexTitle ?? "").trim();
    const report = await commitHexDrafts(this._importHexes, { source, crawlTitle, keyed: this._importHexSummary });
    const bits = [];
    if (report.created.length) bits.push(`${report.created.length} created`);
    if (report.updated.length) bits.push(`${report.updated.length} updated`);
    if (report.keyed) bits.push(`${report.keyed} keyed rows on file`);
    if (report.collisions.length) bits.push(`${report.collisions.length} duplicate id${report.collisions.length === 1 ? "" : "s"} skipped`);
    ui.notifications.info(t("SDE.importer.done.hexes", { bits: bits.join(", ") || t("SDE.importer.done.nothingToDo"), source: source ? ` / ${source}` : "" }));
    if (report.entryUuid) {
      this._importHexes = []; this._importHexTitle = ""; this._importHexSummary = [];
      this._lastHexCrawl = { uuid: report.entryUuid, title: report.title };
    }
    this._invalidateManageTree?.();
    this.render();
  }

  /** Pins: the filed crawl's keyed hexes as map notes on the viewed scene (hex-pins.mjs). */
  async _onHubPinHexes(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.pin")); return; }
    const uuid = target?.dataset?.uuid || this._lastHexCrawl?.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    if (!entry) { ui.notifications.warn(t("SDE.importer.empty.crawlGone")); return; }
    const { pinCrawlOnActiveScene } = await import("../hex-map/hex-pins.mjs");
    const res = await pinCrawlOnActiveScene(entry).catch((err) => { console.error(`${MODULE_ID} | pin keyed hexes`, err); ui.notifications.error(t("SDE.importer.done.pinFailed", { error: err.message })); return null; });
    if (!res) return;
    const bits = [`${res.created} pinned`];
    if (res.moved) bits.push(`${res.moved} moved`);
    if (res.missing.length) bits.push(`${res.missing.length} not on this map (${res.missing.slice(0, 5).map((n) => String(n).padStart(4, "0")).join(", ")}${res.missing.length > 5 ? "…" : ""})`);
    ui.notifications.info(t("SDE.importer.done.pinned", { scene: canvas.scene?.name, bits: bits.join(", "), journal: res.journal.name }));
  }

  /**
   * Hand-off: rebuild the Extras dataset from a committed crawl entry (pages
   * plus the keyed rows on its flag) and send it to Shadowdark Extras when its
   * builder entry point exists, else download it as JSON (hex-handoff.mjs).
   */
  async _onHubHexDataset(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.hexExport")); return; }
    const uuid = target?.dataset?.uuid || this._lastHexCrawl?.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    if (!entry) { ui.notifications.warn(t("SDE.importer.empty.crawlGone")); return; }
    const dataset = datasetFromEntry(entry);
    const check = validateHexDataset(dataset);
    if (!check.ok) {
      console.warn(`${MODULE_ID} | hex dataset failed its contract check`, check.errors);
      ui.notifications.error(t("SDE.importer.done.datasetInvalid", { error: check.errors[0] }));
      return;
    }
    const res = await handoffDataset(dataset);
    if (res.via === "extras") ui.notifications.info(t("SDE.importer.done.sentExtras", { name: dataset.name, n: dataset.hexes.length }));
    else if (res.via === "download") ui.notifications.info(t("SDE.importer.done.downloaded", { file: res.filename, n: dataset.hexes.length }));
  }

  /**
   * Conflict dialog for a downtime RE-unlock that would shrink what's stored.
   * A commit replaces the whole per-book record, so re-unlocking from a worse
   * paste silently re-locks outcomes the GM already had. Same DialogV2 shape as
   * the monster/table conflict prompts; the safe option is the default.
   * @returns {Promise<"replace"|"cancel">}
   */
  async _downtimeDowngradeDialog(label, existingCount, newCount) {
    // Batch run: keep the richer existing unlock — an unattended pass must
    // never re-lock outcomes the GM already has.
    if (this._batchAuto) return this._batchAuto.downtimeDowngrade === "replace" ? "replace" : "cancel";
    const safe = foundry.utils.escapeHTML(label);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.importer.conflict.downtimeTitle") },
      content: `<p>${t("SDE.importer.conflict.downtime", { book: safe, existing: existingCount, total: DOWNTIME_SLOT_COUNT, matched: newCount })}</p>`
        + `<p>${t(existingCount - newCount === 1 ? "SDE.importer.conflict.downtimeRelockOne" : "SDE.importer.conflict.downtimeRelockMany", { n: existingCount - newCount })}</p>`,
      buttons: [
        { action: "cancel", label: t("SDE.importer.conflict.keepExisting"), icon: "fa-solid fa-shield", default: true },
        { action: "replace", label: t("SDE.importer.conflict.replaceAnyway"), icon: "fa-solid fa-triangle-exclamation" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    return choice ?? "cancel";
  }

  /**
   * Commit: store the parsed downtime outcomes for ONE source book in the
   * `downtimeContent` world setting. GM-gated like every other commit.
   *
   * The only commit that writes a setting instead of compendium documents —
   * the pasted text is the GM's own book copy, so it never becomes a shipped
   * document. The other book's record is merged through untouched, and the
   * Downtime window re-renders off its own `updateSetting` subscription
   * (downtime-app.mjs `_onFirstRender`), so nothing reaches into that app.
   */
  async _onHubCommitDowntime() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.downtime")); return; }
    const parse = this._downtimeParse;
    if (!parse) { ui.notifications.warn(t("SDE.importer.empty.downtime")); return; }
    const slug = DOWNTIME_SOURCES[this._downtimeSource] ? this._downtimeSource : DOWNTIME_SLUGS[0];
    const label = DOWNTIME_SOURCES[slug].label;
    const filledCount = Object.keys(parse.filled ?? {}).length;
    if (!filledCount) {
      ui.notifications.warn(t("SDE.importer.done.downtimeNoMatch", { book: label }));
      return;
    }
    // Merge, never replace: unlocking one book must leave the other's text alone.
    // WITHIN a book the record IS replaced, so a re-unlock from a worse paste
    // would silently re-lock outcomes the GM already has — confirm that first.
    const content = { ...(game.settings.get(MODULE_ID, "downtimeContent") ?? {}) };
    let priorCount = 0;
    try {
      const prior = readStored(content[slug]);
      priorCount = prior.ok ? Object.keys(prior.slots).length : 0;
    } catch { priorCount = 0; }
    if (priorCount > filledCount) {
      const choice = await this._downtimeDowngradeDialog(label, priorCount, filledCount);
      if (choice !== "replace") {
        ui.notifications.info(t("SDE.importer.done.downtimeKept", { book: label, prior: priorCount, total: DOWNTIME_SLOT_COUNT }));
        return;
      }
    }
    let record;
    try {
      record = buildUnlockRecord(parse, { unlockedAt: new Date().toISOString() });
    } catch (err) {
      console.error(`${MODULE_ID} | downtime: buildUnlockRecord failed`, err);
      ui.notifications.error(t("SDE.importer.done.downtimeFailed"));
      return;
    }
    content[slug] = record;
    await game.settings.set(MODULE_ID, "downtimeContent", content);
    ui.notifications.info(t("SDE.importer.done.downtime", { book: label, filled: filledCount, total: DOWNTIME_SLOT_COUNT }));
    this._downtimeParse = null;
    this._invalidateManageTree?.();
    this.render();
  }

  /**
   * Quality gate before committing tables/generators: one aggregated DialogV2
   * listing every draft with blockers. Returns "commit-clean" (default),
   * "commit-all", or "cancel" (incl. ESC/close).
   */
  async _importQualityGate(kindLabel, flagged) {
    // Batch run: "commit-clean" — a draft with blockers is NEVER written
    // unreviewed, it stays in the preview and the report names it.
    if (this._batchAuto) return this._batchAuto.quality;
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const items = flagged.map(({ draft, blockers }) =>
      `<li><strong>${esc(draft.name ?? t("SDE.importer.quality.untitled"))}</strong><ul style="margin:0.2em 0 0.4em 1.1em;">${blockers.map((b) => `<li>${esc(b.message)}</li>`).join("")}</ul></li>`).join("");
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("SDE.importer.quality.title") },
      position: { width: 480 },
      content: `<p>${t(flagged.length === 1 ? "SDE.importer.quality.leadOne" : "SDE.importer.quality.leadMany",
        { n: flagged.length, kind: esc(kindLabel) })}</p><ul>${items}</ul><p>${t("SDE.importer.quality.cleanNote")}</p>`,
      buttons: [
        { action: "commit-clean", label: t("SDE.importer.quality.commitClean"), icon: "fa-solid fa-filter", default: true },
        { action: "commit-all", label: t("SDE.importer.quality.commitAll"), icon: "fa-solid fa-triangle-exclamation" },
        { action: "cancel", label: t("SDE.importer.btn.cancel"), icon: "fa-solid fa-xmark" },
      ],
      rejectClose: false,
    });
    return choice ?? "cancel";
  }

  /** Blocker pre-scan shared by the table/generator commit paths. */
  async _gateTableDrafts(kindLabel, drafts) {
    const { computeBlockers } = await import("./tables/table-importer.mjs");
    const flagged = drafts.map((d) => ({ draft: d, blockers: computeBlockers(d) })).filter((x) => x.blockers.length);
    if (!flagged.length) return { skip: new Set(), allowInvalid: false };
    const choice = await this._importQualityGate(kindLabel, flagged);
    if (choice === "cancel") return null;
    if (choice === "commit-all") return { skip: new Set(), allowInvalid: true };
    return { skip: new Set(flagged.map((f) => f.draft)), allowInvalid: false };
  }

  /** Commit: create all pending tables into sde-tables. GM-gated. */
  /**
   * Fail-closed guard for a live selected-matrix seed (e.g. the Monster
   * Generator / Make It Weird matrices routed in from the Monster Creator). A
   * matrix imports as ALL its child tables or NONE — a partial/mis-ordered/
   * invalid set is refused wholesale, with no commit-clean escape hatch, and
   * every preview draft is kept for the GM to fix. Returns true to STOP the
   * commit; false to proceed with the normal per-draft flow.
   */
  _matrixCommitRefused() {
    const seed = this._importSeed;
    const isLiveMatrix = !!(seed?.matrix && seed?.manifestId && !seed._charSeed
      && Array.isArray(seed.columns) && seed.columns.length);
    if (!isLiveMatrix) return false;
    const { ok, errors } = TableImporter.validateMatrixCommit(seed, this._importTables);
    if (ok) return false;
    ui.notifications.error(t("SDE.importer.bundleErr.matrix", { name: seed.name, n: seed.columns.length, first: errors[0] }));
    return true;
  }

  /** Adapt a parsed hub table draft to the magic-runtime descriptor shape. */
  static _magicDraftDescriptor(d) {
    return {
      manifestId: d?.manifestId ?? null,
      formula: d?.formula ?? "",
      // Parsed drafts have no per-row ids yet (Foundry assigns them at create);
      // synthesize stable ones so the range-aware validator's id check passes.
      results: (Array.isArray(d?.rows) ? d.rows : []).map((r, i) => ({
        id: `row-${i}`, range: [r.min, r.max], text: r.text,
      })),
    };
  }

  /**
   * Plan a magic base-recipe BUNDLE commit (Weapon/Armor base: several separate
   * tables off one page). The set imports as ALL its child tables — valid,
   * non-duplicate — or NONE. Returns:
   *   - `null`   — not a bundle seed (rider/personality import per-table).
   *   - `"refuse"` — matched failed (missing/invalid/duplicate); already notified.
   *   - `{def, matched}` — the EXACT matched child drafts (identity-stamped),
   *     isolating them from any other tables parsed off the same page.
   */
  /** True when the active seed is a multi-child, non-perTable magic bundle. */
  _isMagicBundleSeed() {
    const seed = this._importSeed;
    if (!seed?.magicSet || seed._charSeed) return false;
    const def = MAGIC_SET_DEFS[seed.magicSet];
    return !!(def && !def.perTable && def.children.length > 1);
  }

  _magicBundlePlan() {
    const seed = this._importSeed;
    if (!seed?.magicSet || seed._charSeed) return null;
    const def = MAGIC_SET_DEFS[seed.magicSet];
    if (!def || def.perTable || def.children.length < 2) return null;

    const descriptors = this._importTables.map((d) => ImporterHubApp._magicDraftDescriptor(d));
    const res = matchBundleTables(def, descriptors);
    if (!res.ok) {
      const first = res.errors?.[0]?.message ?? t("SDE.importer.bundleErr.incomplete");
      ui.notifications.error(t("SDE.importer.bundleErr.set", { label: def.label, n: def.children.length, first }));
      return "refuse";
    }
    // Bundle isolation: keep ONLY the matched child drafts (stamp identity);
    // any other tables parsed off the same page are left in the preview,
    // never silently committed with the bundle.
    const matched = res.payloads.map((p) => {
      const draft = this._importTables[p.sourceIndex];
      draft.manifestId = p.manifestId;
      draft.name = p.name;
      return draft;
    });
    return { def, matched };
  }

  /**
   * Commit a matched bundle ATOMICALLY (all children or none) through the shared
   * choke point (TableImporter.commitTableBundle → commitBundleAtomic): every
   * child's blockers and every name-conflict decision are preflighted before any
   * write; a cancel or a mid-write failure rolls back to zero net documents. On
   * success only the matched children leave the preview.
   * @returns {Promise<number>} count of tables persisted (0 on refuse/failure)
   */
  async _commitMagicBundle({ def, matched }) {
    const result = await TableImporter.commitTableBundle(matched, { onConflict: this._tableConflictDialog() });
    if (!result?.ok) {
      const reason = result?.reason;
      const msg = t(reason === "cancelled" ? "SDE.importer.bundleErr.cancelled"
        : reason === "invalid" ? "SDE.importer.bundleErr.invalid"
          : reason === "write-failed" ? "SDE.importer.bundleErr.writeFailed"
            : "SDE.importer.bundleErr.other", { label: def.label });
      (reason === "cancelled" ? ui.notifications.info : ui.notifications.error)(msg);
      return 0;
    }
    const done = new Set(matched);
    this._importTables = this._importTables.filter((draft) => !done.has(draft));
    this._importSeed = null;
    for (const doc of [...result.created, ...result.replaced]) await this._registerCharBuilderTable(doc);
    this._invalidateCharCache();
    this._announceContentUnlocked();
    const n = result.created.length + result.replaced.length;
    ui.notifications.info(t(n === 1 ? "SDE.importer.done.setOne" : "SDE.importer.done.setMany", { label: def.label, n }));
    return n;
  }

  async _onHubCommitTables() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.tables")); return; }
    if (!this._importTables.length) { ui.notifications.warn(t("SDE.importer.empty.tables")); return; }
    if (this._matrixCommitRefused()) { this.render(); return; }
    // Magic base-recipe bundle → dedicated ATOMIC path (isolated, all-or-nothing).
    const bundlePlan = this._magicBundlePlan();
    if (bundlePlan === "refuse") { this.render(); return; }
    if (bundlePlan) { await this._commitMagicBundle(bundlePlan); this.render(); return; }

    const gate = await this._gateTableDrafts("table", this._importTables);
    if (!gate) return;
    const onConflict = this._tableConflictDialog();
    let created = 0;
    for (const tbl of [...this._importTables]) {
      if (gate.skip.has(tbl)) continue;   // blocked draft stays in the preview
      // Convention at commit time too, so hand-typing "Elf Names" on the card
      // is enough — bare generic names ("Names") are left for the GM to fix.
      if (/\b(names|trinkets)$/i.test(tbl.name ?? "") && tbl.name.trim().split(/\s+/).length >= 2 && !/ - /.test(tbl.name)) {
        const { stripRepPrefix } = await import("./char-content/char-content-manifest.mjs");
        tbl.name = `${this._importSource.trim() || "Western Reaches"} - ${stripRepPrefix(tbl.name).trim()}`;
      }
      // Stamp the source so createTable files the table under its book folder —
      // parity with _onHubCommitGenerators (which already sets g.source). Without
      // this a plain-table unlock (e.g. CS2 "In a Dead Bandit's Hand") lands in
      // the fallback "Custom" folder with no source flag.
      const src = this._importSource.trim();
      if (src) tbl.source = src;
      const table = await TableImporter.createTable(tbl, { onConflict, allowInvalid: gate.allowInvalid });
      if (table?.blocked) continue;       // choke-point veto (shouldn't happen post-gate)
      if (table) {
        created++;
        this._importTables = this._importTables.filter(t => t !== tbl);
        if (tbl.manifestId) this._importSeed = null;
        await this._registerCharBuilderTable(table);
      }
    }
    ui.notifications.info(t("SDE.importer.done.tables", { created, kept: gate.skip.size ? t("SDE.importer.done.keptInPreview", { n: gate.skip.size }) : "" }));
    if (this._importSeed?._charSeed && !this._importTables.length) this._importSeed = null;
    this._invalidateCharCache();
    if (created) this._announceContentUnlocked();
    this.render();
  }

  /**
   * Commit compound generators → sde-tables (one self-contained RollTable each,
   * carrying the compound flag). Same conflict dialog as regular tables.
   */
  async _onHubCommitGenerators() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.tables")); return; }
    if (!this._importGenerators.length) { ui.notifications.warn(t("SDE.importer.empty.generators")); return; }

    const gate = await this._gateTableDrafts("generator", this._importGenerators);
    if (!gate) return;
    const onConflict = this._tableConflictDialog();
    let created = 0;
    for (const g of [...this._importGenerators]) {
      if (gate.skip.has(g)) continue;
      const src = this._importSource.trim();
      if (src) g.source = src;
      const table = await TableImporter.createTable(g, { onConflict, allowInvalid: gate.allowInvalid });
      if (table?.blocked) continue;
      if (table) {
        created++;
        this._importGenerators = this._importGenerators.filter(x => x !== g);
      }
    }
    ui.notifications.info(t("SDE.importer.done.generators", { created, kept: gate.skip.size ? t("SDE.importer.done.keptInPreview", { n: gate.skip.size }) : "" }));
    // Compound grids (Traps/Hazards, name generators) land as sde-tables just
    // like plain tables — drop the char + Manage-tree caches so the census
    // re-scans and their Unlock buttons clear (parity with _onHubCommitTables).
    this._invalidateCharCache();
    if (created) this._announceContentUnlocked();
    this.render();
  }

  // (_fileCharTable removed — createTable now files every table via the
  // category-first resolver in table-folders.mjs, incl. char-content paths
  // like Character Content → Ancestries → Names.)

  /**
   * The character builder now auto-discovers installed Names/Trinkets tables
   * (char-builder/data.mjs configuredTables) — there is no source setting to
   * update, so an imported table is available immediately. Kept as a no-op for
   * existing callers.
   */
  async _registerCharBuilderTable(_table) { /* auto-discovered — nothing to register */ }

  /** Signal an open Character Builder to drop caches and re-render, so unlocked
   *  content (ancestries, tables, backgrounds, classes…) appears immediately. */
  _announceContentUnlocked() { Hooks.callAll(`${MODULE_ID}.contentUnlocked`); }

  /** Commit: create all monsters, items, then tables in one action. GM-gated. */
  async _onHubCommitAll() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return; }

    const hasMonsters = this._importMonsters.length > 0;
    const hasItems    = this._importItems.length > 0;
    const hasSpells   = this._importSpells.length > 0;
    const hasTables   = this._importTables.length > 0;
    if (!hasMonsters && !hasItems && !hasSpells && !hasTables) { ui.notifications.warn(t("SDE.importer.empty.anything")); return; }

    const parts = [];
    const source = this._importSource.trim();

    // Monsters first
    if (hasMonsters) {
      const drafts = this._importMonsters.map((p) => p.draft);
      // Mounts: imported as mount-type actors instead of standard NPCs.
      if (this._importSeed?.type === "Mount") {
        const { MountImporter } = await import("./boats/mount-importer.mjs");
        const result = await MountImporter.createMounts(drafts, { source });
        if (result) {
          parts.push(`mounts: ${ImporterHubApp._commitSummary(result)}`);
          this._importMonsters = [];
          this._invalidateMonstersCache();
        }
      } else {
        const result = await MonsterImporter.createMonsters(drafts, { source, onConflict: this._monsterConflictDialog() });
        if (result) {
          parts.push(`monsters: ${ImporterHubApp._commitSummary(result)}`);
          this._importMonsters = [];
          this._invalidateMonstersCache();
        }
      }
    }

    // Items second
    if (hasItems) {
      const { ItemImporter } = await import("./items/item-importer.mjs");
      const drafts = this._importItems.map((p) => p.draft);
      // Keep Commit All (used by Import everything) on the same siege-property
      // preparation path as the dedicated Items commit. Otherwise the weapon
      // drafts still commit, but their Blast/Exploding Property items are never
      // materialized or foldered.
      if (drafts.some((d) => d.siegeProperties?.length)) {
        const { prepareSiegeProperties } = await import("./boats/siege-importer.mjs");
        if (!(await prepareSiegeProperties(drafts))) return;
      }
      if (drafts.some((d) => d.lanceProperties?.length)) {
        const { prepareLanceProperties } = await import("./items/wr-property-importer.mjs");
        if (!(await prepareLanceProperties(drafts))) return;
      }
      const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
      if (result) {
        parts.push(`items: ${ImporterHubApp._commitSummary(result)}`);
        this._importItems = [];
      }
    }

    // Spells third
    if (hasSpells) {
      const result = await this._commitSpells(source);
      if (result) {
        parts.push(`spells: ${ImporterHubApp._commitSummary(result)}`);
        this._importSpells = [];
      }
    }

    // Tables last
    if (hasTables) {
      // A live selected-matrix seed is all-or-nothing (see _matrixCommitRefused):
      // refuse the whole tables portion rather than committing a partial matrix.
      if (this._matrixCommitRefused()) {
        ui.notifications.info(t("SDE.importer.done.stoppedAtTables", { parts: parts.join("; ") || t("SDE.importer.done.nothingCommitted") }));
        this.render();
        return;
      }
      // Magic base-recipe bundle → dedicated ATOMIC path (same choke point as
      // Commit Tables). Refuse stops; success commits ONLY the matched children.
      const bundlePlan = this._magicBundlePlan();
      if (bundlePlan === "refuse") {
        ui.notifications.info(t("SDE.importer.done.stoppedAtTables", { parts: parts.join("; ") || t("SDE.importer.done.nothingCommitted") }));
        this.render();
        return;
      }
      if (bundlePlan) {
        // _commitMagicBundle shows its own error/cancel notice and, on success,
        // announces the unlock itself.
        const n = await this._commitMagicBundle(bundlePlan);
        if (n > 0) {
          parts.push(`tables: ${n} created (bundle)`);
          ui.notifications.info(t("SDE.importer.done.complete", { parts: parts.join("; ") }));
        } else {
          // Bundle failed/cancelled: do NOT claim a tables entry, do NOT say
          // "Import complete", and do NOT announce an unlock for the zero result
          // — but still surface any earlier commits (monsters/items/spells).
          if (parts.length) this._announceContentUnlocked();
          ui.notifications.info(t("SDE.importer.done.stoppedAtTables", { parts: parts.join("; ") || t("SDE.importer.done.nothingCommitted") }));
        }
        this.render();
        return;
      }
      const gate = await this._gateTableDrafts("table", this._importTables);
      if (!gate) { ui.notifications.info(t("SDE.importer.done.stoppedAtTables", { parts: parts.join("; ") || t("SDE.importer.done.nothingCommitted") })); this.render(); return; }
      const onConflict = this._tableConflictDialog();
      let created = 0;
      for (const tbl of [...this._importTables]) {
        if (gate.skip.has(tbl)) continue;
        const table = await TableImporter.createTable(tbl, { onConflict, allowInvalid: gate.allowInvalid });
        if (table?.blocked) continue;
        if (table) {
          created++;
          this._importTables = this._importTables.filter(t => t !== tbl);
          if (tbl.manifestId) this._importSeed = null;
        }
      }
      parts.push(`tables: ${created} created${gate.skip.size ? `, ${gate.skip.size} blocked` : ""}`);
    }

    ui.notifications.info(t("SDE.importer.done.complete", { parts: parts.join("; ") }));
    if (parts.length) this._announceContentUnlocked();
    this.render();
  }
  /** Export the suite as one JSON bundle (REQ-25) — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onExportBundle() {
    const { exportSuiteBundle } = await import("./importer-hub-maintenance.mjs");
    return exportSuiteBundle(this);
  }

  /** Import a suite bundle JSON (REQ-25) — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onImportBundle() {
    const { importSuiteBundle } = await import("./importer-hub-maintenance.mjs");
    return importSuiteBundle(this);
  }

  /** Manage the source-PDF library — extracted to importer-hub-maintenance.mjs (review 2026-07-11). */
  async _onManageSourcePdfs() {
    const { manageSourcePdfs } = await import("./importer-hub-maintenance.mjs");
    return manageSourcePdfs(this);
  }
  /** Commit parsed Background/Talent/Class drafts into sde-items. GM-gated. */
  async _onHubCommitChar() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.gm.charContent")); return; }
    if (!this._importChar.length) { ui.notifications.warn(t("SDE.importer.empty.charContent")); return; }
    const bgBundle = this._importSeed?._bgBundle;

    const source = this._importSource.trim();
    // The char-builder gates visibility on system.source.title — stamp it from
    // the source label so unlocked content is attributed like hand-imports.
    // Shared canonical mapping (item-builder-gear) so the builder and the char
    // commit can never diverge on a slug.
    const { sourceTitleSlug } = await import("./items/item-builder-gear.mjs");
    const sourceTitle = sourceTitleSlug(source);

    // Full class units (parse-and-author path) go through the class-unit
    // importer: talents + 2d6 table + wired Class, in dependency order.
    const unitDrafts  = this._importChar.filter((p) => p.draft.classUnit);
    const suppDrafts  = this._importChar.filter((p) => p.draft.classSupplement);
    const plainDrafts = this._importChar.filter((p) => !p.draft.classUnit && !p.draft.classSupplement);

    const parts = [];
    if (unitDrafts.length) {
      const { createClassUnit } = await import("./char-content/class-unit-importer.mjs");
      const { overlayFor } = await import("./char-content/class-overlays.mjs");
      for (const p of unitDrafts) {
        // SDE wiring overlay (effects, invented outcome names) — the paste
        // supplies the text, the overlay supplies the plumbing.
        const overlay = overlayFor(p.draft.name);
        // Re-derive talent-band warnings from the (possibly hand-edited) live
        // table so the gate never blocks on parse-time band issues the user
        // already fixed in the preview.
        this._refreshTalentWarnings(p.draft.classUnit);
        // Stage 1: the class BODY only (description + features). Roll tables are
        // imported in Stage 2 ("Class · Roll Tables") and attached.
        let rep = await createClassUnit(p.draft.classUnit, { source, sourceTitle, overlay, bodyOnly: true });
        if (rep?.blocked) {
          // Fail-closed low level flagged BLOCKER-grade issues — confirm the
          // shared override dialog before persisting anything.
          const { confirmClassGate } = await import("./char-content/class-quality-gate.mjs");
          if (!(await confirmClassGate(p.draft.name, rep.issues))) continue;
          rep = await createClassUnit(p.draft.classUnit, { source, sourceTitle, overlay, bodyOnly: true, allowInvalid: true });
        }
        if (!rep || rep.blocked) continue;
        const updated = rep.updated ?? [];
        parts.push(`class "${p.draft.name}": ${rep.created.length} created, ${updated.length} updated, ${rep.reused.length} reused, ${rep.systemReuse.length} system talents linked`);
        if (updated.length) {
          // Corrected re-import summary (review #12): say WHAT changed, per doc.
          console.info(`${MODULE_ID} | class import "${p.draft.name}" — updated in place:\n- ${
            updated.map((u) => `${u.type} "${u.name}": ${u.fields.join(", ")}`).join("\n- ")}`);
        }
        if (rep.warnings.length) {
          console.warn(`${MODULE_ID} | class import "${p.draft.name}" — review notes:\n- ${rep.warnings.join("\n- ")}`);
          ui.notifications.warn(t("SDE.importer.done.classNotes", { name: p.draft.name, n: rep.warnings.length }));
        }
      }
    }

    // Stage-2 supplements: merge parsed tables/titles/spells-known onto the
    // chosen already-imported class (mergeClassSupplement). Drafts with no
    // target picked are kept below so the user can attach and re-commit.
    if (suppDrafts.length) {
      const { mergeClassSupplement } = await import("./char-content/class-unit-importer.mjs");
      for (const p of suppDrafts) {
        if (!p.draft.attachTo) {
          ui.notifications.warn(t("SDE.importer.done.pickClass", { name: p.draft.name }));
          continue;
        }
        let rep = await mergeClassSupplement(p.draft.attachTo, p.draft.classSupplement, { source, sourceTitle });
        const target = await fromUuid(p.draft.attachTo).catch(() => null);
        if (rep?.blocked) {
          const { confirmClassGate } = await import("./char-content/class-quality-gate.mjs");
          if (!(await confirmClassGate(target?.name ?? p.draft.name, rep.issues))) continue;
          rep = await mergeClassSupplement(p.draft.attachTo, p.draft.classSupplement, { source, sourceTitle, allowInvalid: true });
        }
        if (!rep || rep.blocked) continue;
        parts.push(`tables → "${target?.name ?? "class"}": ${rep.created.length} created, ${rep.updated.length} updated, ${rep.reused.length} reused`);
        if (rep.warnings.length) {
          console.warn(`${MODULE_ID} | class supplement → "${target?.name ?? p.draft.attachTo}" — review notes:\n- ${rep.warnings.join("\n- ")}`);
          ui.notifications.warn(t("SDE.importer.done.mergeNotes", { n: rep.warnings.length }));
        }
      }
    }

    if (plainDrafts.length) {
      // Ancestry drafts: resolve fixed-language NAMES → language-item UUIDs and
      // create+link the inline ancestry talent, because the system (and the
      // char-builder) store both as item UUIDs. Runs before the ancestry is
      // created so the talent UUID exists to reference.
      for (const p of plainDrafts) {
        if (p.draft.type === "Ancestry") await this._resolveAncestryDraft(p.draft, sourceTitle, source);
      }
      const drafts = plainDrafts.map((p) => ({ ...p.draft, sourceTitle }));
      const { ItemImporter } = await import("./items/item-importer.mjs");
      const result = await ItemImporter.createItems(drafts, { source, onConflict: this._itemConflictDialog() });
      if (!result) return;
      parts.push(`${result.created.length} created`);
      if (result.replaced.length) parts.push(`${result.replaced.length} replaced`);
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    }
    ui.notifications.info(t("SDE.importer.done.charContent", { parts: parts.join("; "), source: source ? ` / ${source}` : "" }));
    // Keep supplement drafts the user never assigned a target — everything
    // committed (units, plain items, attached supplements) is cleared.
    this._importChar = this._importChar.filter((p) => p.draft.classSupplement && !p.draft.attachTo);
    this._attachChoices = null;   // a class imported this run should now be attachable
    this._invalidateItemsCache();
    this._invalidateCharCache();
    this._announceContentUnlocked();
    // Background bundle: the same paste also yielded the d100 roll table — commit
    // it now so one click unlocks both the items and the table.
    if (bgBundle && this._importTables.length) {
      await this._onHubCommitTables();
      return;   // _onHubCommitTables renders
    }
    this.render();
  }

  /**
   * Ancestry commit pre-pass: make a parsed ancestry char-builder-ready.
   *   • languages.fixed: map recognised NAMES ("Common","Elvish") → the system's
   *     language-item UUIDs (the builder pools fixed languages by UUID). Unknown
   *     names are left as-is for the GM to fix on the sheet.
   *   • talent {name,text}: create it as an "ancestry" Talent item in sde-items
   *     and link its UUID into system.talents (with talentChoiceCount 1), so the
   *     builder grants it — instead of losing it in the description.
   * Idempotent: a re-import reuses/finds the existing talent by name.
   */
  async _resolveAncestryDraft(draft, sourceTitle, source) {
    // Languages: names → UUIDs (shared with the class-builder path).
    const fixed = Array.isArray(draft.languages?.fixed) ? draft.languages.fixed : [];
    if (fixed.length) {
      const { resolveLanguageNames } = await import("./char-content/language-resolver.mjs");
      draft.languages.fixed = await resolveLanguageNames(fixed);
    }
    // Talent: reuse an existing same-named ancestry talent (idempotent
    // re-import), else create it. Check FIRST so a re-import never duplicates.
    // Talents route to world.talents (createItems type-routing), so probe there.
    if (draft.talent?.name && draft.talent?.text) {
      const { findSuitePack } = await import("../shared/compendium-suite.mjs");
      const pack = findSuitePack("talents");
      let uuid = null;
      if (pack) {
        const idx = await pack.getIndex({ fields: ["type"] });
        const hit = [...idx].find((e) => e.type === "Talent" && e.name === draft.talent.name);
        if (hit) uuid = `Compendium.${pack.collection}.Item.${hit._id}`;
      }
      if (!uuid) {
        const { ItemImporter } = await import("./items/item-importer.mjs");
        const res = await ItemImporter.createItems([{
          name: draft.talent.name, type: "Talent", talentClass: "ancestry",
          description: `<p>${draft.talent.text}</p>`, sourceTitle,
        }], { source, onConflict: this._itemConflictDialog() });
        uuid = res?.created?.[0]?.uuid ?? res?.replaced?.[0]?.uuid ?? null;
      }
      if (uuid) { draft.talents = [uuid]; draft.talentChoiceCount = 1; }
      delete draft.talent;
    }
  }
}

export function installHubCommit(cls) { installMethods(cls, HubCommitMethods); }
