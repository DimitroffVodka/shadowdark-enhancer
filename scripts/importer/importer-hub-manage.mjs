/**
 * Importer Hub — Manage strip: censuses, gaps, culls, manage tree, PDF unlock seeding
 *
 * Monsters/items census contexts + caches, the browsable manage tree, gap/seed/cull handlers, and source-PDF text extraction.
 * Split out of importer-hub-app.mjs (2026-07); methods are moved VERBATIM and
 * installed onto ImporterHubApp.prototype by installHubManage(cls) — `this` is
 * always the live hub app instance. The import of ImporterHubApp is circular
 * with the shell on purpose and only dereferenced at runtime inside method
 * bodies (never at module top level).
 */

import { gatherCensus, gatherDuplicates, cullDuplicates } from "./monsters/monster-census-live.mjs";
import { gatherItemCensus, gatherItemDuplicates, cullItemDuplicates } from "./items/item-census-live.mjs";
import { CHAR_SOURCES, BACKGROUND_TABLES } from "./char-content/char-content-manifest.mjs";
import { sourcePdfHref, sourcePdfTarget } from "./source-pdf-registry.mjs";
import { buildManageTree } from "./manage-tree.mjs";
import { contentIdForName } from "./tables/table-shapes.mjs";
import { installMethods } from "./importer-hub-shared.mjs";

class HubManageMethods {

  /**
   * Prepare Monsters-tab context: per-source live census rows merged with gap
   * counts (monster names referenced in pack tables that don't resolve to an
   * owned/system actor), plus duplicate groups. Cached per render cycle;
   * invalidated on cull/import/commit.
   *
   * @returns {Promise<object>}
   */
  async _prepareMonstersContext() {
    if (!this._monstersCache) {
      const [rows, dupGroups] = await Promise.all([
        gatherCensus().catch((err) => {
          console.error("shadowdark-enhancer | gatherCensus failed:", err);
          return [];
        }),
        gatherDuplicates().catch((err) => {
          console.error("shadowdark-enhancer | gatherDuplicates failed:", err);
          return [];
        }),
      ]);
      this._monstersCache = { rows, duplicateGroups: dupGroups, duplicateCount: dupGroups.length };
    }
    return this._censusContext(this._monstersCache, this._expandedGapRows, "monsterSeedPaste");
  }

  /**
   * Shape a cached census ({ rows, duplicateGroups, duplicateCount }) for the
   * Monsters/Items dashboard template: per-source rows with expand state and a
   * gap-name list, plus the duplicate cards. Replaces the former manifest
   * `_catalogContext` — there is no source/manifest reconcile anymore.
   */
  _censusContext(cache, expandedSet, seedAction) {
    const { rows, duplicateGroups: dupGroups, duplicateCount } = cache;
    const expandAction = seedAction === "monsterSeedPaste" ? "monsterGapExpand" : "itemGapExpand";
    // Stamp the per-row/per-name action strings so the template only ever reads
    // block params (no parent/`../` lookups across {{#each}} depths).
    const censusRows = rows.map((r) => ({
      label:        r.label,
      have:         r.have ?? 0,
      gap:          r.gap ?? 0,
      hasGap:       (r.gap ?? 0) > 0,
      expanded:     expandedSet.has(r.label),
      expandAction,
      missingNames: (r.missingNames ?? []).map((name) => ({ name, seedAction })),
    }));
    const dupGroupsCtx = dupGroups.map((g) => ({
      ...g,
      members: g.members.map((m) => ({
        ...m,
        date: m.date ? new Date(m.date).toLocaleDateString() : null,
      })),
    }));
    return {
      censusRows,
      totalHave:       censusRows.reduce((a, r) => a + r.have, 0),
      totalGap:        censusRows.reduce((a, r) => a + r.gap, 0),
      noCensus:        censusRows.length === 0,
      duplicateGroups: dupGroupsCtx,
      duplicateCount,
      hasDuplicates:   dupGroups.length > 0,
    };
  }

