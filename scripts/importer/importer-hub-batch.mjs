/**
 * Importer Hub — batch ("Import everything") runner.
 *
 * Drives the ordinary unlock → grab → Parse → Create flow unattended over every
 * locked row in the Manage tree, or every row under one folder. The per-step
 * behaviour is UNCHANGED: this file presses the same handlers a GM presses, in
 * the same order, through the same parsers and the same commit paths. What it
 * adds is sequencing, progress, cancellation, and a report — so a GM who has
 * uploaded their books doesn't click Unlock/Parse/Create two hundred times.
 *
 * Installed onto ImporterHubApp.prototype by installHubBatch(cls), like the
 * paste/commit/manage part files — `this` is always the live hub instance.
 *
 * The three rules a batch run holds to, because nobody is watching it:
 *
 *  1. NOTHING IS OVERWRITTEN. Every conflict auto-answers "keep what's there"
 *     (skip / cancel — never replace, never rename-as-copy), so a second run
 *     over the same library creates nothing and duplicates nothing. The
 *     Item Builder's own gear commit is the one documented exception: it
 *     refreshes a row it already owns (see the gear route below).
 *  2. NOTHING BROKEN IS COMMITTED. The table/generator quality gate answers
 *     "Commit clean only", so a draft with blockers stays in the preview
 *     instead of being written unreviewed. A class that fails its gate is
 *     skipped outright and reported.
 *  3. EVERY ROW IS ACCOUNTED FOR. A row the batch can't drive — no source PDF,
 *     no page cite, no automated route — is reported with the reason, never
 *     dropped. The end-of-run report is the deliverable, not the toasts.
 */

import { installMethods } from "./importer-hub-shared.mjs";
import { CHAR_SOURCES } from "./char-content/char-content-manifest.mjs";
import { sourcePdfTarget } from "./source-pdf-registry.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { ROUTE, planBatch, summarizeBatch } from "./batch-import.mjs";

/** Per-source, per-type gear page cites the Item Builder can grab (mirrors its
 *  own GEAR_PAGES — only what's verified; anything else is a manual paste). */
const GEAR_GRABBABLE = { WR: { Basic: "106-107", Weapon: "110-111", Armor: "112" } };

/** Downtime slug → source-PDF key (mirrors importer-hub-manage's own map). */
const DOWNTIME_PDF_KEYS = { "cs6": "CS6", "western-reaches": "WR" };

