/**
 * Shadowdark Enhancer — Class unit importer (Foundry-bound)
 *
 * Turns a parseClassSection() unit into real documents, in dependency order:
 *   1. outcome/option Talents for the talent-table rows — reusing
 *      shadowdark.talents docs by name wherever the system already ships the
 *      effect (those carry working ActiveEffects; ours would be inert copies)
 *   2. fixed feature Talents (incl. a Spellcasting enabler cloned from the
 *      system's "Spellcasting (Wizard)" with the class's own slug)
 *   2b. Class Ability docs for activated/grouped powers (roll + per-day uses):
 *      auto-detected single abilities (parser) + overlay-declared group members,
 *      created alongside the feature Talent and wired into system.classAbilities
 *   3. the 2d6 class-talent RollTable (choice rows = same-range multi-results:
 *      text "Choose 1" + one document result per option)
 *   4. the Class item wiring talents + classTalentTable + languages + wield
 *      lists (weapons/armor resolved BY NAME from shadowdark.gear)
 *
 * Shapes and traps follow .planning/CLASS-AUTHORING-PLAYBOOK.md — notably the
 * classTalentTable re-read (the field silently vanished once on Delver) and
 * v14 TableResult text living in `name`.
 *
 * Idempotent: same-named docs already in the suite packs are never
 * duplicated. Identical content is reused as-is; content that DIFFERS from
 * the corrected import is updated in place (UUID-preserving, review #12) and
 * reported under report.updated with the changed field labels.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { escapeHtml } from "../pdf-text-utils.mjs";
import { SPELL_LIST_VARIANTS } from "./char-content-manifest.mjs";
import { classGateBlockers, supplementGateBlockers } from "./class-quality-gate.mjs";

const _norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Find a system pack document by fuzzy name. Returns {uuid, name} or null. */
function _fuzzyFind(index, wanted) {
  const w = _norm(wanted);
  if (w.length < 4) return null;
  let hit = index.find((e) => _norm(e.name) === w);
  // "+2 to Strength" ↔ "+2 to Strength Stat" style containment (guarded).
  hit ??= index.find((e) => {
    const n = _norm(e.name);
    return (n.startsWith(w) || w.startsWith(n)) && Math.min(n.length, w.length) >= 8;
  });
  return hit ? { uuid: hit.uuid, name: hit.name } : null;
}

/**
 * Index entries (with uuid) of shadowdark.* packs of one doc type. When
 * `preferred` names a pack (e.g. "shadowdark.talents") and it exists, only
 * that pack is indexed — keeps fuzzy matches from straying into spells/gear.
 */
function _systemIndex(documentName, preferred = null) {
  const packs = [...game.packs].filter((p) =>
    p.collection.startsWith("shadowdark.") && p.documentName === documentName);
  const narrowed = preferred ? packs.filter((p) => p.collection === preferred) : [];
  const out = [];
  for (const pack of (narrowed.length ? narrowed : packs))
    for (const e of pack.index)
      out.push({ name: e.name, uuid: e.uuid ?? `Compendium.${pack.collection}.${documentName}.${e._id}` });
  return out;
}

/** Order-insensitive-keys deep equality for plain import data. */
function _deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => _deepEq(v, b[i]));
  if (a && b && typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => _deepEq(a[k], b[k]));
  }
  return false;
}

/** Comparable shape for embedded ActiveEffects (core `changes` or SD `system.changes`). */
function _effectShape(list) {
  return (list ?? []).map((e) => ({
    name: e.name ?? "",
    img: e.img ?? null,
    transfer: e.transfer !== false,
    changes: [...(e.changes ?? []), ...(e.system?.changes ?? [])].map((c) => ({
      key: c.key ?? "", mode: Number(c.mode ?? 2), value: String(c.value ?? ""),
    })),
  }));
}

/**
 * One-sided recursive equality: does the stored value satisfy every key the
 * IMPORT defines, at every depth? Extra stored keys (schema defaults like
 * spellcasting.spellsknown on a non-caster) never count as differences —
 * the import only owns what it specifies. Arrays compare fully in order.
 */
function _subsetEq(dataVal, docVal) {
  if (dataVal === docVal) return true;
  if (Array.isArray(dataVal)) {
    return Array.isArray(docVal) && dataVal.length === docVal.length
      && dataVal.every((v, i) => _subsetEq(v, docVal[i]));
  }
  if (dataVal && docVal && typeof dataVal === "object" && typeof docVal === "object") {
    return Object.keys(dataVal).every((k) => _subsetEq(dataVal[k], docVal[k]));
  }
  return false;
}

/**
 * Which import-owned fields differ between an existing doc and the corrected
 * payload (review #12). Only keys the import DEFINES are compared (recursively
 * — see _subsetEq); schema defaults and fields the import doesn't own never
 * count as stale. Folder is deliberately ignored (the user may have refiled
 * the doc).
 * @param {object} docObj  doc.toObject()
 * @param {object} data    create-shaped import payload
 * @returns {string[]} dotted field labels, empty = identical
 */
function _staleFields(docObj, data) {
  const fields = [];
  if (data.img != null && data.img !== docObj.img) fields.push("img");
  const docSys = docObj.system ?? {};
  for (const [k, v] of Object.entries(data.system ?? {})) {
    if (!_subsetEq(v, docSys[k])) fields.push(`system.${k}`);
  }
  if (!_deepEq(_effectShape(data.effects), _effectShape(docObj.effects))) fields.push("effects");
  const df = data.flags?.[MODULE_ID] ?? {};
  const of = docObj.flags?.[MODULE_ID] ?? {};
  if (!_subsetEq(df, of)) fields.push("flags");
  return fields;
}

/**
 * Find-or-create one Item in the suite pack, foldered.
 * Same-name/type docs are diffed against the corrected payload: identical →
 * reused; different → updated IN PLACE (UUID + inbound links survive) so a
 * corrected re-import never silently retains stale content (review #12).
 * → {uuid, name, reused, updated?}
 */
async function _ensureItem(pack, data, folderPath, report) {
  const { ensureFolderPath, cleanImportHtml, replaceDocument } = await import("../../shared/compendium-suite.mjs");
  // Commit choke point: sanitize persisted HTML (review #1).
  if (data.system?.description) data.system.description = cleanImportHtml(data.system.description);
  const idx = await pack.getIndex({ fields: ["type"] });
  const existing = idx.find((e) => e.name === data.name && e.type === data.type);
  if (existing) {
    const doc = await pack.getDocument(existing._id);
    const fields = _staleFields(doc.toObject(), data);
    if (!fields.length) {
      report.reused.push({ name: data.name, type: data.type, uuid: doc.uuid });
      return { uuid: doc.uuid, name: data.name, reused: true };
    }
    const payload = { ...data, folder: doc.toObject().folder ?? null };
    const { doc: updated } = await replaceDocument(doc, payload, pack);
    (report.updated ??= []).push({ name: data.name, type: data.type, uuid: updated.uuid, fields });
    return { uuid: updated.uuid, name: data.name, reused: true, updated: true };
  }
  const folder = await ensureFolderPath(pack, folderPath);
  const doc = await Item.create({ ...data, folder }, { pack: pack.collection });
  report.created.push({ name: doc.name, type: doc.type, uuid: doc.uuid });
  return { uuid: doc.uuid, name: doc.name, reused: false };
}