  /** Invalidate the monsters-tab cache. */
  _invalidateMonstersCache() {
    this._monstersCache = null;
    clearTimeout(this._monstersCacheTimer);
    this._invalidateManageTree();
  }

  /**
   * Prepare Items-tab context: per-source live census rows merged with gap
   * counts (item names referenced in loot/treasure pack tables that don't
   * resolve), plus duplicate groups. Parallels _prepareMonstersContext.
   *
   * @returns {Promise<object>}
   */
  async _prepareItemsContext() {
    if (!this._itemsCache) {
      // gatherItemCensus returns { total, typeCounts, rows } — unwrap rows
      // (unlike gatherCensus, which returns the row array directly).
      const [census, dupGroups] = await Promise.all([
        gatherItemCensus().catch((err) => {
          console.error("shadowdark-enhancer | gatherItemCensus failed:", err);
          return { rows: [] };
        }),
        gatherItemDuplicates().catch((err) => {
          console.error("shadowdark-enhancer | gatherItemDuplicates failed:", err);
          return [];
        }),
      ]);
      this._itemsCache = {
        rows: census.rows ?? [],
        duplicateGroups: dupGroups,
        duplicateCount: dupGroups.length,
      };
    }
    return this._censusContext(this._itemsCache, this._expandedItemGapRows, "itemSeedPaste");
  }

  /** Invalidate the items-tab cache. */
  _invalidateItemsCache() {
    this._itemsCache = null;
    this._invalidateManageTree();
  }

  /**
   * Prepare the Manage tree: compose the character-content / monsters / items
   * censuses into the nested folder tree (buildManageTree, cached), then stamp
   * each node with its expand state and depth for the recursive template.
   */
  async _prepareManageTree() {
    if (!this._manageTreeCache) {
      this._manageTreeCache = await buildManageTree().catch((err) => {
        console.error("shadowdark-enhancer | buildManageTree failed:", err);
        return [];
      });
    }
    const applyState = (node, depth) => {
      node.depth = depth;
      node.expandable = node.children.length > 0 || node.entries.length > 0;
      node.expanded = this._manageExpandedNodes.has(node.id);
      node.children.forEach((c) => applyState(c, depth + 1));
      return node;
    };
    return this._manageTreeCache.map((n) => applyState(n, 0));
  }

  /** Invalidate the built Manage tree (content changed). */
  _invalidateManageTree() {
    this._manageTreeCache = null;
  }

  /** Invalidate the character-content caches (kept as the commit-flow entry point). */
  _invalidateCharCache() {
    this._invalidateManageTree();
  }

  // ── Monsters-tab action handlers ───────────────────────────────────────────

  /**
   * Toggle a gap row's missing-names list open/closed.
   * Re-uses the _expandedGapRows Set to track state without a cache invalidation.
   */
  _onMonsterGapExpand(event, target) {
    const source = target.dataset.source ?? "";
    if (this._expandedGapRows.has(source)) {
      this._expandedGapRows.delete(source);
    } else {
      this._expandedGapRows.add(source);
    }
    this.render();
  }

