/**
 * Importer Hub — paste box, type selector, parse dispatch, preview wiring
 *
 * Everything between pasting text and having editable per-type preview drafts.
 * Split out of importer-hub-app.mjs (2026-07); methods are moved VERBATIM and
 * installed onto ImporterHubApp.prototype by installHubPaste(cls) — `this` is
 * always the live hub app instance. The import of ImporterHubApp is circular
 * with the shell on purpose and only dereferenced at runtime inside method
 * bodies (never at module top level).
 */

import { TableImporter, parseTables, parseGenerators } from "./tables/table-importer.mjs";
import { LootLinker } from "../loot/loot-linker.mjs";
import { CUSTOM_ID } from "./tables/table-categories.mjs";
import { columnManifestId } from "./tables/table-manifest.mjs";
import { segmentDump } from "./dump-segmenter.mjs";
import { parseStatblock, splitStatblocks } from "./monsters/statblock-parser.mjs";
import { itemRecognizer } from "./items/item-parser.mjs";
import { parseGear } from "./items/gear-parser.mjs";
import { resolveGearPropertiesAll } from "./items/item-importer.mjs";
import { spellRecognizer } from "./spells/spell-parser.mjs";
import { parseCharContent, expandNamePartTables, normalizeTwoColumnRanges, CHAR_SOURCES, sourcedTableName } from "./char-content/char-content-manifest.mjs";
import { revalidateTalentBandWarnings } from "./char-content/class-parser.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { installMethods } from "./importer-hub-shared.mjs";
import { ImporterHubApp } from "./importer-hub-app.mjs";

class HubPasteMethods {

  // ── Import-tab wiring helpers ─────────────────────────────────────────────

  /** Import-type selector + item-subtype override. */
  _wireHubType() {
    const typeSel = this.element.querySelector("select[data-import-type]");
    if (typeSel) typeSel.addEventListener("change", (ev) => {
      const v = ev.target.value;
      // "Spells…" / "Classes…" are guided workspaces, not inline parse types —
      // open the app and snap the dropdown back to the real current type.
      if (v === "__spells")  { ev.target.value = this._importType; this._onOpenSpellImporter(); return; }
      if (v === "__classes") { ev.target.value = this._importType; this._onOpenClassImporter(); return; }
      this._importType = v;
      this.render();
    });

    const subSel = this.element.querySelector("select[data-import-subtype]");
    if (subSel) subSel.addEventListener("change", (ev) => {
      this._importItemSubtype = ev.target.value;
      // Re-type any already-parsed items immediately.
      if (this._importItemSubtype !== "auto") {
        for (const it of this._importItems) it.draft.type = this._importItemSubtype;
      }
      this.render();
    });

    // Dice spec for generators — stash on input; consumed at Parse (no re-render).
    const specInput = this.element.querySelector("input[data-gen-spec]");
    if (specInput) specInput.addEventListener("input", (ev) => { this._importGenSpec = ev.target.value; });
  }

