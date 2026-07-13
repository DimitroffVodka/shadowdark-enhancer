/**
 * Shadowdark Enhancer — Class Importer (ApplicationV2).
 *
 * A purpose-built, single-view workspace for the most complex import type: a
 * class. The class being built is pinned at the top; each PART of the class has
 * its own labeled paste zone with a live status, so nothing hides behind a
 * type dropdown.
 *
 *   Stage 1 · Class body   — paste the writeup → Create Class (body + features
 *                            only, via createClassUnit bodyOnly). Collapses to a
 *                            green "created" summary once done.
 *   Stage 2 · Roll tables  — talent table / titles / spells known / extra tables,
 *                            each a paste zone (forgiving: any paste is routed to
 *                            the right part). Titles are always editable by hand.
 *                            "Attach tables to <Class>" → mergeClassSupplement.
 *
 * Reuses the pure parsers (parseClassSection / parseClassSupplement) and the
 * Foundry-bound importer (createClassUnit / mergeClassSupplement) — this app is
 * only the workspace UI + state.
 */
import { parseClassSection, parseClassSupplement, sliceSpellsKnown } from "./class-parser.mjs";
import { overlayFor } from "./class-overlays.mjs";
import { sourcePdfHref, titlePageFor } from "./source-pdf-registry.mjs";
import { CHAR_SOURCES } from "./char-content-manifest.mjs";
import { MODULE_ID } from "../module-id.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Source labels offered as datalist suggestions (mirrors the hub). */
const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