  /**
   * "Seed the paste box" shortcut: pre-sets _importText to a seed hint for a
   * single missing monster name, switches to the Import tab, re-renders.
   * Reuses the 10-03 seed-hint pattern (sets _importSeed so the hint bar shows).
   */
  _onMonsterSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    if (!name) return;
    const src = target.dataset.src ?? "";
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
    this._importSeed = { name, src, _monsterSeed: true };
    this._importType = "monsters";
    // Monster gaps carry a source (book) but no page cite — stamp the source so
    // the import folder + the "Grab from PDF" extractor default to the book.
    if (src) this._importSource = CHAR_SOURCES[src]?.label ?? src;
    this.render();
  }

  /**
   * Guided cull: read the chosen keeper uuid from the form, compute dropUuids,
   * show a DialogV2 confirm listing exactly which pack copies will be deleted,
   * call cullDuplicates on confirm, invalidate cache, re-render. (D-06)
   */
  async _onMonsterCullGroup(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can cull duplicates."); return; }

    const groupKey = target.dataset.groupKey ?? "";
    if (!groupKey) return;

    // Find the group in the cache
    const groups = this._monstersCache?.duplicateGroups ?? [];
    const group = groups.find((g) => g.key === groupKey);
    if (!group) { ui.notifications.warn("Duplicate group not found — refresh the Monsters tab."); return; }

    // Read the keeper from the checked radio inside this group's CARD. The
    // button itself also carries data-group-key, and closest() matches from
    // the element itself — so [data-group-key] resolved to the BUTTON and the
    // radio lookup always came up empty ("Select a keeper" even with one
    // checked; live-caught, Phase 15 follow-up).
    const card = target.closest(".sde-hub-monsters-dup-card");
    const checkedRadio = card?.querySelector("input[type='radio']:checked");
    const keepUuid = checkedRadio?.value ?? "";
    if (!keepUuid) { ui.notifications.warn("Select a keeper before culling."); return; }

    const dropMembers = group.members.filter((m) => m.uuid !== keepUuid);
    if (!dropMembers.length) { ui.notifications.info("Nothing to cull — only one member selected as keeper."); return; }

    // Build confirmation dialog listing exactly what will be deleted
    const keepMember = group.members.find((m) => m.uuid === keepUuid);
    const keepLabel  = foundry.utils.escapeHTML(keepMember?.name ?? keepUuid);
    const dropList   = dropMembers.map((m) => `<li>${foundry.utils.escapeHTML(m.name)} <em>(${m.source || "unknown source"})</em></li>`).join("");

    const content = `
      <p>Keep: <strong>${keepLabel}</strong></p>
      <p>Delete these pack copies:</p>
      <ul style="margin:.3em 0">${dropList}</ul>
      <p style="color:var(--sde-bar-text-muted,#9a9a9a);font-size:.85em">
        Only pack copies in sde-actors are deleted. World actors and _Backup docs are never touched.
      </p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cull Duplicate Monsters" },
      content,
      buttons: [
        { action: "cull",   label: "Delete copies", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");

    if (choice !== "cull") return;

    const dropUuids = dropMembers.map((m) => m.uuid);
    const tally = await cullDuplicates(keepUuid, dropUuids);

    const parts = [];
    if (tally.deleted)  parts.push(`${tally.deleted} deleted`);
    if (tally.skipped)  parts.push(`${tally.skipped} skipped`);
    if (tally.failed)   parts.push(`${tally.failed} failed (see console)`);
    ui.notifications.info(`Cull complete: ${parts.join(", ") || "nothing done"}.`);

    this._invalidateMonstersCache();
    this.render();
  }

  // ── Items-tab dashboard actions (parallel to Monsters) ─────────────────────

  _onItemGapExpand(event, target) {
    const source = target.dataset.source ?? "";
    if (this._expandedItemGapRows.has(source)) this._expandedItemGapRows.delete(source);
    else this._expandedItemGapRows.add(source);
    this.render();
  }

  /** Seed the paste box with a missing item name. */
  _onItemSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    if (!name) return;
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
    this._importSeed = { name, _itemSeed: true };
    this._importType = "items";
    this.render();
  }

  // ── Manage-tree actions ────────────────────────────────────────────────────

  /** Toggle a Manage-tree node open/closed (keyed by its stable node id). */
  _onManageNodeExpand(event, target) {
    const id = target.dataset.nodeId ?? "";
    if (!id) return;
    if (this._manageExpandedNodes.has(id)) this._manageExpandedNodes.delete(id);
    else this._manageExpandedNodes.add(id);
    this.render();
  }

  /** Expand every node in the Manage tree. */
  _onManageExpandAll() {
    const ids = [];
    const walk = (nodes) => { for (const n of nodes) { ids.push(n.id); walk(n.children); } };
    if (this._manageTreeCache) walk(this._manageTreeCache);
    this._manageExpandedNodes = new Set(ids);
    this.render();
  }

  /** Collapse the whole Manage tree. */
  _onManageCollapseAll() {
    this._manageExpandedNodes = new Set();
    this.render();
  }

  /**
   * Unlock a missing character-content entry: pre-select the matching import
   * type, stamp the source label, and seed the paste box with the entry name
   * so the GM only has to paste the section from the cited book.
   */
  /** Open the dedicated Class Importer workspace (classes have their own
   *  guided body → roll-tables → titles flow, not the generic paste box). */
  async _onOpenClassImporter() {
    const { ClassImporterApp } = await import("./char-content/class-importer-app.mjs");
    ClassImporterApp.open();
  }

  /** Open the dedicated Spell Importer workspace (Class → Tier → Alignment). */
  async _onOpenSpellImporter() {
    const { SpellImporterApp } = await import("./spells/spell-importer-app.mjs");
    SpellImporterApp.open();
  }

  /** Bulk-import a caster spell list (Druid/Sorcerer/Mage/Priest/Necromancer):
   *  open the Spell Importer preset to that list's class + alignment + source and
   *  deep-link its PDF, so the GM pastes the whole section once. */
  async _onSpellListSeed(event, target) {
    const key = target?.dataset?.listKey;
    if (!key) return;
    const { SpellImporterApp } = await import("./spells/spell-importer-app.mjs");
    const app = SpellImporterApp.open();
    app._reset();                                 // fresh list — never carry a stale parsed batch
    app._onSelectList(key, { openPdf: false });   // sets class + alignment + source, renders
    // One press does Import + extraction — parity with the Class/Table Unlock:
    // pull the list's spell writeups straight into the box and parse them. Falls
    // back to opening the viewer for manual copy when no PDF text is available.
    const grabbed = await app._autoGrabList();
    if (!grabbed) app._onOpenPdf();
  }

  async _onCharSeedPaste(event, target) {
    const name = target.dataset.name ?? "";
    const type = target.dataset.type ?? "";
    const src = target.dataset.src ?? "";
    if (!name) return;
    // Spells go to their own Class → Tier → Alignment workspace.
    if (type === "Spell") {
      const { SpellImporterApp } = await import("./spells/spell-importer-app.mjs");
      const app = SpellImporterApp.open();
      app._reset();   // fresh unlock — never import a stale parsed batch (review #2)
      if (src) app._source = CHAR_SOURCES[src]?.label ?? src;
      if (name) app._pasteText = `${name}\n`;   // start the paste with the unlocked spell's name
      app.render();
      return;
    }

    // Classes go to their own workspace, not the generic paste box.
    if (type === "Class") {
      const { ClassImporterApp } = await import("./char-content/class-importer-app.mjs");
      const app = ClassImporterApp.open();
      app._reset();   // fresh unlock — clear any prior class's state (review #2)
      if (src) app._source = CHAR_SOURCES[src]?.label ?? src;
      // Seed the class name so the workspace knows which class it's unlocking.
      if (name) app._seedClassName = name;
      app.render();
      // One press does Import + extraction: pull the class writeup straight
      // into the body box when its PDF is available; otherwise fall back to
      // opening the viewer so the GM can copy the writeup by hand. The grab can
      // fail on a locked, scanned, or missing PDF — say so, because the
      // workspace is already open and would otherwise just sit there empty.
      try {
        const { overlayFor } = await import("./char-content/class-overlays.mjs");
        const page = target.dataset.pages || overlayFor(name)?.pages;
        if (sourcePdfTarget(src, page)) await app._onGrabPdf();
        else {
          const href = sourcePdfHref(src, page);
          if (href) this._showSourcePdf(href, `${name} writeup${page ? ` — p.${page}` : ""}`);
        }
      } catch (err) {
        console.error("Shadowdark Enhancer | class unlock extraction failed", err);
        ui.notifications.error(`Couldn't pull the “${name}” writeup from the source PDF — paste it by hand, or see the console.`);
      }
      return;
    }

    // Gear (Basic / Weapons / Armor) goes to the dedicated Item Builder — a
    // guided table → descriptions → combine flow, not the generic paste box
    // (which only ever made cost-only stubs with no descriptions).
    if (["Basic", "Weapon", "Armor"].includes(type)) {
      const { ItemBuilderApp } = await import("./items/item-builder-app.mjs");
      const app = ItemBuilderApp.open();
      app._reset();
      app._gearType = type;
      if (src) app._source = CHAR_SOURCES[src]?.label ?? src;
      app.render();
      // One press = open + grab the price table AND the descriptions (falls
      // back to manual paste when the source PDF/pages aren't linked). The GM
      // then fixes any description the two-column grab missed via Open PDF.
      // A failed grab leaves the builder open and empty, so report it rather
      // than letting the rejection disappear.
      try {
        await app._onGrabTable();
        await app._onGrabDesc();
      } catch (err) {
        console.error("Shadowdark Enhancer | gear unlock extraction failed", err);
        ui.notifications.error(`Couldn't pull the ${type.toLowerCase()} tables from the source PDF — paste them by hand, or see the console.`);
      }
      return;
    }

    // Generic content unlock (Table / Talent / Background / Ancestry): seed the
    // paste box + one-press extract via the shared helper (also used by external
    // callers like the Loot Setup treasure-library Unlock buttons).
    await this._seedGenericUnlock({
      name, src, type,
      contentId: target.dataset.contentId,
      page: target.dataset.pages,
    });
  }

  /**
   * Seed the paste box for a generic content unlock and one-press extract the
   * cited page from the source PDF. Shared path for the Manage tree unlock rows
   * (_onCharSeedPaste) and external openers (ImporterHubApp.openContentUnlock),
   * so both drive an identical seed + auto-grab flow. Spell/Class/Gear unlocks
   * still route to their own workspaces in _onCharSeedPaste before reaching here.
   */
  async _seedGenericUnlock({ name, src = "", type = "Table", contentId = null, page = null } = {}) {
    if (!name) return;
    const importType = ({
      Spell: "spells",
      Basic: "items", Weapon: "items", Armor: "items",
      Background: "backgrounds",
      Talent: "talents",
      Class: "classes", Ancestry: "ancestries",
      Table: "tables",
    })[type] ?? "auto";
    // Background roll tables bundle-unlock: one paste creates both the d100
    // table AND the individual Background items (the char-builder lists those
    // for picking). Flagged so _onHubParse also runs the backgrounds parser.
    const bgBundle = type === "Table"
      && BACKGROUND_TABLES.has(name.toLowerCase().replace(/\s+/g, " ").trim());
    // Trailing newline so the seeded name reads as a title line and the GM's
    // pasted section lands on the line AFTER it (review: unlock line break).
    this._importText = `${name}\n`;
    this._importSeed = {
      name,
      src,
      type,
      // Persistent content id (PDF-import review §09 rec #2): prefer the id the
      // manage-tree stamped, else derive it from the name via the registry's
      // reverse index. Drives collision-free shape dispatch in _onHubParse.
      contentId: contentId || contentIdForName(name, src) || undefined,
      page: page || undefined,
      book: CHAR_SOURCES[src]?.book || src || undefined,
      _charSeed: true,
      _bgBundle: bgBundle,
    };
    this._importType = importType;
    // An item unlock (Basic Gear / Weapons / Armor) forces its subtype so Parse
    // runs in "force" mode — the grabbed page is a wide equipment TABLE, which
    // must be row-split into items, not left as one blank-line block that fuses
    // into a single garbage item. Non-item seeds reset it so a stale subtype
    // never mis-types a later paste.
    this._importItemSubtype = ["Basic", "Weapon", "Armor"].includes(type) ? type : "auto";
    if (src && CHAR_SOURCES[src]) this._importSource = CHAR_SOURCES[src].label;
    // Await the render so the textarea holds the seeded name line before the
    // auto-extract reads it — otherwise it reads a stale box and drops the name.
    await this.render();
    // One press does Import + extraction: when this source's PDF is uploaded and
    // the entry has a page cite, pull that page straight into the paste box (no
    // separate Grab-text click). Falls back to opening the viewer for manual copy
    // when no PDF/page is linked.
    if (sourcePdfTarget(src, this._importSeed.page)) {
      await this._onGrabPdfText();
    } else {
      const href = sourcePdfHref(src, this._importSeed.page);
      if (href) this._showSourcePdf(href, `${name}${this._importSeed.page ? ` — p.${this._importSeed.page}` : ""}`);
    }
  }

  /** Open (or re-point) the in-Foundry PDF viewer at `href`, titled `title`. */
  async _showSourcePdf(href, title) {
    if (!href) return;
    const { SourcePdfViewer } = await import("./source-pdf-viewer.mjs");
    SourcePdfViewer.show(href, title);
  }

  /**
   * Open the user's uploaded source PDF at the seed's cited page in Foundry's
   * core PDF.js viewer (own local copy — nothing is bundled), embedded in a
   * Foundry window rather than an external browser tab. Reuses one viewer
   * window so repeated clicks re-jump the page in place.
   */
  async _onOpenSourcePdf(event, target) {
    const href = target?.dataset?.href;
    if (!href) return;
    const seed = this._importSeed;
    const title = seed?.name
      ? `${seed.name}${seed.page ? ` — p.${seed.page}` : ""}`
      : "Source PDF";
    this._showSourcePdf(href, title);
  }

  /**
   * "Grab text" (seed flow): pull the cited page's text straight out of the
   * source PDF and drop it into the paste box — no viewer, no drag-selecting.
   * Uses Foundry's bundled PDF.js (see pdf-text-extract.mjs); column-aware so
   * two-column spell/table pages come out in reading order. Appends after
   * whatever's already in the box (the seeded name line stays the title).
   */
  async _onGrabPdfText() {
    const seed = this._importSeed;
    const target = seed ? sourcePdfTarget(seed.src, seed.page) : null;
    if (!target) {
      ui.notifications.warn("No source PDF is linked for this entry, or it has no page cite. Use “Source PDFs” to upload the book.");
      return;
    }
    // Preserve any live edits in the box before we append to it.
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;

    // A page cite may be a RANGE ("74-77", the WR d100 background list). Expand
    // it to every PDF page (offset-corrected per page via sourcePdfTarget) so a
    // multi-page table imports whole, not just its first page. A background
    // bundle forces 1-column extraction: 2-column mode splits each entry's
    // description off its name, which the "Name. Text" background parser drops.
    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    const bookPages = parsePageRange(seed.page);
    const pdfPages = (bookPages.length ? bookPages : [null])
      .map((bp) => (bp == null ? target.page : sourcePdfTarget(seed.src, String(bp))?.page))
      .filter((p) => p != null);
    // Column mode by shape: a prayer generator is a 3-column layout that needs
    // "layout" (x-gaps → 2+ spaces); a section-slice table is stacked under an
    // ALL-CAPS caption that the 2-column gutter split shreds, so it needs single
    // column; background bundles force single column too. Everything else auto.
    const { resolveShape } = await import("./tables/table-shapes.mjs");
    const shp = resolveShape({ contentId: seed?.contentId, name: seed?.name, src: seed?.src });
    const columns = seed._bgBundle ? "1"
      // Item unlocks come off a wide equipment table (Item · Cost · Quantity ·
      // Slot). Single-column keeps each row's name and price on the SAME line;
      // "auto" detects a false gutter and transposes the columns into a jumble.
      : ["Basic", "Weapon", "Armor"].includes(seed?.type) ? "1"
      // An entry may pin its own extraction mode (Boons: Secrets needs "1" so
      // each grid row stays on one line for the reflow boundary split).
      : shp?.extractCols ? shp.extractCols
      : shp?.split === "prayer" ? "layout"
      : (shp?.kind === "section" || shp?.kind === "gridcol" || shp?.kind === "matrix" || shp?.kind === "longtable") ? (shp.cols || "1")
      : "auto";

    let result;
    try {
      result = await extractPdfText(target.file, { pages: pdfPages.length ? pdfPages : [target.page], columns });
    } catch (err) {
      console.error("Shadowdark Enhancer | PDF text extraction failed", err);
      ui.notifications.error("Couldn't read text from that PDF page — see the console.");
      return;
    }
    if (!result.text) {
      ui.notifications.warn(`Page ${target.page} has no selectable text (likely a scanned or art page).`);
      return;
    }
    const base = this._importText.replace(/\s*$/, "");
    this._importText = base ? `${base}\n${result.text}\n` : `${result.text}\n`;
    this.render();
    ui.notifications.info(`Pulled page ${target.page} into the paste box — review, then Parse.`);
  }

  /**
   * The CHAR_SOURCES key to pre-select in the Extract dialog: from the active
   * seed's source (a manifest key like "CS4" or a display label like "Western
   * Reaches") or the free-text Source field. Lets a monster-gap "Grab from PDF"
   * open straight to the right book. Null when nothing matches.
   */
  _defaultExtractSrc() {
    const cand = String(this._importSeed?.src || this._importSource || "").trim().toLowerCase();
    if (!cand) return null;
    for (const [k, v] of Object.entries(CHAR_SOURCES)) {
      if (k.toLowerCase() === cand
        || (v.label && v.label.toLowerCase() === cand)
        || (v.book && v.book.toLowerCase() === cand)) return k;
    }
    return null;
  }

  /**
   * "Extract from PDF" (standalone): pick a linked source book, a page or page
   * range, and column handling, then drop the extracted text into the paste
   * box. Same engine as the seed-flow grab, but page-driven for content that
   * isn't tied to an unlock row (e.g. monster-census gaps, which know the book
   * but not the page). Pre-selects the book from the active seed / source.
   */
  async _onExtractPdf() {
    const { listSourcePdfs } = await import("./source-pdf-registry.mjs");
    const rows = (await listSourcePdfs()).filter((r) => r.linked && r.file);
    if (!rows.length) {
      ui.notifications.warn("No source PDFs are linked yet. Use “Source PDFs” to upload your books first.");
      return;
    }
    const defaultSrc = this._defaultExtractSrc();
    const options = rows
      .map((r) => `<option value="${r.src}"${r.src === defaultSrc ? " selected" : ""}>${foundry.utils.escapeHTML(r.label)}</option>`)
      .join("");
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: "Extract text from PDF", icon: "fas fa-file-pdf" },
      content: `
        <p>Pull clean, reading-ordered text out of one of your uploaded books
        using Foundry's built-in PDF engine — nothing is uploaded.</p>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 0.6rem;align-items:center;">
          <label for="sde-xpdf-src"><strong>Book</strong></label>
          <select id="sde-xpdf-src" name="src">${options}</select>
          <label for="sde-xpdf-pages"><strong>Pages</strong></label>
          <input id="sde-xpdf-pages" name="pages" type="text" placeholder="e.g. 34 or 34-36 or 12,16,20-22">
          <label for="sde-xpdf-cols"><strong>Columns</strong></label>
          <select id="sde-xpdf-cols" name="cols">
            <option value="auto" selected>Auto-detect</option>
            <option value="1">Single column</option>
            <option value="2">Two columns</option>
          </select>
        </div>
        <p class="notes">These are the book's own PDF page numbers (including cover/credits), not the printed page. Auto-detect handles two-column spell/table pages; force Single/Two if a page comes out jumbled. <strong>A wide equipment table (Item · Cost · Quantity · Slot) reads best as Single column</strong> — Auto-detect scrambles its columns into a jumble.</p>`,
      buttons: [
        { action: "extract", label: "Extract", icon: "fas fa-file-pdf", default: true,
          callback: (event, button) => ({
            src: button.form.elements.src.value,
            pages: button.form.elements.pages.value,
            cols: button.form.elements.cols.value,
          }) },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!picked || picked === "cancel") return;

    const { resolveSourcePdf } = await import("./source-pdf-registry.mjs");
    const file = resolveSourcePdf(picked.src);
    if (!file) { ui.notifications.warn("That book isn't linked to a PDF."); return; }

    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    let result;
    try {
      const doc = await extractPdfText(file, { pages: [1] });   // cheap open to learn page count
      const pages = parsePageRange(picked.pages, doc.numPages);
      if (!pages.length) {
        ui.notifications.warn("Enter at least one valid page number.");
        return;
      }
      result = await extractPdfText(file, { pages, columns: picked.cols });
    } catch (err) {
      console.error("Shadowdark Enhancer | PDF text extraction failed", err);
      ui.notifications.error("Couldn't read text from that PDF — see the console.");
      return;
    }
    if (!result.text) {
      ui.notifications.warn("Those pages have no selectable text (likely scanned or art pages).");
      return;
    }
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    const base = this._importText.replace(/\s*$/, "");
    this._importText = base ? `${base}\n${result.text}\n` : `${result.text}\n`;
    // Stamp the source label from the picked book if the field is empty.
    if (!this._importSource.trim() && CHAR_SOURCES[picked.src]) {
      this._importSource = CHAR_SOURCES[picked.src].label;
    }
    this.render();
    const empties = result.pages.filter((p) => p.empty).map((p) => p.page);
    const emptyNote = empties.length ? ` (${empties.length} page${empties.length > 1 ? "s" : ""} had no text: ${empties.join(", ")})` : "";
    ui.notifications.info(`Extracted ${result.pages.length - empties.length} page(s) into the paste box${emptyNote} — review, then Parse.`);
  }

  /**
   * Guided cull for duplicate sde-items: read the chosen keeper, confirm via
   * DialogV2, delete the other pack copies (D-06). Mirrors _onMonsterCullGroup.
   */
  async _onItemCullGroup(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can cull duplicates."); return; }

    const groupKey = target.dataset.groupKey ?? "";
    if (!groupKey) return;
    const groups = this._itemsCache?.duplicateGroups ?? [];
    const group = groups.find((g) => g.key === groupKey);
    if (!group) { ui.notifications.warn("Duplicate group not found — refresh the Items tab."); return; }

    const card = target.closest(".sde-hub-monsters-dup-card");
    const checkedRadio = card?.querySelector("input[type='radio']:checked");
    const keepUuid = checkedRadio?.value ?? "";
    if (!keepUuid) { ui.notifications.warn("Select a keeper before culling."); return; }

    const dropMembers = group.members.filter((m) => m.uuid !== keepUuid);
    if (!dropMembers.length) { ui.notifications.info("Nothing to cull — only one member selected as keeper."); return; }

    const keepMember = group.members.find((m) => m.uuid === keepUuid);
    const keepLabel  = foundry.utils.escapeHTML(keepMember?.name ?? keepUuid);
    const dropList   = dropMembers.map((m) => `<li>${foundry.utils.escapeHTML(m.name)} <em>(${m.source || "unknown source"})</em></li>`).join("");
    const content = `
      <p>Keep: <strong>${keepLabel}</strong></p>
      <p>Delete these pack copies:</p>
      <ul style="margin:.3em 0">${dropList}</ul>
      <p style="color:var(--sde-bar-text-muted,#9a9a9a);font-size:.85em">
        Only pack copies in sde-items are deleted. World items and _Backup docs are never touched.
      </p>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cull Duplicate Items" },
      content,
      buttons: [
        { action: "cull",   label: "Delete copies", default: true },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (choice !== "cull") return;

    const tally = await cullItemDuplicates(keepUuid, dropMembers.map((m) => m.uuid));
    const parts = [];
    if (tally.deleted) parts.push(`${tally.deleted} deleted`);
    if (tally.skipped) parts.push(`${tally.skipped} skipped`);
    if (tally.failed)  parts.push(`${tally.failed} failed (see console)`);
    ui.notifications.info(`Cull complete: ${parts.join(", ") || "nothing done"}.`);

    this._invalidateItemsCache();
    this.render();
  }

}

export function installHubManage(cls) { installMethods(cls, HubManageMethods); }