function _talentData(name, description, sourceTitle, { talentClass = "level", effects = [] } = {}) {
  return {
    name, type: "Talent", img: effects[0]?.img ?? "icons/sundries/documents/document-torn-diagram-tan.webp",
    system: {
      description, level: 1, talentClass,
      source: { title: sourceTitle ?? "" },
    },
    // Overlay wiring → embedded ActiveEffects in the SD system change schema.
    effects: effects.map((e) => ({
      name: e.name, img: e.img, transfer: e.transfer !== false, type: "base",
      system: { changes: e.changes ?? [] },
    })),
    flags: { [MODULE_ID]: { imported: true } },
  };
}

/**
 * Create-shaped data for a "Class Ability" — the SD document type for activated,
 * grouped, roll-and-uses powers (Bard's Inspire, Sea Wolf's Berserk). Distinct
 * from a Talent: it carries group/ability/dc/limitedUses/uses/loseOnFailure, so
 * the actor sheet renders a roll button and class-ability-uses.mjs tracks the
 * per-day pool. A limited-use ability also stamps the module `usesRule` flag
 * (base = its max) so the boost-talent machinery ("used twice per day") applies.
 */
function _classAbilityData(name, description, sourceTitle, {
  group = "", ability = "", dc = 10, limitedUses = false, uses = null,
  loseOnFailure = true, usesRule = null, effects = [],
} = {}) {
  const pool = uses ?? { available: 0, max: 0 };
  const rule = usesRule ?? (limitedUses && Number(pool.max) > 0 ? { type: "base", base: Number(pool.max) } : null);
  return {
    name, type: "Class Ability", img: effects[0]?.img ?? "icons/sundries/documents/document-torn-diagram-tan.webp",
    system: {
      description, group, ability, dc,
      limitedUses, loseOnFailure, lost: false,
      uses: { available: Number(pool.available) || 0, max: Number(pool.max) || 0 },
      source: { title: sourceTitle ?? "" },
    },
    effects: effects.map((e) => ({
      name: e.name, img: e.img, transfer: e.transfer !== false, type: "base",
      system: { changes: e.changes ?? [] },
    })),
    flags: { [MODULE_ID]: { imported: true, ...(rule ? { usesRule: rule } : {}) } },
  };
}

/**
 * Best-effort slice of a group MEMBER's rules text out of its parent feature's
 * pasted description (contract: overlay class abilities carry mechanics only —
 * the words come from the paste). Finds the member name in the parent Talent's
 * text and takes the sentence(s) that follow. Returns "" when not found; the
 * parent Talent still holds the full list, so an empty member desc is benign.
 */