const _strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export class ClassImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-class-importer",
    window: { title: "Class Importer", icon: "fa-solid fa-hat-wizard", resizable: true },
    position: { width: 720, height: 800 },
    actions: {
      ciParseBody:   ClassImporterApp.prototype._onParseBody,
      ciCreateBody:  ClassImporterApp.prototype._onCreateBody,
      ciEditBody:    ClassImporterApp.prototype._onEditBody,
      ciTitleAdd:    ClassImporterApp.prototype._onTitleAdd,
      ciTitleDel:    ClassImporterApp.prototype._onTitleDel,
      ciTalentAdd:   ClassImporterApp.prototype._onTalentAdd,
      ciTalentDel:   ClassImporterApp.prototype._onTalentDel,
      ciExtraAdd:      ClassImporterApp.prototype._onExtraAdd,
      ciExtraDelTable: ClassImporterApp.prototype._onExtraDelTable,
      ciExtraRowAdd:   ClassImporterApp.prototype._onExtraRowAdd,
      ciExtraRowDel:   ClassImporterApp.prototype._onExtraRowDel,
      ciSpellsRowAdd:  ClassImporterApp.prototype._onSpellsRowAdd,
      ciSpellsRowDel:  ClassImporterApp.prototype._onSpellsRowDel,
      ciClearPart:   ClassImporterApp.prototype._onClearPart,
      ciAttach:      ClassImporterApp.prototype._onAttach,
      ciOpenPdf:     ClassImporterApp.prototype._onOpenPdf,
      ciGrabPdf:     ClassImporterApp.prototype._onGrabPdf,
      ciStartOver:   ClassImporterApp.prototype._onStartOver,
    },
  };

  static PARTS = {
    body: {
      template: "modules/shadowdark-enhancer/templates/class-importer.hbs",
      scrollable: [""],
    },
  };

  // ── State ──────────────────────────────────────────────────────────────────
  // Default to Western Reaches — it's the source the de-seal workflow targets and
  // the only one with mapped PDF pages, so the Open-PDF links work out of the box.
  _source = "Western Reaches";
  // Stage 1
  _seedClassName = "";         // class name from an "Unlock" click (before any paste)
  _bodyName = "";              // the authoritative class name (editable; seeds from unlock)
  _bodyText = "";
  _bodyParsed = null;          // parseClassSection() preview before Create
  _editingBody = false;        // re-paste-to-update mode
  _classUuid = null;           // set once the class body is created
  _className = "";
  _isCaster = false;
  // Stage 2
  _talentTable = null;
  _titles = [];                // editable bands {from,to,lawful,chaotic,neutral}
  _titleWarnings = [];         // per-band parse warnings (e.g. couldn't-split), for review flags
  _spellsKnown = [];
  _extraTables = [];           // [{name, formula, rows}]
  _lastReport = null;          // last create/attach report for the summary
  _imported = null;            // green-check summary of what's on the class

  // Paste-box focus/cursor preservation for the stage-1 body box.
  _bodyFocused = false;
  _bodyCursor = 0;

  // ── Singleton ──────────────────────────────────────────────────────────────
  static _instance = null;
  static open() {
    if (!this._instance) this._instance = new ClassImporterApp();
    const inst = this._instance;
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }
  async close(options = {}) {
    ClassImporterApp._instance = null;
    return super.close(options);
  }

  // ── Context ────────────────────────────────────────────────────────────────
  async _prepareContext() {
    const p = this._bodyParsed;
    const bodyPreview = p ? {
      name: p.name,
      hp: p.hitPoints,
      features: p.features.map((f) => ({ name: f.name, text: _strip(f.description) })),
      weapons: [p.allWeapons && "all weapons", p.allMeleeWeapons && "all melee", p.allRangedWeapons && "all ranged", ...p.weaponNames].filter(Boolean).join(", "),
      armor: [p.allArmor && "all armor", ...p.armorNames].filter(Boolean).join(", "),
      isCaster: !!p.spellcasting,
      hasTables: !!(p.talentTable || p.titles?.length || p.spellsKnown?.length || p.extraTables?.length),
      // Drop warnings about the roll tables — those are added in Stage 2, not the body.
      warnings: (p.warnings ?? []).filter((w) => !/No TALENTS table|No TITLES table|No SPELLS KNOWN|Roll tables|import them in/i.test(w)),
    } : null;

    // Match each per-band parse warning ("Titles row 7-8: …") to its band by the
    // leading level, so the flagged band is highlighted for review in place.
    const flagFor = (band) => this._titleWarnings.find((w) => {
      const m = String(w).match(/row\s+(\d+)/i);
      return m && Number(m[1]) === band.from;
    }) ?? null;
    const titles = this._titles.map((t, i) => ({
      idx: i,
      range: t.from === t.to ? String(t.from) : `${t.from}-${t.to}`,
      lawful: t.lawful, chaotic: t.chaotic, neutral: t.neutral,
      flagged: !!flagFor(t), flagReason: flagFor(t) ?? "",
    }));

    // Source-PDF deep links: the class writeup page (from its overlay) and the
    // titles-appendix page (separate section) — so the GM can open the book to
    // exactly the right page to copy from. `_seedClassName` lets an "Unlock"
    // click surface the writeup PDF link before anything is pasted.
    const name = this._className || p?.name || this._seedClassName || "";
    const srcKey = this._sourceKey();
    const writeupPage = overlayFor(name)?.pages ?? null;
    const titlesPage = titlePageFor(name);
    const writeupPdf = (srcKey && writeupPage) ? sourcePdfHref(srcKey, writeupPage) : null;
    const titlesPdf = (srcKey && titlesPage) ? sourcePdfHref(srcKey, titlesPage) : null;

    return {
      source: this._source,
      sourceList: SOURCE_SUGGESTIONS,
      bodyText: this._bodyText,
      bodyPreview,
      created: !!this._classUuid,
      editingBody: this._editingBody,
      showBody: this._editingBody || !this._classUuid,
      className: this._className,
      bodyName: this._bodyName || this._seedClassName || "",
      // Name shown on the Attach button (before create there's no _className yet).
      displayName: this._className || this._bodyName || this._seedClassName || "this class",
      // Caster state — from the created class, or the parsed preview before create.
      isCaster: this._isCaster || !!p?.spellcasting,
      // Stage-2 part statuses
      talent: this._talentTable ? {
        rows: this._talentTable.rows.length,
        formula: this._talentTable.formula,
        // Editable/reviewable rows — parity with the titles table.
        entries: this._talentTable.rows.map((r, i) => ({
          idx: i,
          range: r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`,
          text: _strip(r.text ?? ""),
        })),
      } : null,
      titles,
      titlesCount: titles.length,
      titleWarnings: this._titleWarnings,
      spells: this._spellsKnown.length ? {
        rows: this._spellsKnown.length,
        entries: this._spellsKnown.map((r, i) => ({
          idx: i, level: r.level,
          t1: r.tiers?.[0] ?? "", t2: r.tiers?.[1] ?? "", t3: r.tiers?.[2] ?? "",
          t4: r.tiers?.[3] ?? "", t5: r.tiers?.[4] ?? "",
        })),
      } : null,
      extras: this._extraTables.map((t, ti) => ({
        idx: ti, name: t.name, formula: t.formula,
        entries: (t.rows ?? []).map((r, i) => {
          const lo = r.lo ?? r.min, hi = r.hi ?? r.max;
          return { idx: i, range: lo === hi ? String(lo) : `${lo}-${hi}`, text: _strip(r.text ?? "") };
        }),
      })),
      // Source-PDF deep links
      seedClassName: this._seedClassName || null,
      pdfName: name || null,
      writeupPdf, writeupPage: writeupPage ? String(writeupPage) : null,
      titlesPdf, titlesPage: titlesPage ? String(titlesPage) : null,
      // Green-check "what imported" summary
      imported: this._imported,
      // Footer summary
      hasStage2: this._hasStage2(),
      pending: this._attachPending(),
      canAttach: !!this._classUuid && this._hasStage2(),
      report: this._lastReport,
    };
  }

  /** Map the free-text source (key / label / book name) to a CHAR_SOURCES key
   *  (WR / CS4 / …), or null. Matching all three keeps the Open-PDF links working
   *  no matter which form the source field or an unlock seed carries. */
  _sourceKey() {
    const s = this._source.trim().toLowerCase();
    if (!s) return null;
    for (const [key, meta] of Object.entries(CHAR_SOURCES))
      if (key.toLowerCase() === s || meta.label.toLowerCase() === s || meta.book?.toLowerCase() === s) return key;
    return null;
  }

  _hasStage2() {
    return !!this._talentTable || this._titles.length > 0 || this._spellsKnown.length > 0 || this._extraTables.length > 0;
  }

  /** Human summary of what's captured vs. pending for the footer. */
  _attachPending() {
    const done = [];
    if (this._talentTable) done.push("talent table");
    if (this._titles.length) done.push(`${this._titles.length} title${this._titles.length === 1 ? "" : "s"}`);
    if (this._spellsKnown.length) done.push("spells known");
    if (this._extraTables.length) done.push(`${this._extraTables.length} extra table${this._extraTables.length === 1 ? "" : "s"}`);
    return done.length ? done.join(" · ") : "nothing captured yet";
  }

  // ── Render wiring ──────────────────────────────────────────────────────────
  _onRender() {
    const el = this.element;

    // Source label
    const src = el.querySelector("input[data-ci-source]");
    if (src) src.addEventListener("input", (ev) => { this._source = ev.target.value; });

    // Class name (authoritative — not derived from the paste's first line)
    const nameInput = el.querySelector("input[data-ci-name]");
    if (nameInput) nameInput.addEventListener("input", (ev) => { this._bodyName = ev.target.value; });

    // Stage-1 body paste box (preserve cursor across the debounced re-render).
    const body = el.querySelector("textarea[data-ci-body]");
    if (body) {
      if (this._bodyFocused) { body.focus(); try { body.setSelectionRange(this._bodyCursor, this._bodyCursor); } catch (_e) {} }
      body.addEventListener("input", (ev) => { this._bodyText = ev.target.value; this._bodyCursor = ev.target.selectionStart ?? 0; });
      body.addEventListener("focus", () => { this._bodyFocused = true; });
      body.addEventListener("blur", () => { this._bodyFocused = false; });
    }

    // Stage-2 part paste boxes — forgiving: any paste is routed to its part(s).
    el.querySelectorAll("textarea[data-ci-paste]").forEach((ta) => {
      ta.addEventListener("change", (ev) => {
        const text = ev.target.value;
        ev.target.value = "";
        this._ingestPaste(text);
      });
    });

    // Editable title bands
    el.querySelectorAll("[data-ci-title] [data-ci-tfield]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const band = this._titles[Number(ev.target.closest("[data-ci-title]")?.dataset.ciTitle)];
        if (!band) return;
        const f = ev.target.dataset.ciTfield;
        const v = ev.target.value;
        if (f === "range") {
          const m = v.trim().match(/^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/);
          if (!m) { ev.target.value = band.from === band.to ? String(band.from) : `${band.from}-${band.to}`; return; }
          band.from = Number(m[1]); band.to = Number(m[2] ?? m[1]);
          ev.target.value = band.from === band.to ? String(band.from) : `${band.from}-${band.to}`;
        }
        else if (f === "lawful") band.lawful = v.trim();
        else if (f === "chaotic") band.chaotic = v.trim();
        else if (f === "neutral") band.neutral = v.trim();
      });
    });

    // Editable talent-table rows (roll range + effect) — parity with titles.
    el.querySelectorAll("[data-ci-talent] [data-ci-trfield]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const row = this._talentTable?.rows[Number(ev.target.closest("[data-ci-talent]")?.dataset.ciTalent)];
        if (!row) return;
        const f = ev.target.dataset.ciTrfield;
        const v = ev.target.value;
        if (f === "range") {
          const m = v.trim().match(/^(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/);
          if (!m) { ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`; return; }
          row.lo = Number(m[1]); row.hi = Number(m[2] ?? m[1]);
          ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`;
        } else if (f === "text") {
          row.text = v;
          delete row.options;   // an edited effect replaces any auto-split choice options
          row.kind = "single";
        }
      });
    });

    // Editable extra-table name + rows (Corruption, etc.)
    el.querySelectorAll("[data-ci-extra] [data-ci-ename]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const t = this._extraTables[Number(ev.target.closest("[data-ci-extra]")?.dataset.ciExtra)];
        if (t) t.name = ev.target.value.trim() || "Table";
      });
    });
    el.querySelectorAll("[data-ci-extra] [data-ci-erow] [data-ci-erfield]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const t = this._extraTables[Number(ev.target.closest("[data-ci-extra]")?.dataset.ciExtra)];
        const row = t?.rows[Number(ev.target.closest("[data-ci-erow]")?.dataset.ciErow)];
        if (!row) return;
        const f = ev.target.dataset.ciErfield, v = ev.target.value;
        if (f === "range") {
          const m = v.trim().match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
          if (!m) { ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`; return; }
          row.lo = Number(m[1]); row.hi = Number(m[2] ?? m[1]);
          ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`;
        } else if (f === "text") row.text = v;
      });
    });

    // Editable spells-known grid (level + counts per tier)
    el.querySelectorAll("[data-ci-sk] [data-ci-skfield]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const row = this._spellsKnown[Number(ev.target.closest("[data-ci-sk]")?.dataset.ciSk)];
        if (!row) return;
        const f = ev.target.dataset.ciSkfield, raw = ev.target.value.trim();
        if (f === "level") { const n = Number(raw); if (n >= 1) row.level = n; }
        else { const ti = Number(f) - 1; const n = raw === "" ? null : Number(raw); if (!row.tiers) row.tiers = [null,null,null,null,null]; row.tiers[ti] = Number.isFinite(n) ? n : null; }
      });
    });
  }

  /** Route a pasted tables block into the captured parts (forgiving). */
  _ingestPaste(text) {
    if (!String(text).trim()) return;
    const sup = parseClassSupplement(text);
    if (!sup) { ui.notifications?.info("No talent table, titles, spells known, or extra table found in that paste."); return; }
    const got = [];
    if (sup.talentTable) { this._talentTable = sup.talentTable; got.push("talent table"); }
    if (sup.titles?.length) {
      this._titles.push(...sup.titles);
      got.push(`${sup.titles.length} title band(s)`);
      this._titleWarnings.push(...(sup.warnings ?? []).filter((w) => /couldn'?t split|titles?\s+row/i.test(w)));
    }
    if (sup.spellsKnown?.length) { this._spellsKnown = sup.spellsKnown; got.push("spells known"); }
    if (sup.extraTables?.length) {
      for (const t of sup.extraTables) {
        const i = this._extraTables.findIndex((e) => e.name.toLowerCase() === t.name.toLowerCase());
        if (i >= 0) this._extraTables[i] = t; else this._extraTables.push(t);
      }
      got.push(`${sup.extraTables.length} extra table(s)`);
    }
    if (got.length) ui.notifications?.info(`Captured: ${got.join(", ")}.`);
    this.render();
  }

  /** The authoritative class name: the editable field, else the unlock seed. */
  _effectiveName() {
    return (this._bodyName || this._seedClassName || "").trim();
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  _onParseBody() {
    // Drive the class name from the name field / unlock seed — NOT the paste's
    // first line (a PDF copy often starts with the flavor). Prepend the name so
    // the parser reads it as the heading and keeps the flavor as the flavor.
    const name = this._effectiveName();
    let body = this._bodyText;
    if (name) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = body.replace(new RegExp(`^\\s*${esc}(\\s+class)?\\s*\\r?\\n`, "i"), "");   // drop a duplicate name line
      body = `${name}\n${body}`;
    }
    const parsed = parseClassSection(body);
    if (!parsed) { ui.notifications?.warn("Couldn't read a class from that paste — it needs a Hit Points line."); return; }
    this._bodyParsed = parsed;
    // Roll tables embedded in the body — talent table, titles, spells known,
    // extra tables (e.g. pulled in by Grab-text) — flow into stage 2 so Create
    // imports them WITH the class. createClassUnit runs bodyOnly, then attaches
    // these stage-2 fields; without seeding them here the body creates alone and
    // the embedded tables are dropped. Only overwrite per-table when the body
    // actually carries it, so a separately-attached table survives.
    if (parsed.talentTable) this._talentTable = parsed.talentTable;
    if (parsed.titles?.length) {
      this._titles = parsed.titles;
      // Per-band title parse warnings (e.g. a multi-word title that couldn't be
      // split into Lawful/Chaotic/Neutral) — surfaced as review flags on the band.
      this._titleWarnings = (parsed.warnings ?? []).filter((w) => /couldn'?t split|titles?\s+row/i.test(w));
    }
    if (parsed.spellsKnown?.length) this._spellsKnown = parsed.spellsKnown;
    if (parsed.extraTables?.length) this._extraTables = parsed.extraTables;
    this._bodyName = parsed.name;   // reflect the resolved name back into the field
    this._editingBody = false;
    this.render();
  }

  async _onCreateBody() {
    if (!this._bodyParsed) return this._onParseBody();
    const { createClassUnit } = await import("./class-unit-importer.mjs");
    const source = this._source.trim();
    const sourceTitle = _sourceTitle(source);
    const rep = await createClassUnit(this._bodyParsed, {
      source, sourceTitle, overlay: overlayFor(this._bodyParsed.name), bodyOnly: true,
    });
    if (!rep) return;
    this._classUuid = rep.classUuid;
    this._className = this._bodyParsed.name;
    this._isCaster = !!this._bodyParsed.spellcasting;
    this._editingBody = false;
    this._lastReport = { created: rep.created.length, updated: (rep.updated ?? []).length, reused: rep.reused.length };
    // One click imports everything: attach any roll tables / titles already entered.
    const hadTables = this._hasStage2();
    if (hadTables) await this._attach();
    this._updateImported();
    // Tell any open Character Builder / Importer Hub to drop caches + re-render so
    // the class flips from gap→have without a close/reopen (issue #1).
    Hooks.callAll(`${MODULE_ID}.contentUnlocked`);
    ui.notifications?.info(`Class "${this._className}" ${rep.updated?.length ? "updated" : "created"}${hadTables ? " with its roll tables" : " — add its roll tables below, then Attach"}.`);
    this.render();
  }

  _onEditBody() {
    this._editingBody = true;
    this.render();
  }

  _onTitleAdd() {
    const last = this._titles[this._titles.length - 1];
    const from = last ? last.to + 1 : 1;
    this._titles.push({ from, to: from + 1, lawful: "", chaotic: "", neutral: "" });
    this.render();
  }

  _onTitleDel(event, target) {
    const idx = Number(target.closest("[data-ci-title]")?.dataset.ciTitle);
    if (idx >= 0) { this._titles.splice(idx, 1); this.render(); }
  }
  _onTalentAdd() {
    if (!this._talentTable) this._talentTable = { formula: "2d6", rows: [], replacement: true };
    const last = this._talentTable.rows[this._talentTable.rows.length - 1];
    const lo = last ? last.hi + 1 : 1;
    this._talentTable.rows.push({ lo, hi: lo, text: "", kind: "single" });
    this.render();
  }
  _onTalentDel(event, target) {
    const idx = Number(target.closest("[data-ci-talent]")?.dataset.ciTalent);
    if (this._talentTable && idx >= 0) { this._talentTable.rows.splice(idx, 1); this.render(); }
  }
  // ── Extra tables (e.g. Corruption) — reviewable/editable, hand-buildable ──────
  _onExtraAdd() {
    this._extraTables.push({ name: "New Table", formula: "d10", rows: [{ lo: 1, hi: 1, text: "" }] });
    this.render();
  }
  _onExtraDelTable(event, target) {
    const ti = Number(target.closest("[data-ci-extra]")?.dataset.ciExtra);
    if (ti >= 0) { this._extraTables.splice(ti, 1); this.render(); }
  }
  _onExtraRowAdd(event, target) {
    const t = this._extraTables[Number(target.closest("[data-ci-extra]")?.dataset.ciExtra)];
    if (!t) return;
    const last = t.rows[t.rows.length - 1];
    const lo = last ? last.hi + 1 : 1;
    t.rows.push({ lo, hi: lo, text: "" });
    this.render();
  }
  _onExtraRowDel(event, target) {
    const t = this._extraTables[Number(target.closest("[data-ci-extra]")?.dataset.ciExtra)];
    const ri = Number(target.closest("[data-ci-erow]")?.dataset.ciErow);
    if (t && ri >= 0) { t.rows.splice(ri, 1); this.render(); }
  }
  // ── Spells known — level × tier grid, reviewable/editable ─────────────────────
  _onSpellsRowAdd() {
    const last = this._spellsKnown[this._spellsKnown.length - 1];
    this._spellsKnown.push({ level: last ? last.level + 1 : 1, tiers: [null, null, null, null, null] });
    this.render();
  }
  _onSpellsRowDel(event, target) {
    const ri = Number(target.closest("[data-ci-sk]")?.dataset.ciSk);
    if (ri >= 0) { this._spellsKnown.splice(ri, 1); this.render(); }
  }

  _onClearPart(event, target) {
    const part = target.dataset.ciPart;
    if (part === "talent") this._talentTable = null;
    else if (part === "spells") this._spellsKnown = [];
    else if (part === "extra") {
      const i = Number(target.dataset.ciIndex);
      if (i >= 0) this._extraTables.splice(i, 1);
    }
    this.render();
  }

  /** Snapshot what's now on the class, for the green "imported" checklist —
   *  called after a successful create/attach (captured == attached at that point). */
  _updateImported() {
    this._imported = this._classUuid ? {
      talentRows: this._talentTable ? this._talentTable.rows.length : 0,
      titles: this._titles.length,
      spells: this._spellsKnown.length,
      extras: this._extraTables.map((t) => t.name),
    } : null;
  }

  /** Attach whatever roll tables are captured to the created class. Returns the
   *  merge report (or null). Shared by Create (one-click import) and Attach. */
  async _attach() {
    if (!this._classUuid || !this._hasStage2()) return null;
    const { mergeClassSupplement } = await import("./class-unit-importer.mjs");
    const source = this._source.trim();
    const sup = {
      talentTable: this._talentTable,
      titles: this._titles,
      spellsKnown: this._spellsKnown,
      extraTables: this._extraTables,
      warnings: [],
    };
    const rep = await mergeClassSupplement(this._classUuid, sup, {
      source, sourceTitle: _sourceTitle(source), overlay: overlayFor(this._className),
    });
    if (rep) {
      this._lastReport = { created: rep.created.length, updated: (rep.updated ?? []).length, reused: rep.reused.length };
      if (rep.warnings.length) {
        console.warn(`${MODULE_ID} | Class Importer — attach notes:\n- ${rep.warnings.join("\n- ")}`);
        ui.notifications?.warn(`Tables attached with ${rep.warnings.length} note(s) — see the console (F12).`);
      }
    }
    return rep;
  }

  async _onAttach() {
    if (!this._classUuid) { ui.notifications?.warn("Create the class body first."); return; }
    if (!this._hasStage2()) { ui.notifications?.warn("Nothing to attach yet — paste a talent table, titles, or another table."); return; }
    const rep = await this._attach();
    if (rep && !rep.warnings.length) ui.notifications?.info(`Roll tables attached to "${this._className}".`);
    this._updateImported();
    Hooks.callAll(`${MODULE_ID}.contentUnlocked`);
    this.render();
  }

  async _onOpenPdf(event, target) {
    const href = target?.dataset?.href;
    if (!href) return;
    const { SourcePdfViewer } = await import("./source-pdf-viewer.mjs");
    SourcePdfViewer.show(href, target.dataset.title || "Source PDF");
  }

  /**
   * Grab-text: pull the class's writeup page straight out of the source PDF into
   * the body box (no drag-selecting), using Foundry's bundled PDF.js. The class
   * NAME comes from the unlock seed / source field — the book's stylized class
   * title isn't in the PDF text layer — so this only fills the body (flavor,
   * weapons/armor, hit points, features, talent table).
   */
  async _onGrabPdf() {
    const name = this._className || this._bodyName || this._seedClassName || "";
    const srcKey = this._sourceKey();
    const page = overlayFor(name)?.pages;
    const { sourcePdfTarget } = await import("./source-pdf-registry.mjs");
    const target = (srcKey && page) ? sourcePdfTarget(srcKey, page) : null;
    if (!target) {
      ui.notifications?.warn("No source PDF / writeup page for this class — set the source above, or add the PDF in the hub's Source PDFs manager.");
      return;
    }
    const { extractPdfText, parsePageRange } = await import("./pdf-text-extract.mjs");
    // Grab the FULL overlay page range, not just the first — many writeups spill
    // an extra table onto the next page (e.g. the Wyrdling Corruption d10 table on
    // p73). Apply the same printed→PDF offset the first page got.
    const printed = parsePageRange(page, 0);
    const offset = target.page - (printed[0] ?? target.page);
    const pdfPages = (printed.length ? printed : [Number(page)]).map((n) => n + offset);
    let writeupText;
    try {
      writeupText = (await extractPdfText(target.file, { pages: pdfPages, columns: "auto" })).text;
    } catch (err) {
      console.error("Shadowdark Enhancer | class PDF grab failed", err);
      ui.notifications?.error("Couldn't read text from that PDF page — see the console.");
      return;
    }
    if (!writeupText) { ui.notifications?.warn(`Page ${target.page} has no selectable text.`); return; }

    // Also pull the TITLES appendix — a separate page holding several classes'
    // title tables. Forced single-column: the 4-column Level/Lawful/Chaotic/
    // Neutral layout is wide and auto/two-column detection mangles it. Sliced to
    // this class and appended, so one Preview parses the writeup, the talent
    // table, AND the titles together.
    let titlesText = "";
    const titlesTarget = srcKey ? sourcePdfTarget(srcKey, titlePageFor(name)) : null;
    if (titlesTarget) {
      try {
        const raw = (await extractPdfText(titlesTarget.file, { pages: [titlesTarget.page], columns: "1" })).text;
        titlesText = sliceClassTitles(raw, name) ?? "";
      } catch (err) {
        console.warn("Shadowdark Enhancer | titles grab failed", err);
      }
    }

    // A caster class's SPELLS KNOWN grid sits on the page after the writeup,
    // where auto (two-column) extraction shears the tier numbers off their
    // levels. Grab the writeup range plus the next page single-column and slice
    // out just the grid block, so _findSpellsKnown reads it on parse.
    let spellsText = "";
    try {
      const skPages = [...pdfPages, pdfPages[pdfPages.length - 1] + 1];
      const raw = (await extractPdfText(target.file, { pages: skPages, columns: "1" })).text;
      spellsText = sliceSpellsKnown(raw) ?? "";
    } catch (err) {
      console.warn("Shadowdark Enhancer | spells-known grab failed", err);
    }

    const grabbed = [writeupText, titlesText, spellsText].filter(Boolean).join("\n");
    const base = (this._bodyText || "").replace(/\s*$/, "");
    this._bodyText = base ? `${base}\n${grabbed}\n` : `${grabbed}\n`;
    this._editingBody = true;
    this.render();   // show the grabbed text even if the parse below can't read it
    // Parse right away so the body preview, talent table, AND titles all fill on
    // Import — no separate Preview click. _onParseBody reads _bodyText, populates
    // the stage-2 tables, and re-renders (or warns and leaves the box shown).
    this._onParseBody();
    const titleNote = titlesText ? " + titles" : "";
    ui.notifications?.info(`Pulled and parsed the writeup${titleNote} (p.${target.page}) — review the class, talent table${titlesText ? ", and titles" : ""} below.`);
  }

  /** Clear the whole workspace (no render). Shared by "Start over" and the hub's
   *  per-unlock seed path, so unlocking a second class never attaches its tables
   *  to the previously-imported class. (review 2026-07-12 #2) */
  _reset() {
    this._seedClassName = ""; this._bodyName = "";
    this._bodyText = ""; this._bodyParsed = null; this._editingBody = false;
    this._classUuid = null; this._className = ""; this._isCaster = false;
    this._talentTable = null; this._titles = []; this._titleWarnings = []; this._spellsKnown = []; this._extraTables = [];
    this._lastReport = null; this._imported = null;
  }
  _onStartOver() {
    this._reset();
    this.render();
  }
}

/**
 * Slice one class's "<NAME> TITLES" block out of a titles-appendix page that
 * holds several classes' title tables. Runs from the class's heading to the next
 * "… TITLES" heading (or end). Returns null when the class heading isn't found.
 */
function sliceClassTitles(text, className) {
  const lines = String(text ?? "").split("\n");
  const norm = (s) => s.toUpperCase().replace(/\s+/g, " ").trim();
  const want = `${norm(className)} TITLES`;
  const start = lines.findIndex((l) => norm(l) === want);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/\bTITLES$/i.test(lines[i].trim()) && norm(lines[i]) !== want) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

/** Map a free-text source label to its char-builder source slug (mirrors the hub). */
function _sourceTitle(source) {
  return ({
    "cursed scroll 4": "cursed-scroll-4", "cursed scroll 5": "cursed-scroll-5", "cursed scroll 6": "cursed-scroll-6",
    "cs4": "cursed-scroll-4", "cs5": "cursed-scroll-5", "cs6": "cursed-scroll-6",
    "western reaches": "western-reaches",
  })[source.toLowerCase()] ?? source.toLowerCase().replace(/\s+/g, "-");
}