  /** Paste box: debounced stash + cursor preservation. */
  _wireHubPaste() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (!ta) return;
    if (this._importTextFocused) {
      ta.focus();
      const pos = this._importTextCursor ?? ta.value.length;
      try { ta.setSelectionRange(pos, pos); } catch (_) {}
    }
    let t = null;
    ta.addEventListener("input", (ev) => {
      this._importTextFocused = true;
      this._importTextCursor = ev.target.selectionStart;
      clearTimeout(t);
      t = setTimeout(() => { this._importText = ev.target.value; }, 200);
    });
    ta.addEventListener("blur", () => { this._importTextFocused = false; this._importText = ta.value; });
  }

  /** Source label input: free-text, commit on input. */
  _wireHubSource() {
    // Source is a <select> now (was a free-text input); listen for both so a
    // legacy input still works.
    const el = this.element.querySelector("[data-import-source]");
    if (!el) return;
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, (ev) => { this._importSource = ev.target.value; });
  }

  /**
   * Monster grid field edits. Commit in place WITHOUT re-render so focus is
   * preserved. Clears warn highlight on the edited field. Mirrors
   * MonsterImporterApp._wireFieldEdits exactly, reading from _importMonsters.
   */
  _wireHubMonsterFieldEdits() {
    this.element.querySelectorAll("[data-mimport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const mEl = ev.target.closest("[data-monster-idx]");
        if (!mEl) return;
        const card = this._importMonsters[Number(mEl.dataset.monsterIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.mimportField;
        const aEl = ev.target.closest("[data-attack-idx]");
        const fEl = ev.target.closest("[data-feature-idx]");
        if (aEl) {
          const a = draft.actions[Number(aEl.dataset.attackIdx)];
          if (a) this._setDraftAttackField(a, field, ev.target);
        } else if (fEl) {
          const ft = draft.features[Number(fEl.dataset.featureIdx)];
          if (ft) {
            if (field === "fName") ft.name = ev.target.value;
            else if (field === "fDesc") ft.description = ev.target.value;
          }
        } else {
          this._setDraftScalarField(draft, field, ev.target);
        }
        ev.target.classList.remove("sde-mimport-warn");
      });
    });
  }

  /**
   * Class-unit talent-row edits. Range/effect/option text commit on `change`
   * with NO re-render (focus stays put); structural changes (add/remove
   * option or row, split/merge) are data-action buttons that re-render.
   * Edits mutate draft.classUnit directly — the commit path reads it as-is.
   */
  _wireHubClassRowEdits() {
    const splitNames = (s) => s.split(/\s*(?:,|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean);
    const parseRange = (v) => {
      const m = v.trim().match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
      if (!m) return null;
      let lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
      if (hi < lo) [lo, hi] = [hi, lo];
      return { lo, hi };
    };
    this.element.querySelectorAll(".sde-class-preview [data-cu-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const field = ev.target.dataset.cuField;
        const v = ev.target.value;

        // ── Titles row scope — works for a classUnit (stage 1) AND a
        // classSupplement (stage 2), so titles are editable in the tables stage. ──
        const titleEl = ev.target.closest("[data-cu-title]");
        if (titleEl) {
          const titles = this._cuTitlesFor(ev.target);
          const band = titles?.[Number(titleEl.dataset.cuTitle)];
          if (!band) return;
          if (field === "titleRange") {
            const r = parseRange(v);
            if (!r) { ev.target.value = band.from === band.to ? String(band.from) : `${band.from}-${band.to}`; return; }
            band.from = r.lo; band.to = r.hi;
            ev.target.value = r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`;
          }
          else if (field === "titleLawful") band.lawful = v.trim();
          else if (field === "titleChaotic") band.chaotic = v.trim();
          else if (field === "titleNeutral") band.neutral = v.trim();
          return;
        }

        const unit = this._importChar[Number(ev.target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
        if (!unit) return;

        // ── Talent-table row scope ──
        const rowEl = ev.target.closest("[data-cu-row]");
        if (rowEl) {
          const row = unit.talentTable?.rows[Number(rowEl.dataset.cuRow)];
          if (!row) return;
          if (field === "range") {
            const r = parseRange(v);
            if (!r) { ev.target.value = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`; return; }
            row.lo = r.lo; row.hi = r.hi;
            ev.target.value = r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`;
            this._refreshTalentWarnings(unit);   // bands may now tile — clear stale gate blockers
          } else if (field === "text") {
            row.text = v.trim();
          } else if (field === "option") {
            const oIdx = Number(ev.target.closest("[data-cu-opt]")?.dataset.cuOpt);
            if (Array.isArray(row.options) && row.options[oIdx] !== undefined) row.options[oIdx] = v.trim();
          }
          return;
        }

        // ── Feature row scope ──
        const featEl = ev.target.closest("[data-cu-feat]");
        if (featEl) {
          const f = unit.features[Number(featEl.dataset.cuFeat)];
          if (!f) return;
          if (field === "featName") f.name = v.trim();
          else if (field === "featText") f.description = v.trim() ? `<p>${v.trim()}</p>` : "";
          return;
        }

        // ── Unit-level fields ──
        if (field === "hp") {
          const m = v.trim().match(/^(?:1)?(d\d+)$/i);
          if (!m) { ev.target.value = unit.hitPoints; return; }
          unit.hitPoints = m[1].toLowerCase();
          ev.target.value = unit.hitPoints;
        } else if (field === "flavor") {
          unit.flavor = v.trim() ? `<p>${v.trim()}</p>` : "";
        } else if (field === "weapons") {
          unit.weaponsText = v.trim();
          unit.weaponNames = splitNames(v);
        } else if (field === "armor") {
          unit.armorText = v.trim();
          unit.armorNames = splitNames(v);
        } else if (["allWeapons", "allMeleeWeapons", "allRangedWeapons", "allArmor"].includes(field)) {
          // Flags and named lists COEXIST ("All melee weapons, crossbow") —
          // toggling a flag never touches the names.
          unit[field] = ev.target.checked;
        } else if (field === "tblFormula") {
          const m = v.trim().match(/^\d*d\d+$/i);
          if (!m || !unit.talentTable) { ev.target.value = unit.talentTable?.formula ?? "2d6"; return; }
          unit.talentTable.formula = v.trim().toLowerCase();
          this._refreshTalentWarnings(unit);   // die changed — re-check band tiling
        } else if (field === "langFixed") {
          unit.languages.fixed = splitNames(v);
        } else if (field === "langCommon") {
          unit.languages.common = Math.max(0, Number(v) || 0);
        } else if (field === "langRare") {
          unit.languages.rare = Math.max(0, Number(v) || 0);
        } else if (field === "scAbility") {
          unit.spellcasting = v
            ? { ability: v, text: unit.spellcasting?.text ?? "",
                spellList: unit.spellcasting?.spellList ?? null,
                spellClass: unit.spellcasting?.spellClass ?? null }
            : null;
          this.render();   // caster chip style + Spellcasting block visibility
        } else if (field === "spellList") {
          if (unit.spellcasting)
            unit.spellcasting.spellClass = (this._casterChoices ?? []).find((c) => c.uuid === v) ?? null;
        } else if (field === "scText") {
          if (unit.spellcasting) unit.spellcasting.text = v.trim() ? `<p>${v.trim()}</p>` : "";
        }
      });
    });

    // Stage-2 supplement: the "attach to class" picker stores the target on
    // the draft; the commit routes it through mergeClassSupplement.
    this.element.querySelectorAll("[data-supplement-attach]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const p = this._importChar[Number(ev.target.closest("[data-char-idx]")?.dataset.charIdx)];
        if (p?.draft?.classSupplement) p.draft.attachTo = ev.target.value || null;
      });
    });
  }

  /**
   * Caster classes a new class can borrow a spell list from (Knight of
   * St. Ydris → Witch pattern). System classes + suite-pack classes with a
   * casting ability. Cached per hub instance; parse drops the cache.
   */
  async _casterClassChoices() {
    if (this._casterChoices) return this._casterChoices;
    const out = [];
    const scan = async (pack) => {
      if (!pack) return;
      try {
        const idx = await pack.getIndex({ fields: ["type", "system.spellcasting.ability"] });
        for (const e of idx) {
          if (e.type !== "Class" || !e.system?.spellcasting?.ability) continue;
          out.push({ uuid: `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, slug: e.name.slugify() });
        }
      } catch (err) { console.warn(`${MODULE_ID} | caster-class scan failed for ${pack?.collection}:`, err); }
    };
    await scan(game.packs.get("shadowdark.classes"));
    const { findSuitePack } = await import("../shared/compendium-suite.mjs");
    await scan(findSuitePack("sde-items"));
    this._casterChoices = out;
    return out;
  }

  /**
   * Editable SDE Class items a stage-2 supplement (titles / talent table /
   * spells-known) can attach to: world.classes + legacy sde-items copies.
   * System classes are excluded (locked, not editable). Cached per hub;
   * dropped after a char commit so a class imported this session appears.
   */
  async _attachClassChoices() {
    if (this._attachChoices) return this._attachChoices;
    const out = [];
    const scan = async (pack) => {
      if (!pack) return;
      try {
        const idx = await pack.getIndex({ fields: ["type"] });
        for (const e of idx)
          if (e.type === "Class") out.push({ uuid: `Compendium.${pack.collection}.Item.${e._id}`, name: e.name });
      } catch (err) { console.warn(`${MODULE_ID} | attach-class scan failed for ${pack?.collection}:`, err); }
    };
    const { findSuitePack } = await import("../shared/compendium-suite.mjs");
    await scan(findSuitePack("classes"));
    await scan(findSuitePack("sde-items"));
    out.sort((a, b) => a.name.localeCompare(b.name));
    this._attachChoices = out;
    return out;
  }

  /**
   * Re-derive a classUnit's talent-band warnings from its LIVE rows after a
   * manual edit, so the quality gate stops blocking on parse-time band issues
   * (don't-tile / column-copy shift / stray) the user has already fixed by hand.
   */
  _refreshTalentWarnings(unit) {
    if (unit) unit.warnings = revalidateTalentBandWarnings(unit.talentTable, unit.warnings);
  }

  /** Resolve the classUnit talent row a click/change happened in. */
  _cuRowFor(target) {
    const unit = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
    const rows = unit?.talentTable?.rows ?? null;
    const rowEl = target.closest("[data-cu-row]");
    const row = rows?.[Number(rowEl?.dataset.cuRow)] ?? null;
    return { unit, rows, row, rowIdx: rowEl ? Number(rowEl.dataset.cuRow) : -1 };
  }

  /** Add a blank option to a choice row (structural → re-render). */
  _onCuOptAdd(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    row.kind = "choice";
    (row.options ??= []).push("");
    this.render();
  }

  /** Remove one option; below 2 options the row folds back to single. */
  _onCuOptDel(event, target) {
    const { row } = this._cuRowFor(target);
    const oIdx = Number(target.closest("[data-cu-opt]")?.dataset.cuOpt);
    if (!row || !Array.isArray(row.options)) return;
    row.options.splice(oIdx, 1);
    if (row.options.length < 2) { row.kind = "single"; delete row.options; }
    this.render();
  }

  /** Single → choice: seed options by splitting the text on " or ". */
  _onCuRowSplit(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    const parts = row.text.split(/\s+or\s+/i).map((p) => p.trim().replace(/[.]$/, "")).filter(Boolean);
    row.kind = "choice";
    row.options = parts.length >= 2 ? parts : [row.text, ""];
    this.render();
  }

  /** Choice → single: the row commits as one talent named by its text. */
  _onCuRowMerge(event, target) {
    const { row } = this._cuRowFor(target);
    if (!row) return;
    row.kind = "single";
    delete row.options;
    this.render();
  }

  /** Delete a talent row. */
  _onCuRowDel(event, target) {
    const { unit, rows, rowIdx } = this._cuRowFor(target);
    if (!rows || rowIdx < 0) return;
    rows.splice(rowIdx, 1);
    this._refreshTalentWarnings(unit);
    this.render();
  }

  /** Append a blank single row — bootstraps a 2d6 table when none parsed. */
  _onCuRowAdd(event, target) {
    const unit = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit;
    if (!unit) return;
    unit.talentTable ??= { formula: "2d6", rows: [] };
    const rows = unit.talentTable.rows;
    const next = rows.length ? Math.max(...rows.map((r) => r.hi)) + 1 : 2;
    rows.push({ lo: next, hi: next, text: "", kind: "single" });
    this._refreshTalentWarnings(unit);
    this.render();
  }

  /** Resolve the classUnit a structural button belongs to. */
  _cuUnitFor(target) {
    return this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft.classUnit ?? null;
  }

  /** The titles array a title editor belongs to — a classUnit (stage 1) or a
   *  classSupplement (stage 2). Creates the array so "add band" works on a
   *  supplement that parsed no titles (manual entry). */
  _cuTitlesFor(target) {
    const draft = this._importChar[Number(target.closest("[data-char-idx]")?.dataset.charIdx)]?.draft;
    if (!draft) return null;
    if (draft.classUnit) return (draft.classUnit.titles ??= []);
    if (draft.classSupplement) return (draft.classSupplement.titles ??= []);
    return null;
  }

  /** Add a blank class feature. */
  _onCuFeatAdd(event, target) {
    const unit = this._cuUnitFor(target);
    if (!unit) return;
    unit.features.push({ name: "", description: "" });
    this.render();
  }

  /** Remove a class feature. */
  _onCuFeatDel(event, target) {
    const unit = this._cuUnitFor(target);
    const idx = Number(target.closest("[data-cu-feat]")?.dataset.cuFeat);
    if (!unit || !(idx >= 0)) return;
    unit.features.splice(idx, 1);
    this.render();
  }

  /** Add a title band after the current last level range. */
  _onCuTitleAdd(event, target) {
    const titles = this._cuTitlesFor(target);
    if (!titles) return;
    const last = titles[titles.length - 1];
    const from = last ? last.to + 1 : 1;
    titles.push({ from, to: from + 1, lawful: "", chaotic: "", neutral: "" });
    this.render();
  }

  /** Remove a title band. */
  _onCuTitleDel(event, target) {
    const titles = this._cuTitlesFor(target);
    const idx = Number(target.closest("[data-cu-title]")?.dataset.cuTitle);
    if (!titles || !(idx >= 0)) return;
    titles.splice(idx, 1);
    this.render();
  }

  /**
   * Table preview field edits. Commit on `change`, no re-render, matching
   * RollTablesApp._onRender's import-tab wiring. The category select re-renders
   * (needed to show/hide customLabel input) — that is the one exception.
   */
  _wireHubTableFieldEdits() {
    this.element.querySelectorAll(".sde-import-table [data-import-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const tIdx = Number(ev.target.closest("[data-table-idx]")?.dataset.tableIdx);
        const tbl = this._importTables[tIdx];
        if (!tbl) return;
        const field = ev.target.dataset.importField;
        const rowEl = ev.target.closest("[data-row-idx]");
        if (rowEl) {
          const rIdx = Number(rowEl.dataset.rowIdx);
          const row = tbl.rows[rIdx];
          if (!row) return;
          if (field === "min" || field === "max") row[field] = Number(ev.target.value);
          else if (field === "text") row.text = ev.target.value;
        } else {
          if (field === "name") tbl.name = ev.target.value;
          else if (field === "formula") tbl.formula = ev.target.value;
          else if (field === "replacement") tbl.replacement = ev.target.checked;
          else if (field === "category") {
            // "custom:<Folder>" options = reuse an existing custom pack folder.
            const v = ev.target.value;
            if (v.startsWith("custom:")) { tbl.category = CUSTOM_ID; tbl.customLabel = v.slice(7); }
            else tbl.category = v;
            this.render();
          }
          else if (field === "customLabel") tbl.customLabel = ev.target.value;
        }
      });
    });
  }

  /**
   * Compound-generator preview edits. Cell/label/name/separator edits commit in
   * place with NO re-render (focus stays put); only a formula change re-renders,
   * since it changes how many face-rows the grid shows.
   */
  _wireHubGeneratorFieldEdits() {
    this.element.querySelectorAll(".sde-import-gen [data-gen-field]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const g = this._importGenerators[Number(ev.target.closest("[data-gen-idx]")?.dataset.genIdx)];
        if (!g) return;
        const cols = g.compound?.columns ?? g.columns ?? [];
        const field = ev.target.dataset.genField;
        if (field === "name") { g.name = ev.target.value; }
        else if (field === "formula") {
          g.formula = ev.target.value;
          for (const c of cols) c.formula = ev.target.value;
          this.render(); // face count may change
        }
        else if (field === "separator") {
          const v = ev.target.value;
          g.separator = v;
          if (g.compound) g.compound.separator = v;
        }
        else if (field === "label") {
          const ci = Number(ev.target.dataset.colIdx);
          if (cols[ci]) cols[ci].label = ev.target.value;
        }
        else if (field === "cell") {
          const ci = Number(ev.target.dataset.colIdx);
          const face = Number(ev.target.dataset.face);
          const col = cols[ci];
          if (!col) return;
          let row = (col.rows ?? []).find(r => face >= r.min && face <= r.max);
          if (!row) { row = { min: face, max: face, text: "" }; (col.rows ??= []).push(row); col.rows.sort((a, b) => a.min - b.min); }
          row.text = ev.target.value;
        }
      });
    });
  }

  /**
   * Item grid field edits. Commit in place WITHOUT re-render so focus is
   * preserved. Mirrors _wireHubMonsterFieldEdits commit-in-place pattern.
   */
  _wireHubItemFieldEdits() {
    this.element.querySelectorAll("[data-iimport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const rowEl = ev.target.closest("[data-item-idx]");
        if (!rowEl) return;
        const card = this._importItems[Number(rowEl.dataset.itemIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.iimportField;
        const v = ev.target.value;
        switch (field) {
          case "name":        draft.name = v; break;
          case "type":        draft.type = v; break;
          case "costGp":      draft.cost.gp = Number(v); break;
          case "costSp":      draft.cost.sp = Number(v); break;
          case "costCp":      draft.cost.cp = Number(v); break;
          case "slots":       draft.slots.slots_used = Number(v); break;
          case "description": draft.description = ImporterHubApp._wrapEditedHtml(v); break;
        }
      });
    });
  }

  /** Spell preview field edits — commit in place, no re-render (keeps focus). */
  _wireHubSpellFieldEdits() {
    this.element.querySelectorAll("[data-simport-field]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const rowEl = ev.target.closest("[data-spell-idx]");
        if (!rowEl) return;
        const card = this._importSpells[Number(rowEl.dataset.spellIdx)];
        if (!card) return;
        const draft = card.draft;
        const field = ev.target.dataset.simportField;
        const v = ev.target.value;
        switch (field) {
          case "name":          draft.name = v; break;
          case "tier":          draft.tier = Number(v); break;
          case "className":     draft.className = v; break;
          case "range":         draft.range = v; break;
          case "durationType":  draft.duration = { ...draft.duration, type: v }; break;
          case "durationValue": draft.duration = { ...draft.duration, value: String(v) }; break;
          case "description": {
            const trimmed = v.trim();
            draft.description = trimmed.startsWith("<") ? trimmed : (trimmed ? `<p>${trimmed}</p>` : "<p></p>");
            break;
          }
        }
      });
    });
  }

  _setDraftScalarField(draft, field, el) {
    const v = el.value;
    switch (field) {
      case "name": draft.name = v; break;
      case "level": draft.level = Number(v); break;
      case "ac": draft.ac = Number(v); break;
      case "hpValue": draft.hp.value = Number(v); break;
      case "hpMax": draft.hp.max = Number(v); break;
      case "alignment": draft.alignment = v; break;
      case "move": draft.move = v; break;
      case "moveNote": draft.moveNote = v; break;
      case "str": case "dex": case "con": case "int": case "wis": case "cha":
        draft.abilities[field] = Number(v); break;
      case "scAbility": draft.spellcasting.ability = v; break;
      case "scBonus": draft.spellcasting.bonus = Number(v); break;
      case "scAttacks": draft.spellcasting.attacks = Number(v); break;
    }
  }

  _setDraftAttackField(a, field, el) {
    const v = el.value;
    switch (field) {
      case "aNum": a.num = Number(v); break;
      case "aName": a.name = v; break;
      case "aType": a.type = v; break;
      case "aBonus": a.bonus = Number(v); break;
      case "aDamage": a.damage = v; break;
      case "aRanges": a.ranges = v.split(/[,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean); break;
      case "aDesc": a.description = v; break;
    }
  }

  // ── Import-tab parse/clear actions ────────────────────────────────────────

  /**
   * "Compound" shortcut: parse the current paste as a roll-all generator without
   * changing the type dropdown first. Prompts for the dice spec (e.g. 3d6 = 3
   * columns each on a d6), then forces the generators type + spec and parses.
   */
  async _onHubParseCompound() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    if (!this._importText.trim()) { ui.notifications.warn("Paste a table first, then click Compound."); return; }

    const spec = await foundry.applications.api.DialogV2.wait({
      window: { title: "Compound Generator", icon: "fas fa-dice-d6" },
      content: `
        <p>Roll <strong>every column once</strong> and combine the results in order
        (result 1 + result 2 + … = final).</p>
        <p style="display:flex;align-items:center;gap:0.5rem;">
          <label for="sde-compound-spec"><strong>Dice</strong></label>
          <input id="sde-compound-spec" name="spec" type="text" value="3d6" placeholder="e.g. 3d6 or 2d10" style="flex:1;">
        </p>
        <p class="notes"><code>3d6</code> = 3 columns, each rolled on a d6 (6 rows). Leave blank to auto-detect from the paste.</p>`,
      buttons: [
        { action: "parse", label: "Parse as compound", icon: "fas fa-dice-d6", default: true,
          callback: (event, button) => button.form.elements.spec.value },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (spec == null || spec === "cancel") return;

    this._importType = "generators";
    this._importGenSpec = String(spec).trim();
    await this._onHubParse();
  }

  /**
   * Cartesian button: parse the paste as a multi-column generator (same as
   * Compound — roll-each-column, "|" respected), but spell it out into ONE long
   * flat table with every combination instead of the hidden roll-each-column
   * form. Blocks a request over 25000 rows (user pref) with a warning.
   */
  async _onHubParseCartesian() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    if (!this._importText.trim()) { ui.notifications.warn("Paste a table first, then click Cartesian."); return; }

    const spec = await foundry.applications.api.DialogV2.wait({
      window: { title: "Cartesian Table", icon: "fas fa-table-cells" },
      content: `
        <p>Spell out <strong>every combination</strong> of the columns into one long,
        fully-visible table (no hidden roll-each-column logic).</p>
        <p style="display:flex;align-items:center;gap:0.5rem;">
          <label for="sde-cartesian-spec"><strong>Dice</strong></label>
          <input id="sde-cartesian-spec" name="spec" type="text" value="3d6" placeholder="e.g. 3d6 or 2d10" style="flex:1;">
        </p>
        <p class="notes"><code>3d6</code> = 3 columns each with 6 rows → a 216-row table. Insert <code>|</code> between columns in your paste to set the splits yourself. Over 25,000 rows is blocked — use Compound for those.</p>`,
      buttons: [
        { action: "parse", label: "Expand to Cartesian", icon: "fas fa-table-cells", default: true,
          callback: (event, button) => button.form.elements.spec.value },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (spec == null || spec === "cancel") return;

    this._importType = "cartesian";
    this._importGenSpec = String(spec).trim();
    await this._onHubParse();
  }

  /**
   * Parse action: reads the paste box, runs segmentDump, maps monster chunks
   * via parseStatblock, applies the seed to the first table (if any), links
   * loot tables. Then re-renders.
   */
  async _onHubParse() {
    const ta = this.element.querySelector("textarea[data-import-text]");
    if (ta) this._importText = ta.value;
    const text = this._importText;
    const type = this._importType;

    const seed = this._importSeed;

    // Magic base-recipe BUNDLE seed: the grabbed page stacks several child
    // tables (Weapon/Armor Type + Bonus + Feature). Parse the WHOLE page into
    // one draft per section (structural split only — see parseStackedTables),
    // NOT the single-child shape path, then let the exact matchBundleTables /
    // atomic commit path match, validate, and isolate them. Never runs
    // _applyImportSeed (which would rename/stamp only the first table).
    if (this._isMagicBundleSeed()) {
      // Some PDF extractors emit the same page in multiple layout passes, so the
      // grab repeats each section verbatim. Collapse only EXACT-duplicate drafts
      // (identical name/formula/rows) — near-duplicates stay and block as
      // ambiguous.
      const parsedAll = TableImporter.parseStackedTables(text);
      this._importTables = TableImporter.dedupExactTables(parsedAll);
      this._importMonsters = []; this._importItems = []; this._importSpells = [];
      this._importGenerators = []; this._importChar = []; this._importSkipped = [];
      this._shapeFailNote = null;
      const dropped = parsedAll.length - this._importTables.length;
      if (dropped > 0) {
        ui.notifications.info(`Collapsed ${dropped} duplicate table pass${dropped === 1 ? "" : "es"} the PDF grab emitted.`);
      }
      if (!this._importTables.length) {
        ui.notifications.warn("No tables found on the pasted page — check that the whole Core page was grabbed.");
      }
      this.render();
      return;
    }

    // Shape-directed parse: when the thing being unlocked ships a precise
    // structure descriptor (table-shapes.mjs) — a prayer generator, a Carousing
    // lookup — reconstruct it deterministically instead of guessing. Driven by
    // the unlock seed's identity, or a "PRAYER GENERATOR" title in the paste.
    if (type === "auto" || type === "tables" || type === "generators") {
      const { resolveShape, shapeForName } = await import("./tables/table-shapes.mjs");
      // Dispatch by persistent contentId first (collision-free); else resolve
      // the name WITHIN the seed's source, so a same-named table in another book
      // can't borrow this shape; name-only fallback is for freeform seedless
      // pastes (handled by the PRAYER GENERATOR title check below).
      let shape = resolveShape({ contentId: seed?.contentId, name: seed?.name, src: seed?.src });
      if (!shape && /prayer\s+generator/i.test(text)) shape = shapeForName("Gede Prayers");
      if (shape) {
        const bucket = TableImporter.parseByShape(text, shape, { name: seed?.name || "" });
        // A registered shape that does NOT match must never degrade silently
        // into a generic guess (Codex review) — flag the fallback as a blocker
        // so the preview and the commit gate treat it as suspect.
        this._shapeFailNote = bucket ? null
          : `BLOCKER: "${seed?.name ?? "this entry"}" has a registered ${shape.kind} shape that did not match the pasted text — the result below is a generic best-effort parse; verify it against the book before Create.`;
        if (bucket) {
          this._importMonsters = []; this._importItems = []; this._importSpells = [];
          this._importGenerators = bucket.generators ?? [];
          this._importTables = bucket.tables ?? [];
          this._importChar = []; this._importSkipped = [];
          this._applyImportSeed();
          if (!this._importGenerators.length && !this._importTables.length) {
            ui.notifications.warn("Shape parse produced nothing — check the pasted section.");
          }
          this.render();
          return;
        }
      }
    }

    // Shape-directed parse: when the thing being unlocked ships a precise
    // structure descriptor (table-shapes.mjs) — a prayer generator, a Carousing
    // lookup — reconstruct it deterministically instead of guessing. Driven by
    // the unlock seed's identity, or a "PRAYER GENERATOR" title in the paste.
    if (type === "auto" || type === "tables" || type === "generators") {
      const { shapeForName } = await import("./tables/table-shapes.mjs");
      let shape = shapeForName(seed?.name);
      if (!shape && /prayer\s+generator/i.test(text)) shape = shapeForName("Gede Prayers");
      if (shape) {
        const bucket = TableImporter.parseByShape(text, shape, { name: seed?.name || "" });
        if (bucket) {
          this._importMonsters = []; this._importItems = []; this._importSpells = [];
          this._importGenerators = bucket.generators ?? [];
          this._importTables = bucket.tables ?? [];
          this._importChar = []; this._importSkipped = [];
          this._applyImportSeed();
          if (!this._importGenerators.length && !this._importTables.length) {
            ui.notifications.warn("Shape parse produced nothing — check the pasted section.");
          }
          this.render();
          return;
        }
      }
    }

    // Compound generators are an explicit type only (never in a mixed dump):
    // one table rolled once per column, cells combined in order. Parse and
    // return early — the table/char pipeline below doesn't apply.
    if (type === "generators") {
      this._importGenerators = parseGenerators(text, this._importGenSpec);
      this._importMonsters = []; this._importItems = []; this._importSpells = [];
      this._importTables = []; this._importChar = []; this._importSkipped = [];
      if (!this._importGenerators.length) {
        ui.notifications.warn("No compound generator recognized — need a die header (e.g. d6) and 2+ column labels (e.g. Detail 1, Detail 2…).");
      }
      this.render();
      return;
    }

    // Cartesian: same multi-column parse as Compound, but each table is stamped
    // to expand into a flat table at commit. Blocks anything over 25000 rows
    // (user pref) with a warning — those should stay Compound.
    if (type === "cartesian") {
      const CARTESIAN_CAP = 25000;
      const kept = [];
      for (const g of parseGenerators(text, this._importGenSpec)) {
        const cols = g.compound?.columns ?? g.columns ?? [];
        const product = cols.reduce((a, c) =>
          a * Math.max(1, (c.rows ?? []).reduce((m, r) => Math.max(m, r.max), 0)), cols.length ? 1 : 0);
        if (product > CARTESIAN_CAP) {
          ui.notifications.warn(`"${g.name || "table"}" would be ${product.toLocaleString()} rows (over ${CARTESIAN_CAP.toLocaleString()}) — use the Compound button for that one.`);
          continue;
        }
        g.expand = "cartesian";
        kept.push(g);
      }
      this._importGenerators = kept;
      this._importMonsters = []; this._importItems = []; this._importSpells = [];
      this._importTables = []; this._importChar = []; this._importSkipped = [];
      if (!kept.length) {
        ui.notifications.warn("Nothing to expand — need a die header (e.g. d6) and 2+ columns (insert | between them), and ≤ 25,000 total rows.");
      }
      this.render();
      return;
    }

    let monsters = [], items = [], spells = [], tables = [], skipped = [];

    // 2d10 name-part tables (ancestry Names) expand to d100 before anything
    // else sees the text, in both auto and tables modes.
    let nameTables = [];
    let effectiveText = text;
    let rangeNotes = [];
    if (type === "auto" || type === "tables") {
      const expanded = expandNamePartTables(text);
      nameTables = expanded.tables;
      // Two-column d100 spreads (trinkets etc.) fold into one column here.
      const normalized = normalizeTwoColumnRanges(expanded.remainder);
      effectiveText = normalized.text;
      rangeNotes = normalized.notes;
    }

    if (type === "auto") {
      // Sort a mixed dump across every recognizer.
      const seg = segmentDump(effectiveText);
      monsters = seg.monsters.map((chunk) => parseStatblock(chunk));
      items    = seg.items ?? [];
      spells   = seg.spells ?? [];
      tables   = seg.tables ?? [];
      skipped  = [...(seg.skipped ?? [])];
    } else if (type === "monsters") {
      const { monsters: chunks, skipped: sk } = splitStatblocks(text);
      monsters = chunks.map((chunk) => parseStatblock(chunk));
      skipped  = sk ?? [];
    } else if (type === "items") {
      // Weapon/Armor subtype → the dedicated gear parser reads real stat columns
      // (AC / damage / range / properties) instead of the generic recognizer's
      // name+cost+slots shell, then resolves the letter-coded properties to the
      // shadowdark.properties UUIDs the data models store.
      if (this._importItemSubtype === "Weapon" || this._importItemSubtype === "Armor") {
        // Strays the parser refuses to mint ("+", page footers) land in the
        // Skipped review list instead of vanishing.
        const dropped = [];
        items = parseGear(text, this._importItemSubtype,
          { onDrop: (t, reason) => dropped.push({ name: String(t).slice(0, 80), reason }) });
        await resolveGearPropertiesAll(items);
        skipped = dropped;
      } else {
        // A specific item subtype means the GM asserted "these are items" — force
        // every block through the parser (no cost/rider anchor required) so plain
        // items aren't silently dropped to Skipped. Auto keeps the strict gate.
        const force = this._importItemSubtype !== "auto";
        const { claimed, remainder, skipped: itemSkipped } = itemRecognizer.claim(text, { force });
        items   = itemRecognizer.parse(claimed, { force });
        // In force mode the recognizer reports multi-column table dumps it declined
        // (with a helpful reason); Auto mode reports its unclaimed remainder.
        skipped = [...(itemSkipped ?? []), ...(force ? [] : this._leftoverSkipped(remainder))];
      }
    } else if (type === "spells") {
      const { claimed, remainder } = spellRecognizer.claim(text);
      spells  = spellRecognizer.parse(claimed);
      skipped = this._leftoverSkipped(remainder);
    } else if (type === "tables") {
      tables = parseTables(effectiveText);
    }

    // Seeded generic parses sweep the seed line, the printed caption, the
    // "dN Details" header, and page footers in as DATA rows (E2E D4: Arctic
    // Sea rows 1-3). Strip them and re-parse; the note lands on the kept table.
    let seedNoiseNote = null;
    if (this._importSeed?._charSeed && !this._importSeed._bgBundle && (type === "tables" || type === "auto") && tables.length) {
      const { stripSeedNoise } = await import("./tables/table-importer.mjs");
      const res = stripSeedNoise(effectiveText, { name: this._importSeed.name, pages: this._importSeed.page });
      if (res.dropped) {
        const reparsed = parseTables(res.text);
        if (reparsed.length) {
          tables = reparsed;
          seedNoiseNote = `Stripped ${res.dropped} seed/caption/header line(s) before parsing.`;
        }
      }
    }

    // Seeded unlock (one expected table): keep the best-matching table only,
    // stamp the expected name on it, and shunt everything else — OCR junk
    // fragments included — to the Skipped list instead of the preview.
    if (this._importSeed?._charSeed && (type === "tables" || type === "auto") && (nameTables.length || tables.length)) {
      const want = this._importSeed.name;
      let keep;
      if (nameTables.length) {
        keep = nameTables[0];
      } else {
        keep = tables.find((t) => t.name && t.name.toLowerCase() === want.toLowerCase())
          ?? tables.reduce((a, b) => ((b.rows?.length ?? 0) > (a.rows?.length ?? 0) ? b : a));
      }
      // A background bundle's d100 list spans several PDF pages joined by blank
      // lines, so parseTables split it into one table per page and `keep` holds
      // only the first. Rebuild the whole table: drop the bare page-footer rows
      // (74/75/76/77 collide with real faces) and collapse the page gaps so the
      // full list parses as one d100 for the random-background roll.
      if (this._importSeed._bgBundle) {
        const { parsePageRange } = await import("./pdf-text-extract.mjs");
        const footers = new Set(parsePageRange(this._importSeed.page).map(String));
        const merged = this._importText
          .split("\n").filter((l) => !footers.has(l.trim())).join("\n")
          .replace(/\n\s*\n+/g, "\n");
        const full = parseTables(merged).reduce((a, b) => ((b.rows?.length ?? 0) > (a?.rows?.length ?? 0) ? b : a), null);
        if (full && (full.rows?.length ?? 0) > (keep?.rows?.length ?? 0)) keep = full;
      }
      for (const t of [...nameTables, ...tables]) {
        if (t !== keep) skipped.push({ name: t.name || `(untitled ${t.formula ?? ""} table)`, reason: `dropped — this unlock expects only "${want}"` });
      }
      // Convention: imported tables are named "Source - Table Name" (e.g.
      // "Western Reaches - Dwarf Trinket"); ancestry NAME tables instead become
      // "Character Names: Source Ancestry" so the ancestry sheet's Random Name
      // Table dropdown lists them (sourcedTableName). Background-bundle tables
      // already carry a complete, unique name (e.g. "Western Reach Backgrounds")
      // — don't prefix them or it doubles the source and forks a duplicate.
      const srcLabel = CHAR_SOURCES[this._importSeed.src]?.label;
      keep.name = (srcLabel && !this._importSeed._bgBundle) ? sourcedTableName(srcLabel, want) : want;
      if (seedNoiseNote) (keep.warnings ??= []).push(seedNoiseNote);
      if (this._shapeFailNote) { (keep.warnings ??= []).push(this._shapeFailNote); this._shapeFailNote = null; }
      // Category drives the system-mirroring compendium folder.
      if (/\bnames$/i.test(want)) keep.category = "character-names";
      else if (/\btrinkets$/i.test(want)) keep.category = "trinkets";
      nameTables = [];
      tables = [keep];
    }
    tables = [...nameTables, ...tables];
    if (rangeNotes.length && tables.length) (tables[0].warnings ??= []).push(...rangeNotes);

    // Nameless table + a recognizable page caption ("DWARF TRINKET") →
    // adopt the manifest identity. All ancestry tables are WR content.
    if (!this._importSeed?._charSeed) {
      const { identifyAncestryTable, gatherCharContentCensus } = await import("./char-content/char-content-manifest.mjs");
      for (const t of tables) {
        const generic = !t.name || t.name === "Names";   // expander fallback
        if (!generic) continue;
        const id = identifyAncestryTable(text);
        if (id) {
          t.name = sourcedTableName(CHAR_SOURCES.WR.label, id.name);
          t.category = id.category;
          (t.warnings ??= []).push(`Identified from the page caption as "${id.name}" (WR pg ${id.pages}).`);
          continue;
        }
        if (t.category === "character-names") {
          // Names pages all carry the same generic "NAMES" caption. If only
          // one ancestry's names table is still missing, it must be that one;
          // otherwise the GM has to say which ancestry this is.
          const rows = await gatherCharContentCensus().catch(() => []);
          const missing = (rows.find((r) => r.source === "WR")?.missingNames ?? [])
            .filter((m) => m.type === "Table" && /\bnames$/i.test(m.name));
          if (missing.length === 1) {
            t.name = sourcedTableName(CHAR_SOURCES.WR.label, missing[0].name);
            (t.warnings ??= []).push(`Assumed "${missing[0].name}" — the only names table still missing.`);
          } else {
            (t.warnings ??= []).push(
              `Which ancestry? The page caption just says NAMES — edit the table name above (e.g. "Elf Names") before creating. Still missing: ${missing.map((m) => m.name).join(", ")}.`);
          }
        }
      }
    }

    // The source-naming convention applies to unseeded character tables too,
    // using whatever the GM typed in the Source box: NAME tables become
    // "Character Names: Source Ancestry" (dropdown-visible), Trinkets keep the
    // "Source - Name" suffix. Already-named-table entries are left alone.
    const srcPrefix = this._importSource.trim();
    if (!this._importSeed?._charSeed && srcPrefix) {
      for (const t of tables) {
        const nm = t.name ?? "";
        if (/^character names:/i.test(nm)) continue;
        if (/\bnames$/i.test(nm)) t.name = sourcedTableName(srcPrefix, nm);
        else if (/\btrinkets$/i.test(nm) && !nm.toLowerCase().startsWith(srcPrefix.toLowerCase())) {
          t.name = `${srcPrefix} - ${nm}`;
        }
      }
    }

    // Character-content types (Backgrounds / Talents / Class) parse into their
    // own draft list; everything else clears it. A background-table bundle seed
    // additionally parses the individual Background items from the same paste
    // (the table above; the items here) so one commit unlocks both.
    this._importChar = ["backgrounds", "talents", "classes", "classtables", "ancestries"].includes(type)
      ? parseCharContent(text, type)
      : (this._importSeed?._bgBundle ? parseCharContent(text, "backgrounds") : []);

    // Item subtype override (forces all parsed items to the chosen type).
    if (this._importItemSubtype !== "auto") {
      for (const it of items) it.draft.type = this._importItemSubtype;
    }

    // System-compendium de-dup: the WR gear/weapon/armor tables reprint the
    // whole core set, so a Basic Gear import parses ~32 rows of which most
    // already ship in shadowdark.gear/magic-items. Divert every row the system
    // already has to the Skipped list (with the pack named) so the preview
    // shows only content genuinely new to this world.
    if (items.length) {
      const { partitionSystemDuplicates } = await import("./items/item-importer.mjs");
      const { fresh, duplicates } = await partitionSystemDuplicates(items);
      items = fresh;
      if (duplicates.length) skipped = [...skipped, ...duplicates];
    }

    // A seeded item unlock ("Import Ball Bearing") grabs the whole equipment
    // TABLE page range and imports EVERY row (bulk) — the GM commits the full
    // Basic Gear / Weapons table at once, then fills descriptions in a second
    // pass (matched by name). The clicked row is just the entry point.

    this._importMonsters = monsters;
    this._importItems    = items;
    this._importSpells   = spells;
    this._importTables   = tables;
    this._importGenerators = [];
    this._importSkipped  = skipped;

    this._applyImportSeed();
    await this._linkLootTables();

    if (!monsters.length && !items.length && !spells.length && !tables.length && !this._importChar.length) {
      ui.notifications.warn("Nothing recognized — try a different import type or review the Skipped section.");
    }
    this.render();
  }

  /** Turn leftover (unclaimed) text into skipped entries for the review list. */
  _leftoverSkipped(remainder) {
    const out = [];
    for (const block of String(remainder ?? "").split(/\n\s*\n/)) {
      const first = block.split("\n")[0]?.trim();
      if (first) out.push({ name: first, reason: "not recognized as the selected type" });
    }
    return out;
  }

  _onHubClear() {
    this._importText = "";
    this._importMonsters = [];
    this._importItems = [];
    this._importSpells = [];
    this._importTables = [];
    this._importGenerators = [];
    this._importChar = [];
    this._importSkipped = [];
    this._importSeed = null;
    this.render();
  }

  /**
   * Apply the import seed from a Tables-tab per-row Import click.
   * Forces the first parsed table's identity to the manifest entry.
   * Ported directly from RollTablesApp._applyImportSeed.
   */
  _applyImportSeed() {
    const seed = this._importSeed;
    if (!seed || !this._importTables?.length) return;
    // Character-content seeds set their own identity in _onHubParse
    // ("Source - Name" convention + category) — don't clobber it here.
    if (seed._charSeed) return;
    // A magic base-recipe BUNDLE seed carries several separate tables; identity
    // is stamped at commit by the bundle path (_magicBundlePlan →
    // matchBundleTables), so leave the parsed drafts untouched here.
    if (seed.magicSet && Array.isArray(seed.children) && seed.children.length > 1) return;
    const folderPath = [seed.category, seed.folderLabel].filter(Boolean);

    if (seed.grid && Array.isArray(seed.columns) && seed.columns.length) {
      const split = TableImporter.parseMatrixByColumns(this._importText, seed.columns, seed.widths);
      const nRows = Math.max(0, ...split.map(c => c.rows.length));
      const rows = [];
      let n = 1;
      for (let r = 0; r < nRows; r++) {
        for (const c of split) {
          const cell = c.rows[r];
          if (cell) { rows.push({ min: n, max: n, text: cell.text }); n++; }
        }
      }
      if (rows.length) {
        const merged = {
          name: seed.name, formula: `1d${rows.length}`, replacement: true,
          bestEffort: true, warnings: split[0]?.warnings ?? [], rows, manifestId: seed.manifestId ?? null,
        };
        if (folderPath.length) merged.folderPath = folderPath;
        else { merged.category = CUSTOM_ID; merged.customLabel = seed.folderLabel; }
        this._importTables = [merged];
      }
      return;
    }

    if (seed.matrix && Array.isArray(seed.columns) && seed.columns.length) {
      const split = TableImporter.parseMatrixByColumns(this._importText, seed.columns, seed.widths);
      split.forEach((t, i) => {
        t.name = `${seed.name} - ${seed.columns[i]}`;
        if (seed.folderLabel) { t.category = CUSTOM_ID; t.customLabel = seed.folderLabel; }
        if (folderPath.length) t.folderPath = folderPath;
        t.manifestId = columnManifestId(seed.manifestId, seed.columns[i]);
      });
      this._importTables = split;
      return;
    }

    const t0 = this._importTables[0];
    if (seed.name) t0.name = seed.name;
    if (seed.formula) t0.formula = seed.formula;
    if (seed.folderLabel) { t0.category = CUSTOM_ID; t0.customLabel = seed.folderLabel; }
    if (folderPath.length) t0.folderPath = folderPath;
    t0.manifestId = seed.manifestId ?? null;
  }

  /** Link each Loot row's text to a compendium Item. Ported from RollTablesApp. */
  async _linkLootTables() {
    const lootTables = this._importTables.filter(t => t.category === "loot");
    if (!lootTables.length) return;
    const items = await LootLinker.buildItemIndex();
    for (const tbl of lootTables) {
      for (const row of tbl.rows) {
        row.link = LootLinker.findLink(row.text, items);
      }
    }
  }

  // ── Import-tab monster structural actions ────────────────────────────────

  _onMimportRemoveMonster(event, target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    if (!Number.isFinite(idx)) return;
    this._importMonsters.splice(idx, 1);
    this.render();
  }

  _onMimportAddAttack(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Attack", type: "NPC Attack", num: 1, bonus: 0, damage: "1d6", ranges: ["close"], description: "" });
    this.render();
  }

  _onMimportAddSpecial(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.actions.push({ name: "New Special", type: "NPC Special Attack", num: 1, bonus: 0, damage: "", ranges: [], description: "" });
    this.render();
  }

  _onMimportRemoveAttack(event, target) {
    const draft = this._hubMonsterDraft(target);
    const aIdx = Number(target.closest("[data-attack-idx]")?.dataset.attackIdx);
    if (!draft || !Number.isFinite(aIdx)) return;
    draft.actions.splice(aIdx, 1);
    this.render();
  }

  _onMimportAddFeature(event, target) {
    const draft = this._hubMonsterDraft(target);
    if (!draft) return;
    draft.features.push({ name: "New Feature", description: "" });
    this.render();
  }

  _onMimportRemoveFeature(event, target) {
    const draft = this._hubMonsterDraft(target);
    const fIdx = Number(target.closest("[data-feature-idx]")?.dataset.featureIdx);
    if (!draft || !Number.isFinite(fIdx)) return;
    draft.features.splice(fIdx, 1);
    this.render();
  }

  _hubMonsterDraft(target) {
    const idx = Number(target.closest("[data-monster-idx]")?.dataset.monsterIdx);
    return this._importMonsters[idx]?.draft ?? null;
  }

  // ── Import-tab item structural actions ───────────────────────────────────

  _onIimportRemoveItem(event, target) {
    const idx = Number(target.closest("[data-item-idx]")?.dataset.itemIdx);
    if (!Number.isFinite(idx)) return;
    this._importItems.splice(idx, 1);
    this.render();
  }

  _onSimportRemoveSpell(event, target) {
    const idx = Number(target.closest("[data-spell-idx]")?.dataset.spellIdx);
    if (!Number.isFinite(idx)) return;
    this._importSpells.splice(idx, 1);
    this.render();
  }

  // ── Import-tab table structural actions ──────────────────────────────────

  _onImportAddRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl) return;
    const nextMin = tbl.rows.reduce((m, r) => Math.max(m, r.max), 0) + 1;
    tbl.rows.push({ min: nextMin, max: nextMin, text: "" });
    this.render();
  }

  _onImportDeleteRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl || !Number.isFinite(rIdx)) return;
    tbl.rows.splice(rIdx, 1);
    this.render();
  }

  _onImportUnlinkRow(event, target) {
    const tIdx = Number(target.closest("[data-table-idx]")?.dataset.tableIdx);
    const rIdx = Number(target.closest("[data-row-idx]")?.dataset.rowIdx);
    const tbl = this._importTables[tIdx];
    if (!tbl || !Number.isFinite(rIdx) || !tbl.rows[rIdx]) return;
    tbl.rows[rIdx].link = null;
    this.render();
  }

  // ── Compound-generator structural actions ─────────────────────────────────

  /** Columns of a generator draft (handles the compound.columns / columns mirror). */
  _genColumns(g) { return g?.compound?.columns ?? g?.columns ?? []; }

  /** Current face count = highest max across all columns (min 1). */
  _genSize(g) {
    return Math.max(1, this._genColumns(g).reduce((m, c) =>
      Math.max(m, (c.rows ?? []).reduce((mm, r) => Math.max(mm, r.max), 0)), 0));
  }

  _onGenAddColumn(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    if (!g) return;
    const cols = this._genColumns(g);
    const size = this._genSize(g);
    const formula = cols[0]?.formula || g.formula || `1d${size}`;
    const rows = [];
    for (let f = 1; f <= size; f++) rows.push({ min: f, max: f, text: "" });
    cols.push({ label: `Detail ${cols.length + 1}`, formula, rows });
    this.render();
  }

  _onGenRemoveColumn(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    const ci = Number(target.closest("[data-col-idx]")?.dataset.colIdx);
    if (!g || !Number.isFinite(ci)) return;
    const cols = this._genColumns(g);
    if (cols.length <= 1) { ui.notifications.warn("A generator needs at least one column."); return; }
    cols.splice(ci, 1);
    this.render();
  }

  _onGenAddRow(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    if (!g) return;
    const cols = this._genColumns(g);
    const face = this._genSize(g) + 1;
    for (const c of cols) (c.rows ??= []).push({ min: face, max: face, text: "" });
    const formula = `1d${face}`;
    g.formula = formula;
    for (const c of cols) c.formula = formula;
    this.render();
  }

  _onGenDeleteRow(event, target) {
    const g = this._importGenerators[Number(target.closest("[data-gen-idx]")?.dataset.genIdx)];
    const face = Number(target.closest("[data-face-row]")?.dataset.faceRow);
    if (!g || !Number.isFinite(face)) return;
    const cols = this._genColumns(g);
    // Drop the face from each column, then renumber remaining rows to stay 1..N.
    for (const c of cols) {
      c.rows = (c.rows ?? []).filter(r => !(r.min === face && r.max === face));
      c.rows.sort((a, b) => a.min - b.min);
      c.rows.forEach((r, i) => { r.min = r.max = i + 1; });
    }
    const size = this._genSize(g);
    const formula = `1d${size}`;
    g.formula = formula;
    for (const c of cols) c.formula = formula;
    this.render();
  }
}

export function installHubPaste(cls) { installMethods(cls, HubPasteMethods); }