function _sliceMemberText(features, parentName, memberName) {
  const parent = (features ?? []).find((f) => _norm(f.name) === _norm(parentName));
  if (!parent || !memberName) return "";
  const plain = String(parent.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const i = plain.toLowerCase().indexOf(String(memberName).toLowerCase());
  if (i === -1) return "";
  return escapeHtml(plain.slice(i, i + 240).trim());
}

/**
 * Resolve one talent-effect label to a document uuid: system talent when the
 * name matches, else find-or-create an sde-items Talent (description-only —
 * numeric effects still need hand wiring, which we surface as a warning).
 */
async function _resolveOutcome(label, { pack, sysTalents, sourceTitle, className, report, queue = null }) {
  // System talents first — they carry working ActiveEffects. Options the
  // system can't cover consume the overlay's authored queue in order (our
  // invented name + wiring; the pasted row text becomes the description).
  const sys = _fuzzyFind(sysTalents, label);
  if (sys) {
    report.systemReuse.push({ label, system: sys.name });
    return sys.uuid;
  }
  const authored = queue?.shift() ?? null;
  if (authored) {
    const made = await _ensureItem(pack,
      _talentData(authored.name, `<p>${label}</p>`, sourceTitle,
        { talentClass: authored.talentClass ?? "level", effects: authored.effects ?? [] }),
      ["Level", className], report);
    return made.uuid;
  }
  // Spellcasting-check bonus ("+1 to druid spellcasting checks") — the wording
  // varies by class so _fuzzyFind misses the system's "+N on Spellcasting
  // Checks" talent. Reuse that twin when it exists; else author its AE
  // (system.roll.spell.bonus.all) so the bonus actually applies.
  const scm = label.match(/([+-]\d+)\b(?=[\s\S]*\bspellcasting\s+checks?\b)/i);
  if (scm) {
    const twin = sysTalents.find((e) => _norm(e.name) === _norm(`${scm[1]} on spellcasting checks`));
    if (twin) { report.systemReuse.push({ label, system: twin.name }); return twin.uuid; }
    const made = await _ensureItem(pack, _talentData(label, `<p>${label}</p>`, sourceTitle, {
      talentClass: "level",
      effects: [{
        name: "Spellcasting Check Bonus", img: "icons/magic/fire/flame-burning-fist-strike.webp", transfer: true,
        changes: [{ key: "system.roll.spell.bonus.all", value: Number(scm[1]), type: "add", phase: "initial" }],
      }],
    }), ["Level", className], report);
    return made.uuid;
  }
  const made = await _ensureItem(pack, _talentData(label, `<p>${label}</p>`, sourceTitle),
    ["Level", className], report);
  if (!made.reused && /[+-]\d/.test(label))
    report.warnings.push(`"${label}" looks numeric but has no system twin — add its ActiveEffect by hand (playbook §2).`);
  return made.uuid;
}

/**
 * PREVIEW-time read-only classifier: for each parsed talent-table row, report
 * whether its effect maps to a REAL, mechanically-wired Talent item, or is only
 * free text that would import as a description-only talent needing hand-wiring.
 * Reuses the exact matcher (`_fuzzyFind`) and indexes (`shadowdark.talents` +
 * the suite Talents pack) the commit path uses in `_resolveOutcome`, so the
 * preview badge and the committed RollTable (document-link vs text result) can't
 * disagree. Never creates anything.
 *
 * `via`: "system" (a shadowdark.talents doc with working AEs), "suite" (an
 * already-imported suite Talent), "authored" (a spellcasting-check bonus the
 * commit authors an AE for), or null (would import description-only).
 *
 * @param {Array<{text?:string, options?:string[], kind?:string}>} rows
 * @returns {Promise<Array<{wired:boolean, via:string|null, match:string|null}>>}
 */
export async function classifyTalentRows(rows = []) {
  const sysTalents = _systemIndex("Item", "shadowdark.talents");
  let suiteIdx = [];
  try {
    const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
    const pack = findSuitePack("talents");
    if (pack) {
      await pack.getIndex();
      suiteIdx = [...pack.index].map((e) => ({ name: e.name, uuid: e.uuid }));
    }
  } catch (_e) { /* no suite yet — system talents still classify */ }

  return (rows ?? []).map((r) => {
    const labels = [r?.text, ...(Array.isArray(r?.options) ? r.options : [])]
      .map((s) => String(s ?? "").trim()).filter(Boolean);
    for (const label of labels) {
      const sys = _fuzzyFind(sysTalents, label);
      if (sys) return { wired: true, via: "system", match: sys.name };
      const suite = suiteIdx.length ? _fuzzyFind(suiteIdx, label) : null;
      if (suite) return { wired: true, via: "suite", match: suite.name };
      if (/([+-]\d+)\b(?=[\s\S]*\bspellcasting\s+checks?\b)/i.test(label))
        return { wired: true, via: "authored", match: "Spellcasting Check Bonus" };
    }
    return { wired: false, via: null, match: null };
  });
}

/**
 * Create the class's NAMED extra tables (Wyrdling CORRUPTION, …) as RollTables
 * in the Tables pack under Class Tables/<class>, text-result rows. Idempotent:
 * same-name table diffed and reused/updated. Returns
 * [{ keyword, uuid, name }] so buildClassTalentTable can link the rows that
 * reference them ("Gain a Corruption talent" → this table).
 *
 * @param {object} parsed  needs { name, extraTables: [{name, formula, rows}] }
 * @param {object} ctx     { tablesPack, source, report, ensureFolderPath }
 */
async function buildExtraTables(parsed, { tablesPack, talentsPack, sourceTitle, overlay, source, report, ensureFolderPath }) {
  const refs = [];
  const className = parsed.name;
  const talentRows = parsed.talentTable?.rows ?? [];
  // A "Name. Rules text." row splits into an authored Talent (name + its own
  // description) so a talent-GRANTING extra table (Wyrdling Corruption, Aberrant
  // Mutation) can drop the rolled result onto the sheet as a real item instead
  // of an inert text row the char-builder can only ask the player to add by hand.
  const NAMED = /^([A-Z][A-Za-z'’ -]{0,39})\.\s+(\S[\s\S]*)$/;
  const splitNamed = (txt) => {
    const m = String(txt).trim().match(NAMED);
    return m ? { name: m[1].trim(), desc: m[2].trim() } : { name: String(txt).trim(), desc: "" };
  };

  for (const t of parsed.extraTables ?? []) {
    if (!(t.rows?.length)) continue;
    const keyword = t.name.toLowerCase();
    // "Wyrdling Corruption" — prefix the class unless the caption already names it.
    const tblName = new RegExp(`\\b${className}\\b`, "i").test(t.name) ? t.name : `${className} ${t.name}`;
    // Talent-granting when a talent-table row points here ("Gain a Corruption
    // talent") OR every row reads as a "Name. Rules." talent. Then each row
    // links a real Talent item; a purely descriptive table keeps text rows.
    const referenced = talentRows.some((r) => String(r.text ?? "").toLowerCase().includes(keyword));
    const allNamed = t.rows.every((r) => NAMED.test(String(r.text ?? "").trim()));
    const grantsTalents = !!talentsPack && (referenced || allNamed);
    let results;
    if (grantsTalents) {
      results = [];
      for (const r of t.rows) {
        const { name, desc } = splitNamed(r.text);
        // Overlay may author mechanics for a row (e.g. Thickened Skin → +1 AC);
        // otherwise the talent is description-only, faithful to the book text.
        const authored = overlay?.extraTableTalents?.[name.toLowerCase()] ?? null;
        // eslint-disable-next-line no-await-in-loop
        const made = await _ensureItem(talentsPack,
          _talentData(name, `<p>${escapeHtml(desc || name)}</p>`, sourceTitle,
            { talentClass: authored?.talentClass ?? "class", effects: authored?.effects ?? [] }),
          ["Class", className], report);
        results.push({ type: "document", documentUuid: made.uuid, range: [r.lo, r.hi] });
      }
    } else {
      results = t.rows.map((r) => ({ type: "text", name: r.text, range: [r.lo, r.hi] }));
    }
    const tblFlags = { [MODULE_ID]: { imported: true, ...(source ? { source } : {}) } };

    const tIdx = await tablesPack.getIndex();
    const existing = tIdx.find((e) => e.name === tblName);
    if (existing) {
      const doc = await tablesPack.getDocument(existing._id);
      // Compare type + linked uuid too, so a text→document (or relinked) table
      // is rewritten rather than reused on the identical name/range shape.
      const shape = (rs) => rs.map((r) => ({ name: r.name ?? "", type: r.type ?? "text", uuid: r.documentUuid ?? "", range: [Number(r.range?.[0] ?? 0), Number(r.range?.[1] ?? 0)] }));
      const same = doc.formula === t.formula && _deepEq(shape(doc.toObject().results), shape(results));
      if (same) report.reused.push({ name: tblName, type: "RollTable", uuid: doc.uuid });
      else {
        const { replaceDocument } = await import("../../shared/compendium-suite.mjs");
        await replaceDocument(doc, { name: tblName, formula: t.formula, folder: doc.toObject().folder ?? null, results, flags: tblFlags }, tablesPack);
        report.updated.push({ name: tblName, type: "RollTable", uuid: doc.uuid, fields: ["results"] });
      }
      refs.push({ keyword, uuid: doc.uuid, name: tblName });
    } else {
      const folder = await ensureFolderPath(tablesPack, ["Class Tables", className]);
      const doc = await RollTable.create({ name: tblName, formula: t.formula, folder, results, flags: tblFlags }, { pack: tablesPack.collection });
      report.created.push({ name: doc.name, type: "RollTable", uuid: doc.uuid });
      refs.push({ keyword, uuid: doc.uuid, name: tblName });
    }
  }
  return refs;
}

/**
 * Build the talent-table outcome Talents + the class-talent RollTable for a
 * parsed class (or a supplement carrying just a talentTable). Outcome Talents
 * are created in the Talents pack under Level/<class>; the "Class Talents:
 * <name>" RollTable is created/updated in the Tables pack. Mutates `report` and
 * returns the table uuid ("" when the parse carried no usable table).
 *
 * Shared by createClassUnit and mergeClassSupplement so a talent table pasted
 * later attaches identically to one pasted with the class body.
 *
 * @param {object} parsed  needs { name, talentTable }
 * @param {object} ctx     { talentsPack, tablesPack, sysTalents, sourceTitle,
 *                           source, overlay, report, ensureFolderPath,
 *                           extraTableRefs }
 *   extraTableRefs: [{ keyword, uuid, name }] — rows whose text references one
 *   ("Gain a new Corruption talent") link that table as a document result
 *   (v14 nested roll) instead of creating an inert placeholder talent.
 */
async function buildClassTalentTable(parsed, { talentsPack, tablesPack, sysTalents, sourceTitle, source, overlay, report, ensureFolderPath, extraTableRefs = [] }) {
  // ── Talent-table outcome docs ──
  const rowResults = [];   // per row: { range, uuids: [], chooseText? }
  const allOptionUuids = new Set();
  // Overlay keys must line up with the parsed bands — a mismatch usually means
  // the table parsed shifted/short and the authored names would mask it.
  const parsedKeys = new Set((parsed.talentTable?.rows ?? []).map((r) => (r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`)));
  for (const k of Object.keys(overlay?.rowTalents ?? {})) {
    if (!parsedKeys.has(k))
      report.warnings.push(`Class overlay authors a talent for band ${k}, but the parsed table has no such band (parsed: ${[...parsedKeys].join(", ") || "none"}) — check the talent table against the book.`);
  }
  for (const row of parsed.talentTable?.rows ?? []) {
    const range = [row.lo, row.hi];
    if (row.kind === "grand") { rowResults.push({ range, grand: true, text: row.text }); continue; }
    // Row that grants a roll on an extra table (e.g. "Gain a new Corruption
    // talent") → a Talent that POINTS at the table via an @UUID[RollTable] link
    // in its description. The char-builder's bonus-roll machinery then rolls
    // that table — TWICE when the row says "two" (talentRollCount keys on the
    // word, which survives in the name/description). The class table links this
    // Talent (an Item), which _rollOnTable keeps as the outcome.
    const ref = extraTableRefs.find((t) => row.text.toLowerCase().includes(t.keyword));
    if (ref) {
      const rangeKey = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`;
      const authored = overlay?.rowTalents?.[rangeKey]?.[0] ?? null;
      const talentName = authored?.name ?? row.text;   // keeps "two" for talentRollCount
      const desc = `<p>${escapeHtml(row.text)}. Roll on @UUID[${ref.uuid}]{${ref.name}}.</p>`;
      const made = await _ensureItem(talentsPack,
        _talentData(talentName, desc, sourceTitle,
          { talentClass: authored?.talentClass ?? "level", effects: authored?.effects ?? [] }),
        ["Level", parsed.name], report);
      rowResults.push({ range, uuids: [made.uuid] });
      allOptionUuids.add(made.uuid);
      continue;
    }
    // Preview edits can leave blank rows/options — skip them, never create
    // a nameless Talent.
    const labels = (row.kind === "choice" ? (row.options ?? []) : [row.text])
      .map((s) => String(s ?? "").trim()).filter(Boolean);
    if (!labels.length) continue;
    const rangeKey = row.lo === row.hi ? String(row.lo) : `${row.lo}-${row.hi}`;
    const queue = [...(overlay?.rowTalents?.[rangeKey] ?? [])];
    const uuids = [];
    for (const label of labels)
      uuids.push(await _resolveOutcome(label, {
        pack: talentsPack, sysTalents, sourceTitle, className: parsed.name, report, queue,
      }));
    uuids.forEach((u) => allOptionUuids.add(u));
    rowResults.push({ range, uuids, choose: row.kind === "choice" });
  }

  // ── Class-talent RollTable (same-range multi-results for choices) ──
  let tableUuid = "";
  if (parsed.talentTable && rowResults.length) {
    // The class sheet's "Class Talents Table" dropdown lists RollTables whose
    // name matches /class\s+talents/i (probed from CompendiumsSD
    // .classTalentTables) and displays them with the "Class Talents: " prefix
    // stripped — so this exact format is required, no source prefix.
    const tblName = `Class Talents: ${parsed.name}`;
    // Build the DESIRED results first, so an existing table is diffed against
    // the corrected import instead of reused with stale rows (review #12).
    // "Distribute to Stats"-style system table for the row-12 grand choice.
    const sysTables = _systemIndex("RollTable");
    const distribute = sysTables.find((e) => /distribute/i.test(e.name)) ?? null;
    const results = [];
    const uuidName = new Map([...report.created, ...report.reused, ...report.updated].map((c) => [c.uuid, c.name]));
    const nameFor = async (uuid) => uuidName.get(uuid) ?? (await fromUuid(uuid))?.name ?? "Talent";
    for (const rr of rowResults) {
      const range = rr.range;
      if (rr.grand) {
        results.push({ type: "text", name: "Choose 1", range });
        for (const u of allOptionUuids) results.push({ type: "document", name: await nameFor(u), documentUuid: u, range });
        if (distribute) results.push({ type: "document", name: distribute.name, documentUuid: distribute.uuid, range });
        else report.warnings.push(`Row ${range[0]}${range[1] !== range[0] ? `-${range[1]}` : ""}: no system "Distribute to Stats" table found — that option stays text-only ("${rr.text}").`);
        continue;
      }
      if (rr.choose) results.push({ type: "text", name: "Choose 1", range });
      for (const u of rr.uuids) results.push({ type: "document", name: await nameFor(u), documentUuid: u, range });
    }
    const tblDescription = "Rolled on level up. A roll that matches multiple results is a pick — see the class rules for special duplicates.";
    const tblFlags = { [MODULE_ID]: { imported: true, ...(source ? { source } : {}) } };

    const tIdx = await tablesPack.getIndex();
    const tExisting = tIdx.find((e) => e.name === tblName);
    if (tExisting) {
      const doc = await tablesPack.getDocument(tExisting._id);
      tableUuid = doc.uuid;
      // Comparable row shape; sorted so embedded-creation order can't alias
      // a real content change.
      const shape = (rs) => rs
        .map((r) => ({ type: r.type, name: r.name ?? "", documentUuid: r.documentUuid ?? null,
          range: [Number(r.range?.[0] ?? 0), Number(r.range?.[1] ?? 0)] }))
        .sort((a, b) => a.range[0] - b.range[0] || a.name.localeCompare(b.name));
      const same = doc.formula === parsed.talentTable.formula
        && _deepEq(shape(doc.toObject().results), shape(results));
      if (same) {
        report.reused.push({ name: tblName, type: "RollTable", uuid: tableUuid });
      } else {
        const { replaceDocument } = await import("../../shared/compendium-suite.mjs");
        await replaceDocument(doc, {
          name: tblName, formula: parsed.talentTable.formula,
          folder: doc.toObject().folder ?? null,
          description: tblDescription, results, flags: tblFlags,
        }, tablesPack);
        report.updated.push({ name: tblName, type: "RollTable", uuid: tableUuid, fields: ["results"] });
      }
    } else {
      const folder = await ensureFolderPath(tablesPack, ["Class Talents"]);
      const table = await RollTable.create({
        name: tblName, formula: parsed.talentTable.formula, folder,
        description: tblDescription,
        results,
        flags: tblFlags,
      }, { pack: tablesPack.collection });
      tableUuid = table.uuid;
      report.created.push({ name: table.name, type: "RollTable", uuid: table.uuid });
    }
  }
  return tableUuid;
}

/**
 * Create/reuse every document for one parsed class unit.
 * @param {object} parsed  parseClassSection() output
 * @param {object} opts    { source, sourceTitle, overlay, bodyOnly }
 *   bodyOnly (2-stage Stage 1): create only the Class item + feature Talents +
 *   wield/languages — SKIP the talent table, titles, spells-known grid, and
 *   extra tables. Those are imported in Stage 2 (Class · Roll Tables) and
 *   attached via mergeClassSupplement.
 * @returns {Promise<object>} report { created, reused, updated, systemReuse, warnings, classUuid, tableUuid }
 *   `updated` = same-name docs whose content differed from the corrected
 *   import and were updated in place ({name, type, uuid, fields}).
 */
export async function createClassUnit(parsed, { source = "", sourceTitle = "", overlay = null, bodyOnly = false, allowInvalid = false } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import a class."); return null; }
  // Fail closed: BLOCKER-grade parse issues are never persisted without an
  // explicit override. UI adapters compute the same issues (class-quality-gate)
  // and prompt the user before passing allowInvalid; a direct caller that skips
  // the prompt gets the sentinel and writes nothing.
  const gateBlockers = classGateBlockers(parsed.warnings);
  if (gateBlockers.length && !allowInvalid) return { blocked: true, name: parsed.name, issues: gateBlockers };
  const { ensureSuite, ensureFolderPath, sourceFolderName } = await import("../../shared/compendium-suite.mjs");
  const suite = await ensureSuite();
  if (!suite?.items || !suite?.tables || !suite?.classes || !suite?.talents || !suite?.classAbilities) {
    ui.notifications?.error("Suite packs unavailable."); return null;
  }
  const itemsPack = suite.items, tablesPack = suite.tables;
  const classesPack = suite.classes, talentsPack = suite.talents;
  const classAbilitiesPack = suite.classAbilities;

  const report = { created: [], reused: [], updated: [], systemReuse: [], warnings: [...(parsed.warnings ?? [])] };
  const sysTalents = _systemIndex("Item", "shadowdark.talents");

  // ── 0. WR-only gear the class references (overlay-shipped stat lines,
  // no descriptions) — created first so the wield list resolves. ──
  const ourGear = [];
  for (const it of overlay?.items ?? []) {
    const made = await _ensureItem(itemsPack, {
      name: it.name, type: it.type, img: it.img,
      system: { ...it.system, description: "", source: { title: sourceTitle } },
      effects: (it.effects ?? []).map((e) => ({
        name: e.name, img: e.img, transfer: e.transfer !== false, type: "base",
        system: { changes: e.changes ?? [] },
      })),
      flags: { [MODULE_ID]: { imported: true } },
    }, String(it.folder ?? "Gear/Weapons").split("/"), report);
    ourGear.push({ name: it.name, uuid: made.uuid });
  }

  // ── 0.5. Named extra tables (Wyrdling CORRUPTION, …) + talent-table docs.
  // Stage 1 (bodyOnly) skips all roll tables — they arrive in Stage 2.
  const extraTableRefs = bodyOnly ? [] : await buildExtraTables(parsed, { tablesPack, talentsPack, sourceTitle, overlay, source, report, ensureFolderPath });

  // ── 1+3. Talent-table outcome docs + class-talent RollTable ──
  // Outcome Talents → Talents pack (Level/<class>); table → Tables pack.
  const tableUuid = bodyOnly ? "" : await buildClassTalentTable(parsed, {
    talentsPack, tablesPack, sysTalents, sourceTitle, source, overlay, report, ensureFolderPath, extraTableRefs,
  });
  if (bodyOnly && (parsed.talentTable || parsed.titles?.length || parsed.spellsKnown?.length || parsed.extraTables?.length))
    report.warnings.push("This paste also contained roll tables (talent table / titles / spells known / extra table) — import them in the \"Class · Roll Tables\" stage and attach them to this class.");

  // ── 2. Fixed feature Talents (+ Spellcasting enabler) ──
  const featureUuids = [];
  for (const f of parsed.features) {
    if (!String(f.name ?? "").trim()) continue;   // blank preview rows
    const wired = overlay?.features
      ? Object.entries(overlay.features).find(([k]) => k.toLowerCase() === f.name.toLowerCase())?.[1] ?? null
      : null;
    const made = await _ensureItem(talentsPack,
      _talentData(f.name, f.description, sourceTitle,
        { talentClass: wired?.talentClass ?? "class", effects: wired?.effects ?? [] }),
      ["Class", parsed.name], report);
    featureUuids.push(made.uuid);
  }

  // ── 2b. Class Ability docs (activated/grouped powers) ──
  // Emitted ALONGSIDE the feature Talent (the char-builder dedups the shared
  // name and grants both). Auto-detected single abilities come from the parser
  // (feature.classAbility, group = class name); overlay entries add/override
  // group members (Presence/Herbalism) and win field-by-field. These carry the
  // group/ability/dc/uses the sheet renders with roll buttons and
  // class-ability-uses.mjs tracks — the wiring a plain Talent can't hold.
  const caByName = new Map();
  for (const f of parsed.features) {
    if (!f.classAbility || !String(f.name ?? "").trim()) continue;
    caByName.set(_norm(f.name), { name: f.name, description: f.description, group: parsed.name, ...f.classAbility });
  }
  for (const ca of overlay?.classAbilities ?? []) {
    if (!String(ca.name ?? "").trim()) continue;
    const key = _norm(ca.name);
    const prev = caByName.get(key) ?? {};
    const description = ca.fromParent ? _sliceMemberText(parsed.features, ca.fromParent, ca.name) : (prev.description ?? "");
    caByName.set(key, {
      name: ca.name, description,
      group: ca.group ?? prev.group ?? parsed.name,
      ability: ca.ability ?? prev.ability ?? "",
      dc: ca.dc ?? prev.dc ?? 10,
      limitedUses: ca.limitedUses ?? prev.limitedUses ?? false,
      uses: ca.uses ?? prev.uses ?? null,
      loseOnFailure: ca.loseOnFailure ?? prev.loseOnFailure ?? true,
      usesRule: ca.usesRule ?? null,
      effects: ca.effects ?? [],
    });
  }
  const classAbilityUuids = [];
  for (const ca of caByName.values()) {
    const made = await _ensureItem(classAbilitiesPack,
      _classAbilityData(ca.name, ca.description, sourceTitle, ca),
      ["Class", parsed.name], report);
    classAbilityUuids.push(made.uuid);
  }

  // How the caster's spell list wires (see classifySpellWiring):
  //   • "borrow"  — an explicit preview lender pick OR a list that names a REAL
  //     class (Knight of St. Ydris → Witch): point spellcasting.class at that
  //     class, enabler adds the lender's slug — the class casts the WHOLE list.
  //   • "variant" — a Wizard-variant list ("casts druid spells"): stay a
  //     SELF-CONTAINED own-list caster (spellcasting.class="", own slug, book
  //     ability). tagBorrowedSpellLists() stamps this class's uuid onto exactly
  //     its variant's alignment-tagged Wizard spells, so the system's alignment-
  //     blind level-up spellbook offers that list only — not all 108 wizard spells.
  let spellClass = parsed.spellcasting?.spellClass ?? null;
  let variantList = null;
  if (parsed.spellcasting) {
    const wiring = classifySpellWiring(parsed.spellcasting);
    if (wiring.kind === "variant") {
      variantList = wiring.variant;
    } else if (wiring.kind === "borrow" && !spellClass && wiring.listName) {
      const hit = _systemIndex("Item", "shadowdark.classes")
        .find((e) => e.name.toLowerCase() === wiring.listName);
      if (hit) spellClass = { uuid: hit.uuid, name: hit.name, slug: hit.name.slugify?.() ?? _norm(hit.name).replace(/ /g, "-") };
      else report.warnings.push(`Spell list "${parsed.spellcasting.spellList}" didn't match an existing caster class — the class keeps its own list; pick the lender in the preview or set spellcasting.class by hand.`);
    }
  }

  if (parsed.spellcasting) {
    const ownSlug = parsed.name.slugify?.() ?? _norm(parsed.name).replace(/ /g, "-");
    // The enabler registers the slug of the class whose LIST is cast from: the
    // lender's on a full-class borrow (probed: Knight of St. Ydris adds "witch"),
    // else the class's OWN slug (own list AND Wizard-variant borrowers alike —
    // the latter cast from their own tagged list, not Wizard's).
    const slug = spellClass?.slug ?? ownSlug;
    const donor = _fuzzyFind(sysTalents, "Spellcasting (Wizard)");
    if (donor) {
      const donorDoc = await fromUuid(donor.uuid);
      const data = donorDoc.toObject();
      delete data._id; delete data._stats; delete data.folder; delete data.ownership; delete data.sort;
      data.name = `Spellcasting (${parsed.name})`;
      data.system.description = parsed.spellcasting.text || data.system.description;
      data.system.source = { title: sourceTitle };
      for (const eff of data.effects ?? [])
        for (const ch of eff.changes ?? [])
          if (ch.key === "system.spellcasting.classes") ch.value = slug;
      data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { imported: true } };
      const made = await _ensureItem(talentsPack, data, ["Class", parsed.name], report);
      featureUuids.push(made.uuid);
    } else {
      report.warnings.push("System 'Spellcasting (Wizard)' talent not found — create the casting-enabler talent by hand (playbook: Spellcaster wiring).");
    }
  }

  // ── 4. The Class item ──
  const gearIndex = _systemIndex("Item", "shadowdark.gear");
  const resolveGear = (names, kind) => names.map((n) => {
    const hit = _fuzzyFind(gearIndex, n.replace(/s$/, ""))
      ?? ourGear.find((g) => _norm(g.name) === _norm(n).replace(/s$/, ""))
      ?? ourGear.find((g) => _norm(g.name) === _norm(n));
    if (!hit) report.warnings.push(`${kind} "${n}" not found in the system packs — create it first (playbook §4), then add it to the class.`);
    return hit?.uuid;
  }).filter(Boolean);
  // Overlay wield-list overrides — for grants the book states as categories
  // ("all swords", "strikes") that name-splitting can't resolve.
  const weaponNames = overlay?.weaponNames ?? parsed.weaponNames;
  const armorNames  = overlay?.armorNames ?? parsed.armorNames;
  // The char-builder consumes languages.fixed/selectOptions as UUIDs — map any
  // parsed NAMES (e.g. "Sylvan", "Primordial") through the system packs.
  const { resolveLanguageNames } = await import("./language-resolver.mjs");
  const classLanguages = { ...(parsed.languages ?? { common: 0, rare: 0, select: 0, selectOptions: [], fixed: [] }) };
  classLanguages.fixed = await resolveLanguageNames(classLanguages.fixed);
  classLanguages.selectOptions = await resolveLanguageNames(classLanguages.selectOptions);
  for (const u of [...classLanguages.fixed, ...classLanguages.selectOptions]) {
    if (!/^Compendium\./.test(String(u))) report.warnings.push(`Language "${u}" not found in the system language packs — the char-builder will skip it.`);
  }

  const classData = {
    name: parsed.name, type: "Class", img: "icons/skills/trades/academics-book-study-runes.webp",
    system: {
      // Flavor only — matches the system convention (e.g. Wizard's description is
      // just the intro paragraph). The features are separate Talent items in
      // `talents` below; folding them into the description too made the
      // char-builder show every feature twice.
      description: parsed.flavor ?? "",
      hitPoints: parsed.hitPoints,
      allWeapons: parsed.allWeapons, allMeleeWeapons: parsed.allMeleeWeapons,
      allRangedWeapons: parsed.allRangedWeapons,
      // Overlay fallback for classes whose "All armor…" stat line a degraded
      // extraction can drop (never lets an overlay turn a parsed true off).
      allArmor: parsed.allArmor || overlay?.allArmor === true,
      weapons: resolveGear(weaponNames, "Weapon"),
      armor: resolveGear(armorNames, "Armor"),
      languages: classLanguages,
      talents: featureUuids,
      talentChoiceCount: 0,
      classTalentTable: tableUuid,
      classAbilities: classAbilityUuids, talentChoices: [],
      patron: { required: false, startingBoons: 0 },
      spellcasting: {
        ability: parsed.spellcasting?.ability ?? "",
        baseDifficulty: 10,
        // "" = casts its own list; a class UUID = borrows that class's list
        // (probed from the system's Knight of St. Ydris → Witch).
        class: parsed.spellcasting ? (spellClass?.uuid ?? "") : "__not_spellcaster__",
        // System shape (probed from shadowdark.classes Wizard, SD 4.x):
        // { "<level>": { "1": n|null … "5": n|null } }, null for "—".
        ...(!bodyOnly && parsed.spellcasting && (parsed.spellsKnown ?? []).length ? {
          spellsknown: Object.fromEntries(
            parsed.spellsKnown.filter((r) => r.level >= 1 && r.level <= 10).map((r) => [
              String(r.level),
              Object.fromEntries([1, 2, 3, 4, 5].map((t) => [String(t), r.tiers[t - 1] || null])),
            ])),
        } : {}),
      },
      titles: bodyOnly ? [] : (parsed.titles ?? []).map((t) => ({
        from: Number(t.from) || 1, to: Number(t.to) || Number(t.from) || 1,
        lawful: t.lawful ?? "", chaotic: t.chaotic ?? "", neutral: t.neutral ?? "",
      })),
      source: { title: sourceTitle },
    },
    // classFlags: SDE-original class metadata (e.g. fixedDeity → DeityStep pin).
    // grantedItems: overlay-shipped natural weapons/gear (the Wyrdling's
    // Pseudopod) the char-builder embeds on every member at creation — distinct
    // from the proficiency-only weapons the player buys.
    // borrowedSpellList: the Wizard-variant nickname this class casts ("druid")
    // — tagBorrowedSpellLists() reads it to stamp the class onto that variant's
    // spells (own-list caster; no lender uuid on spellcasting.class).
    flags: { [MODULE_ID]: { imported: true, ...(overlay?.classFlags ?? {}),
      ...(ourGear.length ? { grantedItems: ourGear.map((g) => g.uuid) } : {}),
      ...(variantList ? { borrowedSpellList: variantList } : {}) } },
  };
  // Body-only re-import must NOT clobber supplement-owned fields. Stage 1 builds
  // classTalentTable/titles/spellsknown EMPTY (they arrive in Stage 2), and
  // _ensureItem replaces the whole doc — so re-pasting just the writeup would
  // erase an already-attached talent table + titles. Carry the existing class's
  // Stage-2 values forward. (review 2026-07-12 #1)
  if (bodyOnly) {
    const prior = (await classesPack.getIndex({ fields: ["type"] }))
      .find((e) => e.name === classData.name && e.type === "Class");
    const existing = prior ? (await classesPack.getDocument(prior._id))?.toObject() : null;
    if (existing) {
      if (existing.system?.classTalentTable) classData.system.classTalentTable = existing.system.classTalentTable;
      if (existing.system?.titles?.length) classData.system.titles = existing.system.titles;
      const priorKnown = existing.system?.spellcasting?.spellsknown;
      // Only when the body still describes a caster — don't strand a spells-known
      // table on a class the re-paste turned non-caster.
      if (parsed.spellcasting && priorKnown && Object.keys(priorKnown).length)
        classData.system.spellcasting.spellsknown = priorKnown;
    }
  }

  // Class item → world.classes, foldered by source (Western Reaches / Custom),
  // matching the rest of the char-option suite.
  const madeClass = await _ensureItem(classesPack, classData, [sourceFolderName(source)], report);

  // TRAP (playbook §1): classTalentTable silently vanished once — re-read the
  // pack copy and repair if the field didn't persist. Runs on EVERY path
  // (created / reused / updated): a reused class with a newly created table
  // was previously never rewired (review #12).
  if (tableUuid) {
    const id = madeClass.uuid.split(".").pop();
    let fresh = await classesPack.getDocument(id);
    if (fresh && fresh.system.classTalentTable !== tableUuid) {
      await fresh.update({ "system.classTalentTable": tableUuid });
      fresh = await classesPack.getDocument(id);
      if (fresh.system.classTalentTable !== tableUuid)
        report.warnings.push("classTalentTable did NOT persist on the class after a repair attempt — set it by hand and tell the maintainer.");
    }
  }

  // Spells and classes import in either order: drop the session class index so
  // this class resolves for any spell commit that follows, then retro-link
  // spells that were imported while this class didn't exist yet (their
  // system.class stayed empty — resolveSpellClass had nothing to point at).
  try {
    const { ClassIndex } = await import("./class-index.mjs");
    ClassIndex.invalidate();
    const { relinkSpellsToClasses } = await import("../items/item-importer.mjs");
    const relinked = await relinkSpellsToClasses();
    if (relinked) {
      report.relinkedSpells = relinked;
      ui.notifications?.info(`Linked ${relinked} already-imported spell(s) to their caster class.`);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | spell re-link after class import failed:`, err);
  }

  // A Wizard-variant borrower just appeared (or a plain caster whose variant
  // spells already exist) — stamp its uuid onto its list's spells so the
  // system level-up spellbook and the char-builder both offer exactly that
  // list. Import-order independent: also fires when the spells arrive later
  // (createItems) and once per GM ready.
  try {
    const tagged = await tagBorrowedSpellLists();
    if (tagged) {
      report.taggedBorrowedSpells = tagged;
      ui.notifications?.info(`Tagged ${tagged} spell(s) to a borrowed-list class.`);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | tagBorrowedSpellLists after class import failed:`, err);
  }

  report.classUuid = madeClass.uuid;
  report.tableUuid = tableUuid;
  return report;
}

/**
 * Merge a class SUPPLEMENT (parseClassSupplement output) onto an already-imported
 * Class item — the "stage 2" table imports pasted after the class body:
 *   • talentTable → builds outcome Talents + the RollTable, sets classTalentTable
 *   • titles      → system.titles
 *   • spellsKnown → system.spellcasting.spellsknown
 *   • extraTables → creates named RollTables (Corruption, …), links matching rows
 * Only the fields present in `sup` are touched; the rest of the class is left as-is.
 *
 * @param {string} targetClassUuid  the Class item to attach to (world.classes or a legacy pack)
 * @param {object} sup  { talentTable?, titles?, spellsKnown?, extraTables?, warnings? }
 * @param {object} opts { source, sourceTitle, overlay }
 * @returns {Promise<object|null>} report, or null when the target/suite is unusable
 */
export async function mergeClassSupplement(targetClassUuid, sup, { source = "", sourceTitle = "", overlay = null, allowInvalid = false } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import a class."); return null; }
  if (!targetClassUuid || !sup) { ui.notifications?.warn("Pick a class to attach these tables to."); return null; }
  const cls = await fromUuid(targetClassUuid).catch(() => null);
  if (!cls || cls.type !== "Class") { ui.notifications?.error("Attach-to class not found."); return null; }
  // Fail closed: writing a SPELLS KNOWN grid onto a class flagged NON-caster
  // (or any BLOCKER-tagged supplement warning) is refused without an explicit
  // override — the exact "warns then writes anyway" bug this replaces.
  const gateBlockers = supplementGateBlockers(cls.system?.spellcasting?.class, sup, cls.name);
  if (gateBlockers.length && !allowInvalid) return { blocked: true, name: cls.name, issues: gateBlockers };
  const { ensureSuite, ensureFolderPath } = await import("../../shared/compendium-suite.mjs");
  const suite = await ensureSuite();
  if (!suite?.talents || !suite?.tables) { ui.notifications?.error("Suite packs unavailable."); return null; }
  const talentsPack = suite.talents, tablesPack = suite.tables;

  const report = { created: [], reused: [], updated: [], systemReuse: [], warnings: [...(sup.warnings ?? [])] };
  // Surface a gate blocker in the report when the user chose to override, so the
  // "review notes" record what was forced through — but only the GENERATED ones
  // (e.g. the not-a-caster message), never a blocker already carried in
  // sup.warnings, or it would be listed twice and inflate the note count.
  for (const b of gateBlockers) {
    if (!report.warnings.some((w) => classGateBlockers([w])[0] === b)) report.warnings.push(`BLOCKER: ${b}`);
  }
  const sysTalents = _systemIndex("Item", "shadowdark.talents");
  // Reuse the class's own source title/slug when the paste didn't set one.
  const srcTitle = sourceTitle || cls.system?.source?.title || "";

  // Named extra tables (a CORRUPTION block pasted alone or alongside a talent
  // table) — create them first, then link the talent rows that reference them.
  const extraTableRefs = await buildExtraTables(
    { name: cls.name, extraTables: sup.extraTables ?? [], talentTable: sup.talentTable },
    { tablesPack, talentsPack, sourceTitle: srcTitle, overlay, source, report, ensureFolderPath });

  const update = {};
  if (sup.talentTable) {
    const parsedLike = { name: cls.name, talentTable: sup.talentTable };
    const tableUuid = await buildClassTalentTable(parsedLike, {
      talentsPack, tablesPack, sysTalents, sourceTitle: srcTitle, source, overlay, report, ensureFolderPath, extraTableRefs,
    });
    if (tableUuid) update["system.classTalentTable"] = tableUuid;
  }
  if (sup.titles?.length) {
    update["system.titles"] = sup.titles.map((t) => ({
      from: Number(t.from) || 1, to: Number(t.to) || Number(t.from) || 1,
      lawful: t.lawful ?? "", chaotic: t.chaotic ?? "", neutral: t.neutral ?? "",
    }));
  }
  if (sup.spellsKnown?.length) {
    // The NON-caster + SPELLS KNOWN blocker is enforced above (fail-closed);
    // reaching here means either the class is a caster or the user overrode.
    update["system.spellcasting.spellsknown"] = Object.fromEntries(
      sup.spellsKnown.filter((r) => r.level >= 1 && r.level <= 10).map((r) => [
        String(r.level),
        Object.fromEntries([1, 2, 3, 4, 5].map((t) => [String(t), r.tiers[t - 1] || null])),
      ]));
  }

  if (Object.keys(update).length) {
    const fields = Object.keys(update);   // capture before update() injects _id
    await cls.update(update);
    report.updated.push({ name: cls.name, type: "Class", uuid: cls.uuid, fields });
    // Re-read repair (playbook §1 trap): classTalentTable has silently vanished before.
    if (update["system.classTalentTable"]) {
      const fresh = await fromUuid(cls.uuid).catch(() => null);
      if (fresh && fresh.system.classTalentTable !== update["system.classTalentTable"])
        report.warnings.push("classTalentTable did NOT persist on the class after merge — set it by hand and tell the maintainer.");
    }
  } else if (!extraTableRefs.length) {
    report.warnings.push("Nothing to merge — the paste had no talent table, titles, spells-known grid, or extra table.");
  }

  report.classUuid = cls.uuid;
  report.tableUuid = update["system.classTalentTable"] ?? "";
  return report;
}

/**
 * PURE. Classify how a parsed caster's spell list should be wired, before any
 * Foundry lookup. Distinguishes a Wizard-variant list (self-contained own-list
 * caster) from a full-class borrow (points at a lender class) from a plain
 * own-list caster.
 *
 * @param {object|null} spellcasting  parsed.spellcasting ({ ability, spellList,
 *                                     spellClass } | null)
 * @param {object} [variants]  SPELL_LIST_VARIANTS-shaped map (injectable for tests)
 * @returns {{kind:"none"|"variant"|"borrow"|"own", variant?:string, listName?:string}}
 *   none    — not a caster (spellcasting falsy)
 *   variant — Wizard-variant list; `variant` is its nickname ("druid"). Wire as
 *             a self-contained own-list caster + tag its spells to this class.
 *   borrow  — an explicit lender pick (spellClass set; listName null) OR a list
 *             naming a real class (`listName` = that name, to resolve). Point
 *             spellcasting.class at the lender.
 *   own     — a caster with no borrow signal (no spellList). Own list, own slug.
 */
export function classifySpellWiring(spellcasting, variants = SPELL_LIST_VARIANTS) {
  if (!spellcasting) return { kind: "none" };
  if (spellcasting.spellClass) return { kind: "borrow", listName: null };
  const listName = String(spellcasting.spellList ?? "").trim().toLowerCase();
  if (!listName) return { kind: "own" };
  if (variants[listName]) return { kind: "variant", variant: listName };
  return { kind: "borrow", listName };
}

/**
 * PURE. Which borrower-class uuids should be ADDED to one spell's system.class,
 * given the spell's current class links + alignment and the resolved borrower
 * targets. Keeps the lender link (never removes), never re-adds a uuid already
 * present. A spell qualifies for a target when its alignment matches the target
 * variant's alignment AND it already links one of the lender's uuids.
 *
 * @param {string[]|string} spellClass    the spell's system.class value
 * @param {string} spellAlignment         flags["shadowdark-extras"].alignment ("" = universal)
 * @param {Array<{borrowerUuid:string, alignment:string, lenderUuids:string[]}>} targets
 * @returns {string[]} borrower uuids to append (empty = no change)
 */
export function borrowedTagsForSpell(spellClass, spellAlignment, targets) {
  const cur = Array.isArray(spellClass) ? spellClass : (spellClass ? [spellClass] : []);
  const align = String(spellAlignment ?? "");
  const add = [];
  for (const t of targets ?? []) {
    const bu = t?.borrowerUuid;
    if (!bu || cur.includes(bu) || add.includes(bu)) continue;
    if (align !== String(t.alignment ?? "")) continue;
    const lenders = t.lenderUuids ?? [];
    if (!cur.some((u) => lenders.includes(u))) continue;
    add.push(bu);
  }
  return add;
}

/**
 * Stamp each Wizard-variant "borrowed list" caster class's uuid onto exactly its
 * variant's spells — the completion half of borrowed-variant caster wiring
 * (createClassUnit records the variant in flags[MODULE_ID].borrowedSpellList and
 * leaves spellcasting.class="" / own slug). A class like the Green Knight casts
 * the neutral Wizard (Druid) list; the system level-up spellbook
 * (CompendiumsSD.classSpellBook) has NO alignment filter, so it offers that list
 * only if the spells' system.class[] includes the borrower's uuid. This sweep
 * adds it to every suite spell whose lender-class link + alignment flag match
 * the borrower's variant, KEEPING the lender (Wizard) link so a real Wizard
 * still sees the spell and gatherSpellListCensus (class-link + alignment) still
 * counts it.
 *
 * Import-order independent, idempotent, silent when nothing to do. Fires from
 * createClassUnit (a borrower just appeared), createItems (its spells arrived),
 * and once per GM ready (self-heals existing worlds). Callers notify on > 0.
 *
 * @returns {Promise<number>} spells newly tagged
 */
export async function tagBorrowedSpellLists() {
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const spellsPack = findSuitePack("spells");
  if (!spellsPack) return 0;

  // Class NAME → uuids (across every Item pack + world items), plus the list of
  // variant borrowers with their recorded variant nickname. A spell links to
  // "Wizard" by whichever Wizard uuid resolveSpellClass chose, so match by name.
  const uuidsByClassName = new Map();   // lowercased class name → Set<uuid>
  const borrowers = [];                 // { uuid, variant }
  const noteClass = (name, uuid, flags) => {
    const key = String(name ?? "").trim().toLowerCase();
    if (key && uuid) (uuidsByClassName.get(key) ?? uuidsByClassName.set(key, new Set()).get(key)).add(uuid);
    const variant = String(flags?.[MODULE_ID]?.borrowedSpellList ?? "").trim().toLowerCase();
    if (uuid && SPELL_LIST_VARIANTS[variant]) borrowers.push({ uuid, variant });
  };
  for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
    let idx;
    try { idx = await pack.getIndex({ fields: ["type", `flags.${MODULE_ID}.borrowedSpellList`] }); } catch { continue; }
    for (const e of idx) if (e.type === "Class") noteClass(e.name, e.uuid, e.flags);
  }
  for (const i of game.items) if (i.type === "Class") noteClass(i.name, i.uuid, i.flags);
  if (!borrowers.length) return 0;

  // variant → { casterClass, alignment } → the lender's concrete uuids.
  const targets = borrowers.map(({ uuid, variant }) => {
    const meta = SPELL_LIST_VARIANTS[variant];
    return {
      borrowerUuid: uuid,
      alignment: meta.alignment,
      lenderUuids: [...(uuidsByClassName.get(meta.casterClass.toLowerCase()) ?? [])],
    };
  }).filter((t) => t.lenderUuids.length);   // no lender in this world → nothing to match yet
  if (!targets.length) return 0;

  const getProp = foundry.utils.getProperty;
  const idx = await spellsPack.getIndex({ fields: ["type", "system.class", "flags.shadowdark-extras.alignment"] });
  const updates = [];
  for (const e of idx) {
    if (e.type !== "Spell") continue;
    const add = borrowedTagsForSpell(getProp(e, "system.class"), getProp(e, "flags.shadowdark-extras.alignment") ?? "", targets);
    if (!add.length) continue;
    const raw = getProp(e, "system.class");
    const cur = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    updates.push({ _id: e._id, "system.class": [...cur, ...add] });
  }
  if (!updates.length) return 0;
  if (spellsPack.locked) { try { await spellsPack.configure({ locked: false }); } catch (_) {} }
  await Item.updateDocuments(updates, { pack: spellsPack.collection });
  console.log(`${MODULE_ID} | tagBorrowedSpellLists: tagged ${updates.length} spell(s) to a borrowed-list class`);
  // Open char-builder / hub instances drop caches + re-render (gap→have flips).
  Hooks.callAll(`${MODULE_ID}.contentUnlocked`);
  return updates.length;
}

// ─── Internal exports for tests (pure helpers only) ──────────────────────────

export const _internals = { _deepEq, _subsetEq, _staleFields, _effectShape, classifySpellWiring, borrowedTagsForSpell };