/** Let the browser paint (and any pending render settle) before the next job,
 *  so a long run stays responsive and the Stop button stays clickable. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class HubBatchMethods {

  // ── Entry points ───────────────────────────────────────────────────────────

  /**
   * "Import everything" / a folder's "Import all". Plans the run, confirms it,
   * then executes. `data-node-id` scopes the run to one Manage-tree branch;
   * absent = the whole tree.
   */
  async _onBatchImport(event, target) {
    if (!game.user?.isGM) { ui.notifications.warn("Only a GM can import."); return; }
    if (this._batchState) { ui.notifications.warn("A batch import is already running."); return; }

    const rootId = target?.dataset?.nodeId || null;
    const scopeLabel = rootId ? (target?.dataset?.label || "this folder") : "your whole library";
    // Claim the run NOW. Both the census below and the confirm dialog are
    // awaited, and the tree stays clickable through them — without this a
    // second click would plan and run the same entries in parallel.
    this._batchState = { total: 0, done: 0, cancelled: false, label: scopeLabel, current: "Planning…" };
    let plan;
    try {
      // The tree is the plan's input, so it must exist even when the GM clicked
      // the top-level button without ever expanding the Manage strip.
      if (!this._manageTreeCache) await this._prepareManageTree();
      plan = planBatch(this._manageTreeCache ?? [], {
        rootId, canRun: (entry, route) => this._batchCanRun(entry, route),
      });
      if (!plan.jobs.length) {
        const why = plan.blocked.length
          ? `Nothing can run unattended here — ${plan.blocked.length} row${plan.blocked.length === 1 ? "" : "s"} need${plan.blocked.length === 1 ? "s" : ""} a source PDF or a hand paste.`
          : "Nothing left to import here — every row is already in your library.";
        ui.notifications.info(why);
        if (plan.blocked.length) await this._batchReportDialog(summarizeBatch([], plan.blocked), scopeLabel);
        return;
      }
      if (!(await this._batchConfirmDialog(plan, scopeLabel))) return;
    } finally {
      // _runBatch installs its own state; anything that returns above must not
      // leave the hub thinking a run is in flight.
      this._batchState = null;
    }
    await this._runBatch(plan, scopeLabel);
  }

  /** Cancel the running batch after the job in flight finishes. */
  _onBatchCancel() {
    if (!this._batchState) return;
    this._batchState.cancelled = true;
    ui.notifications.info("Stopping after the current entry…");
    this.render();
  }

  // ── Planning helpers ───────────────────────────────────────────────────────

  /**
   * Can this world drive `entry` unattended? Returns true, or the reason it
   * can't — every route needs the GM's own uploaded book to grab text from, so
   * this is mostly "is the PDF linked and does the row cite a page".
   */
  _batchCanRun(entry, route) {
    const src = entry?.src ?? "";
    const book = CHAR_SOURCES[src]?.label || src || "its source book";
    if (route === ROUTE.SPELLS && !entry?.listKey) {
      return "no spell list to preset — open the Spell Importer for this one";
    }
    if (route === ROUTE.DOWNTIME) {
      // A downtime row deliberately carries a BLANK src (so its page chip reads
      // "pg 26-27", not "cs6 pg 26-27") — the book key lives on the slug, the
      // same lookup _seedDowntimeUnlock does.
      const key = DOWNTIME_PDF_KEYS[entry?.listKey];
      const label = CHAR_SOURCES[key]?.label || entry?.name || "that book";
      if (!key) return "no source book mapped for this downtime row — unlock it by hand";
      return sourcePdfTarget(key, entry?.pages) ? true
        : `${label}'s PDF isn't linked — upload it under Source PDFs, then run this again`;
    }
    if (route === ROUTE.GEAR) {
      const pages = GEAR_GRABBABLE[src]?.[entry?.type];
      if (!pages) return `the Item Builder has no verified page cite for ${book} ${entry?.type ?? "gear"} — build this one by hand`;
      return sourcePdfTarget(src, pages) ? true : `${book}'s PDF isn't linked — upload it under Source PDFs`;
    }
    // Every other route grabs the row's own cited pages out of the book.
    if (!entry?.pages) return "no page citation on this row — import it by hand";
    if (!sourcePdfTarget(src, entry.pages)) {
      return `${book}'s PDF isn't linked — upload it under Source PDFs, then run this again`;
    }
    return true;
  }

  // ── The run ────────────────────────────────────────────────────────────────

  /**
   * Execute a plan job by job. Each job runs through the SAME handlers the
   * manual flow uses; only the dialogs are pre-answered (see `_batchAuto`) and
   * the toasts are collected instead of stacking two hundred deep.
   */
  async _runBatch(plan, scopeLabel) {
    const results = [];
    this._batchState = {
      total: plan.jobs.length, done: 0, cancelled: false,
      label: scopeLabel, current: plan.jobs[0]?.label ?? "",
    };
    // Pre-answer every commit dialog for the duration of the run. Read by the
    // conflict/quality-gate helpers in importer-hub-commit.mjs.
    this._batchAuto = {
      conflict: "skip",          // monsters + items: keep what's already there
      tableConflict: "cancel",   // tables: skip THIS table, keep going
      quality: "commit-clean",   // never write a draft with blockers
      downtimeDowngrade: "keep", // never re-lock outcomes already unlocked
    };
    const restoreNotifications = this._batchCaptureNotifications();

    try {
      for (const job of plan.jobs) {
        // Closing the Importer takes the paste box (and `this.element`) with it,
        // and every route reads it — so a closed window ends the run rather
        // than failing each remaining entry on a null element. Compared against
        // `false` on purpose: ApplicationV2's `rendered` is a real boolean, and
        // `!this.rendered` would also fire on anything that doesn't define it.
        if (this.rendered === false) this._batchState.cancelled = true;
        if (this._batchState.cancelled) {
          results.push({ job, status: "cancelled", note: "stopped before this entry ran", created: 0 });
          continue;
        }
        this._batchState.current = job.label;
        // Per-JOB sink: _batchFirstProblem must report THIS entry's problem,
        // not a warning left over from the entry before it.
        if (this._batchNotices) this._batchNotices.length = 0;
        await this.render();
        let result;
        try {
          result = await this._runBatchJob(job);
        } catch (err) {
          console.error(`${MODULE_ID} | batch import failed on "${job.label}"`, err);
          result = { status: "failed", note: err?.message ? String(err.message) : "see the console", created: 0 };
        }
        results.push({ job, ...result });
        this._batchState.done++;
        await breathe();
      }
    } finally {
      restoreNotifications();
      this._batchAuto = null;
      this._batchState = null;
      // The run created content, so every census the tree is built from is
      // stale. Rebuild once at the end rather than after each job — a census
      // pass per entry would cost more than the imports themselves.
      this._invalidateManageTree();
      this._invalidateMonstersCache?.();
      this._invalidateItemsCache?.();
      this._onHubClear();
      await this.render();
    }

    const summary = summarizeBatch(results, plan.blocked);
    const entryTotal = summary.entries ?? summary.jobs + summary.blocked;
    ui.notifications.info(
      `Batch import: ${summary.documents} document${summary.documents === 1 ? "" : "s"} created across `
      + `${summary.created} of ${entryTotal} entr${entryTotal === 1 ? "y" : "ies"}`
      + `${summary.failed ? `, ${summary.failed} failed` : ""}`
      + `${summary.blocked ? `, ${summary.blocked} skipped` : ""}.`);
    await this._batchReportDialog(summary, scopeLabel);
  }

  /** Dispatch one job to the workspace its route names. */
  async _runBatchJob(job) {
    switch (job.route) {
      case ROUTE.HUB:      return this._batchRunHub(job);
      case ROUTE.SPELLS:   return this._batchRunSpells(job);
      case ROUTE.CLASS:    return this._batchRunClass(job);
      case ROUTE.GEAR:     return this._batchRunGear(job);
      case ROUTE.DOWNTIME: return this._batchRunDowntime(job);
      default:             return { status: "failed", note: `unknown route "${job.route}"`, created: 0 };
    }
  }

  // ── Route: the hub's own paste box ─────────────────────────────────────────

  /**
   * Import every selected Mount from one shared WR spread. The ordinary Mount
   * unlock remains a one-name parse; this batch-only seed tells that same parse
   * branch which names this job is responsible for, so the supported Mount
   * importer receives the whole selected set in one commit.
   */
  async _batchRunMounts(job) {
    const requested = (job.covers?.length ? job.covers : [job.entry])
      .filter((entry) => entry?.name);
    const names = [...new Set(requested
      .map((entry) => String(entry.name ?? "").trim()).filter(Boolean))];
    const first = requested[0] ?? job.entry;
    if (!names.length || !first?.name) {
      return { status: "failed", created: 0, note: "the Mount batch had no selected entries" };
    }

    this._onHubClear();
    await this._seedGenericUnlock({
      name: first.name, src: first.src, type: first.type,
      contentId: first.contentId, page: first.pages,
    });
    // The parser keeps one name for a normal click. This private batch marker
    // widens only this run to the names already covered by the stable job key;
    // it never changes the individual Import button's behavior.
    if (this._importSeed) this._importSeed._batchMountNames = names;
    await this.render();

    const noTextNote = this._batchFirstProblem()
      ?? "the source PDF gave no selectable text for those pages";
    if (!this._batchGrabbedBody(first.name)) {
      return {
        status: "nothing", created: 0,
        entries: names.map((name) => ({ name, status: "nothing", created: 0, note: noTextNote })),
        note: noTextNote,
      };
    }

    await this._onHubParse();
    const parsedNames = new Set(this._importMonsters.map((entry) => entry?.draft?.name));
    const skippedByName = new Map();
    for (const skipped of this._importSkipped ?? []) {
      if (names.includes(skipped?.name)) skippedByName.set(skipped.name, skipped.reason);
    }

    let report = null;
    if (this._importMonsters.length) report = await this._onHubCommitMonsters();
    const resultName = (value) => typeof value === "string" ? value : value?.name;
    const createdNames = new Set((report?.created ?? []).map(resultName));
    const replacedNames = new Set((report?.replaced ?? []).map(resultName));
    const skippedNames = new Set((report?.skipped ?? []).map(resultName));
    const entries = names.map((name) => {
      if (!parsedNames.has(name)) {
        return {
          name, status: "failed", created: 0,
          note: skippedByName.get(name) ?? "not among the statblocks on the extracted pages",
        };
      }
      if (createdNames.has(name) || replacedNames.has(name)) {
        return {
          name, status: "created", created: 1,
          note: replacedNames.has(name) ? "replaced" : "created",
        };
      }
      if (skippedNames.has(name)) {
        return { name, status: "nothing", created: 0, note: "already in your library" };
      }
      return { name, status: "failed", created: 0, note: "the Mount importer did not report a result" };
    });
    const created = entries.filter((entry) => entry.status === "created").length;
    const status = created ? "created"
      : entries.some((entry) => entry.status === "failed") ? "failed" : "nothing";
    return {
      status, created, entries,
      note: `${created} of ${names.length} mount${names.length === 1 ? "" : "s"} created`,
    };
  }

  /**
   * Seed → grab → Parse → Create through the hub itself. The seeding is the
   * existing per-row handler (so the shape dispatch, page-offset expansion and
   * column-mode ladder are byte-identical to a click), and the commit is
   * _onHubCommitAll — the same button a GM presses under the preview.
   */
  async _batchRunHub(job) {
    const entry = job.entry;
    if (entry.type === "Mount") return this._batchRunMounts(job);
    this._onHubClear();
    if (entry.seedAction === "monsterSeedPaste") {
      await this._onMonsterSeedPaste(null, { dataset: {
        name: entry.name ?? "", src: entry.src ?? "", pages: entry.pages ?? "", type: entry.type ?? "",
      } });
    } else {
      await this._seedGenericUnlock({
        name: entry.name, src: entry.src, type: entry.type,
        contentId: entry.contentId, page: entry.pages,
      });
    }
    // _onGrabPdfText fires its render WITHOUT awaiting, so the textarea on
    // screen still holds the pre-grab value here — and _onHubParse reads the
    // textarea back over _importText. Settle the render first or the parse
    // runs on an empty box (the same trap _autoGrabDowntimePdf documents).
    await this.render();
    // Every seed writes the entry's name as a title line, so an empty box is
    // not the signal — what matters is whether the GRAB added anything under
    // it. Without this a failed extraction parses the bare name and reports
    // "nothing recognized" instead of "your PDF had no text on that page".
    if (!this._batchGrabbedBody(entry.name)) {
      return {
        status: "nothing", created: 0,
        note: this._batchFirstProblem() ?? "the source PDF gave no selectable text for those pages",
      };
    }

    await this._onHubParse();
    const before = this._batchDraftCount();
    if (!before) {
      return { status: "nothing", note: this._batchFirstProblem() ?? "nothing recognized on those pages", created: 0 };
    }
    await this._batchCommitPreview();
    // The commit paths empty each bucket they wrote, so what's LEFT is what was
    // skipped (a conflict, or a draft the quality gate held back).
    const left = this._batchDraftCount();
    const created = Math.max(0, before - left);
    if (!created) {
      return {
        status: "nothing", created: 0,
        note: this._batchFirstProblem() ?? "already in your library, or stopped by the quality check",
      };
    }
    return {
      status: "created", created,
      note: left
        ? `${created} created; ${left} failed the quality check and were NOT imported — re-run this row's own Import to fix them`
        : `${created} created`,
    };
  }

  /**
   * Press every Create button the preview would be showing. `_onHubCommitAll`
   * covers monsters/items/spells/tables only — generators, character content
   * and boats each have their own button under the preview, and a shape parse
   * or a background bundle routinely fills those buckets. Committing just the
   * four would leave a prayer generator or an ancestry sitting in a preview
   * that the next entry then clears.
   *
   * Character content goes LAST. A background bundle's `_onHubCommitChar`
   * commits the paste's d100 table itself when one is still pending — running
   * it after the tables makes that a no-op (each commit clears what it wrote)
   * rather than a second pass over the same draft.
   */
  async _batchCommitPreview() {
    if (this._importGenerators.length) await this._onHubCommitGenerators();
    if (this._importBoats.length) await this._onHubCommitBoats();
    if (this._importMonsters.length || this._importItems.length
        || this._importSpells.length || this._importTables.length) {
      await this._onHubCommitAll();
    }
    if (this._importChar.length) await this._onHubCommitChar();
  }

  /**
   * Did the PDF grab put anything in the box beyond the seeded name line?
   * The seed is written before the grab runs, so a failed extraction leaves a
   * box that is non-empty but carries no book text.
   */
  _batchGrabbedBody(seedName) {
    const seed = String(seedName ?? "").trim().toLowerCase();
    return this._importText
      .split("\n")
      .some((line) => { const t = line.trim(); return t && t.toLowerCase() !== seed; });
  }

  /** How many drafts are sitting in the preview right now. */
  _batchDraftCount() {
    return this._importMonsters.length + this._importItems.length + this._importSpells.length
      + this._importTables.length + this._importGenerators.length
      + this._importChar.length + this._importBoats.length;
  }

  /** The first warning/error the captured toasts recorded for this job. */
  _batchFirstProblem() {
    const sink = this._batchNotices;
    if (!sink?.length) return null;
    const hit = sink.find((n) => n.level === "error") ?? sink.find((n) => n.level === "warn");
    return hit ? hit.message : null;
  }

  // ── Route: the Spell Importer ──────────────────────────────────────────────

  /** Preset the list, grab its pages, parse, import. `_onImport` already
   *  conflict-skips, so a re-run over an imported list creates nothing. */
  async _batchRunSpells(job) {
    const { SpellImporterApp } = await import("./spells/spell-importer-app.mjs");
    const app = SpellImporterApp.open();
    app._reset();
    app._onSelectList(job.entry.listKey, { openPdf: false });
    // _autoGrabList pulls the writeup pages AND parses them, returning whether
    // any spell came out — so there is nothing to parse again here.
    const grabbed = await app._autoGrabList();
    if (!grabbed) {
      return {
        status: "nothing", created: 0,
        note: app._pasteText?.trim()
          ? "pulled the list's pages but found no spell writeups on them"
          : "couldn't pull this list's pages from the source PDF",
      };
    }
    const wanted = app._spells.length;
    await app._onImport();
    const created = app._imported?.created ?? 0;
    if (!created) return { status: "nothing", note: `all ${wanted} spells were already in your library`, created: 0 };
    return { status: "created", created, note: `${created} of ${wanted} spells created` };
  }

  // ── Route: the Class Importer ──────────────────────────────────────────────

  /**
   * Grab the class writeup, preview it, create it. A class that trips its
   * quality gate (no talent table, BLOCKER warnings, unsplit title bands) is
   * SKIPPED and reported — never force-committed, because a half-parsed class
   * is worse than a locked one.
   */
  async _batchRunClass(job) {
    const entry = job.entry;
    const { ClassImporterApp } = await import("./char-content/class-importer-app.mjs");
    const { classGateIssues } = await import("./char-content/class-quality-gate.mjs");
    const app = ClassImporterApp.open();
    app._reset();
    if (entry.src) app._source = CHAR_SOURCES[entry.src]?.label ?? entry.src;
    app._seedClassName = entry.name;
    await app.render();
    await app._onGrabPdf();
    if (!app._bodyText?.trim()) {
      return { status: "nothing", note: "couldn't pull the class writeup from the source PDF", created: 0 };
    }
    app._onParseBody();
    if (!app._bodyParsed) {
      return { status: "nothing", note: "the grabbed pages didn't parse as a class (no Hit Points line)", created: 0 };
    }
    app._refreshTalentWarnings();   // bands may tile after the grab — clear stale gate blockers
    const issues = classGateIssues({
      warnings: app._bodyParsed.warnings,
      hasTalentTable: !!app._talentTable?.rows?.length,
      isSupplement: !!app._bodyParsed.classSupplement,
      titleWarnings: app._titleWarnings,
    });
    if (issues.length) {
      return {
        status: "failed", created: 0,
        note: `held back by the class quality check — ${issues[0]} Open the Class Importer to finish this one.`,
      };
    }
    await app._onCreateBody();
    if (!app._classUuid) return { status: "nothing", note: "the class wasn't created — see the Class Importer", created: 0 };
    const created = app._lastReport?.created ?? 0;
    return { status: "created", created, note: `class created with ${created} document${created === 1 ? "" : "s"}` };
  }

  // ── Route: the Item Builder ────────────────────────────────────────────────

  /**
   * The gear price table + its description pages, in one press each. Unlike
   * every other route this one REFRESHES rows it already owns: `_onCreate`
   * commits with "replace", which is what makes a second pass (after the GM
   * hand-fixes a description) update the item rather than fork a copy. It is
   * still non-destructive — it only ever rewrites the gear rows it just parsed
   * out of the book, and only in the suite's own items pack.
   */
  async _batchRunGear(job) {
    const entry = job.entry;
    const { ItemBuilderApp } = await import("./items/item-builder-app.mjs");
    const app = ItemBuilderApp.open();
    app._reset();
    app._gearType = entry.type;
    if (entry.src) app._source = CHAR_SOURCES[entry.src]?.label ?? entry.src;
    await app.render();
    await app._onGrabTable();     // grab + parse
    if (!app._items.length) {
      const dupes = app._systemDupes?.length ?? 0;
      return {
        status: "nothing", created: 0,
        note: dupes ? `every row is already in the Shadowdark system (${dupes} matched)` : "no priced rows parsed out of the price table",
      };
    }
    await app._onGrabDesc();      // grab + match (best-effort: rows commit either way)
    const wanted = app._items.length;
    await app._onCreate();
    const created = app._lastReport?.created ?? 0;
    const replaced = app._lastReport?.replaced ?? 0;
    if (!created && !replaced) return { status: "nothing", note: `none of the ${wanted} rows were created`, created: 0 };
    return {
      status: "created", created,
      note: `${created} created${replaced ? `, ${replaced} refreshed` : ""} of ${wanted} rows`,
    };
  }

  // ── Route: downtime (a world setting, not documents) ───────────────────────

  /** Seed the book, grab its downtime pages, parse, unlock the outcomes. */
  async _batchRunDowntime(job) {
    this._onHubClear();
    await this._onDowntimeSeedPaste(null, { dataset: { listKey: job.entry.listKey ?? "" } });
    await this.render();
    if (!this._importText.trim()) {
      return { status: "nothing", note: "the source PDF gave no selectable text for the downtime pages", created: 0 };
    }
    await this._onHubParse();
    const filled = Object.keys(this._downtimeParse?.filled ?? {}).length;
    if (!filled) return { status: "nothing", note: "nothing matched the downtime skeleton on those pages", created: 0 };
    await this._onHubCommitDowntime();
    if (this._downtimeParse) {
      return { status: "nothing", note: this._batchFirstProblem() ?? "the existing unlock was kept (it has more outcomes)", created: 0 };
    }
    return { status: "created", created: filled, note: `${filled} downtime outcomes unlocked` };
  }

  // ── Toast capture ──────────────────────────────────────────────────────────

  /**
   * Collect `ui.notifications` for the duration of a run instead of stacking
   * one toast per parse step per entry — a 200-row batch would bury the screen
   * for minutes and the GM would still have to scroll back to read them. The
   * messages are not lost: each job reads back the warning/error it produced
   * (_batchFirstProblem) and it lands on that row in the report.
   * @returns {() => void} the restore function (always call it in a `finally`)
   */
  _batchCaptureNotifications() {
    const notes = ui?.notifications;
    this._batchNotices = [];
    if (!notes) return () => { this._batchNotices = null; };

    const record = (level) => (message) => {
      this._batchNotices?.push({ level, message: String(message ?? "") });
      if (level === "error") console.warn(`${MODULE_ID} | batch import: ${message}`);
      return undefined;
    };
    // info/warn/error live on Notifications.prototype, so overriding them here
    // installs OWN properties that shadow the class. Restoring by re-assigning
    // what we read would leave those own properties behind forever (and would
    // write `undefined` over the method outright if a future Foundry drops one)
    // — so remember whether each key was an own property and delete the ones
    // that weren't. `notify` is covered too: some call sites reach it directly.
    const overrides = {
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      notify: (message, type = "info") => record(type === "warning" ? "warn" : type)(message),
    };
    const saved = [];
    for (const [key, fn] of Object.entries(overrides)) {
      saved.push([key, Object.prototype.hasOwnProperty.call(notes, key)
        ? Object.getOwnPropertyDescriptor(notes, key) : null]);
      notes[key] = fn;
    }
    return () => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(notes, key, descriptor);
        else delete notes[key];
      }
      this._batchNotices = null;
    };
  }

  // ── Dialogs ────────────────────────────────────────────────────────────────

  /** Confirm the run, spelling out exactly what it will and won't touch. */
  async _batchConfirmDialog(plan, scopeLabel) {
    const byRoute = new Map();
    for (const job of plan.jobs) byRoute.set(job.route, (byRoute.get(job.route) ?? 0) + 1);
    const routeLabel = {
      [ROUTE.HUB]: "through the paste box", [ROUTE.SPELLS]: "spell lists",
      [ROUTE.CLASS]: "classes", [ROUTE.GEAR]: "gear tables", [ROUTE.DOWNTIME]: "downtime books",
    };
    const rows = [...byRoute].map(([route, n]) =>
      `<li><strong>${n}</strong> ${esc(routeLabel[route] ?? route)}</li>`).join("");
    const covered = plan.jobs.reduce((a, j) => a + j.covers.length, 0);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import everything" },
      position: { width: 520 },
      content: `
        <p>Import <strong>${plan.jobs.length}</strong> entr${plan.jobs.length === 1 ? "y" : "ies"} from
           ${esc(scopeLabel)}, covering <strong>${covered}</strong> of the
           ${plan.lockedCount} row${plan.lockedCount === 1 ? "" : "s"} still locked:</p>
        <ul style="margin:.3em 0">${rows}</ul>
        ${plan.blocked.length ? `<p><i class="fas fa-circle-info"></i> ${plan.blocked.length} row${plan.blocked.length === 1 ? "" : "s"} can't run unattended (no linked PDF, no page cite, or a hand-paste entry). They're listed in the report at the end.</p>` : ""}
        <p style="color:var(--sde-bar-text-muted,#9a9a9a);font-size:.85em">
          Each entry runs the same unlock → grab → parse → create you'd click by hand, reading
          from your own uploaded books. Anything already in your library is kept as it is —
          nothing is replaced or deleted — and anything that fails a quality check is left for
          you to review. You can stop the run at any point.</p>`,
      buttons: [
        { action: "run", label: `Import ${plan.jobs.length}`, icon: "fa-solid fa-file-import", default: true },
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    return choice === "run";
  }

  /** End-of-run report: one line per entry, grouped by what happened to it. */
  async _batchReportDialog(summary, scopeLabel) {
    const groups = [
      { status: "created",   title: "Imported",              icon: "fa-circle-check" },
      { status: "nothing",   title: "Nothing to import",     icon: "fa-circle-minus" },
      { status: "failed",    title: "Needs your attention",  icon: "fa-triangle-exclamation" },
      { status: "cancelled", title: "Not run (cancelled)",   icon: "fa-ban" },
      { status: "blocked",   title: "Import these by hand",  icon: "fa-hand" },
    ];
    const body = groups.map((g) => {
      const lines = summary.lines.filter((l) => l.status === g.status);
      if (!lines.length) return "";
      const items = lines.map((l) =>
        `<li><strong>${esc(l.name)}</strong>${l.note ? ` — ${esc(l.note)}` : ""}</li>`).join("");
      return `<h4 style="margin:.6em 0 .2em"><i class="fas ${g.icon}"></i> ${g.title} (${lines.length})</h4>
              <ul style="margin:0 0 .2em 1.1em">${items}</ul>`;
    }).join("");
    await foundry.applications.api.DialogV2.wait({
      window: { title: "Batch import report" },
      position: { width: 620, height: 620 },
      content: `
        <p>${summary.documents} document${summary.documents === 1 ? "" : "s"} created from
           ${esc(scopeLabel)}.</p>
        <div style="max-height:440px;overflow:auto">${body || "<p>Nothing to report.</p>"}</div>`,
      buttons: [{ action: "ok", label: "Close", default: true }],
      rejectClose: false,
    }).catch(() => null);
  }
}

/** Install the batch runner onto the hub class. */
export function installHubBatch(cls) {
  installMethods(cls, HubBatchMethods);
}
