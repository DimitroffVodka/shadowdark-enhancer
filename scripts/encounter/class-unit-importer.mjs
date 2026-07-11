/**
 * Shadowdark Enhancer — Class unit importer (Foundry-bound)
 *
 * Turns a parseClassSection() unit into real documents, in dependency order:
 *   1. outcome/option Talents for the talent-table rows — reusing
 *      shadowdark.talents docs by name wherever the system already ships the
 *      effect (those carry working ActiveEffects; ours would be inert copies)
 *   2. fixed feature Talents (incl. a Spellcasting enabler cloned from the
 *      system's "Spellcasting (Wizard)" with the class's own slug)
 *   3. the 2d6 class-talent RollTable (choice rows = same-range multi-results:
 *      text "Choose 1" + one document result per option)
 *   4. the Class item wiring talents + classTalentTable + languages + wield
 *      lists (weapons/armor resolved BY NAME from shadowdark.gear)
 *
 * Shapes and traps follow .planning/CLASS-AUTHORING-PLAYBOOK.md — notably the
 * classTalentTable re-read (the field silently vanished once on Delver) and
 * v14 TableResult text living in `name`.
 *
 * Idempotent: same-named docs already in the suite packs are reused, never
 * duplicated (mirrors importSealedPayload).
 */

import { MODULE_ID } from "../module-id.mjs";
import { escapeHtml } from "./pdf-text-utils.mjs";

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

/** Find-or-create one Item in the suite pack, foldered. → {uuid, name, reused} */
async function _ensureItem(pack, data, folderPath, report) {
  const { ensureFolderPath, cleanImportHtml } = await import("./compendium-suite.mjs");
  // Commit choke point: sanitize persisted HTML (review #1).
  if (data.system?.description) data.system.description = cleanImportHtml(data.system.description);
  const idx = await pack.getIndex({ fields: ["type"] });
  const existing = idx.find((e) => e.name === data.name && e.type === data.type);
  if (existing) {
    const uuid = `Compendium.${pack.collection}.Item.${existing._id}`;
    report.reused.push({ name: data.name, type: data.type, uuid });
    return { uuid, name: data.name, reused: true };
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
  const made = await _ensureItem(pack, _talentData(label, `<p>${label}</p>`, sourceTitle),
    ["Level", className], report);
  if (!made.reused && /[+-]\d/.test(label))
    report.warnings.push(`"${label}" looks numeric but has no system twin — add its ActiveEffect by hand (playbook §2).`);
  return made.uuid;
}

/**
 * Create/reuse every document for one parsed class unit.
 * @param {object} parsed  parseClassSection() output
 * @param {object} opts    { source: "Western Reaches", sourceTitle: "western-reaches" }
 * @returns {Promise<object>} report { created, reused, systemReuse, warnings, classUuid, tableUuid }
 */
export async function createClassUnit(parsed, { source = "", sourceTitle = "", overlay = null } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import a class."); return null; }
  const { ensureSuite, ensureFolderPath } = await import("./compendium-suite.mjs");
  const suite = await ensureSuite();
  if (!suite?.items || !suite?.tables) { ui.notifications?.error("Suite packs unavailable."); return null; }
  const itemsPack = suite.items, tablesPack = suite.tables;

  const report = { created: [], reused: [], systemReuse: [], warnings: [...(parsed.warnings ?? [])] };
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

  // ── 1. Talent-table outcome docs ──
  const rowResults = [];   // per row: { range, uuids: [], chooseText? }
  const allOptionUuids = new Set();
  for (const row of parsed.talentTable?.rows ?? []) {
    const range = [row.lo, row.hi];
    if (row.kind === "grand") { rowResults.push({ range, grand: true, text: row.text }); continue; }
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
        pack: itemsPack, sysTalents, sourceTitle, className: parsed.name, report, queue,
      }));
    uuids.forEach((u) => allOptionUuids.add(u));
    rowResults.push({ range, uuids, choose: row.kind === "choice" });
  }

  // ── 2. Fixed feature Talents (+ Spellcasting enabler) ──
  const featureUuids = [];
  for (const f of parsed.features) {
    if (!String(f.name ?? "").trim()) continue;   // blank preview rows
    const wired = overlay?.features
      ? Object.entries(overlay.features).find(([k]) => k.toLowerCase() === f.name.toLowerCase())?.[1] ?? null
      : null;
    const made = await _ensureItem(itemsPack,
      _talentData(f.name, f.description, sourceTitle,
        { talentClass: wired?.talentClass ?? "class", effects: wired?.effects ?? [] }),
      ["Class", parsed.name], report);
    featureUuids.push(made.uuid);
  }
  // Borrowed spell list (Knight of St. Ydris → Witch pattern): resolve the
  // preview's pick, or fall back to the parsed "casts wizard spells" name.
  let spellClass = parsed.spellcasting?.spellClass ?? null;
  if (parsed.spellcasting && !spellClass && parsed.spellcasting.spellList) {
    const hit = _systemIndex("Item", "shadowdark.classes")
      .find((e) => e.name.toLowerCase() === parsed.spellcasting.spellList);
    if (hit) spellClass = { uuid: hit.uuid, name: hit.name, slug: hit.name.slugify?.() ?? _norm(hit.name).replace(/ /g, "-") };
    else report.warnings.push(`Spell list "${parsed.spellcasting.spellList}" didn't match an existing caster class — the class keeps its own list; pick the lender in the preview or set spellcasting.class by hand.`);
  }

  if (parsed.spellcasting) {
    const ownSlug = parsed.name.slugify?.() ?? _norm(parsed.name).replace(/ /g, "-");
    // The enabler registers the slug of the class whose LIST is cast from —
    // the lender's when borrowing (probed: Knight of St. Ydris adds "witch").
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
      const made = await _ensureItem(itemsPack, data, ["Class", parsed.name], report);
      featureUuids.push(made.uuid);
    } else {
      report.warnings.push("System 'Spellcasting (Wizard)' talent not found — create the casting-enabler talent by hand (playbook: Spellcaster wiring).");
    }
  }

  // ── 3. Class-talent RollTable (same-range multi-results for choices) ──
  let tableUuid = "";
  if (parsed.talentTable && rowResults.length) {
    // The class sheet's "Class Talents Table" dropdown lists RollTables whose
    // name matches /class\s+talents/i (probed from CompendiumsSD
    // .classTalentTables) and displays them with the "Class Talents: " prefix
    // stripped — so this exact format is required, no source prefix.
    const tblName = `Class Talents: ${parsed.name}`;
    const tIdx = await tablesPack.getIndex();
    const tExisting = tIdx.find((e) => e.name === tblName);
    if (tExisting) {
      tableUuid = `Compendium.${tablesPack.collection}.RollTable.${tExisting._id}`;
      report.reused.push({ name: tblName, type: "RollTable", uuid: tableUuid });
    } else {
      // "Distribute to Stats"-style system table for the row-12 grand choice.
      const sysTables = _systemIndex("RollTable");
      const distribute = sysTables.find((e) => /distribute/i.test(e.name)) ?? null;
      const results = [];
      const uuidName = new Map([...report.created, ...report.reused].map((c) => [c.uuid, c.name]));
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
      const folder = await ensureFolderPath(tablesPack, ["Class Talents"]);
      const table = await RollTable.create({
        name: tblName, formula: parsed.talentTable.formula, folder,
        description: "Rolled on level up. A roll that matches multiple results is a pick — see the class rules for special duplicates.",
        results,
        flags: { [MODULE_ID]: { imported: true, ...(source ? { source } : {}) } },
      }, { pack: tablesPack.collection });
      tableUuid = table.uuid;
      report.created.push({ name: table.name, type: "RollTable", uuid: table.uuid });
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

  const classData = {
    name: parsed.name, type: "Class", img: "icons/skills/trades/academics-book-study-runes.webp",
    system: {
      description: (parsed.flavor ?? "") + parsed.features.map((f) => `<p><strong>${escapeHtml(f.name)}.</strong></p>${f.description}`).join(""),
      hitPoints: parsed.hitPoints,
      allWeapons: parsed.allWeapons, allMeleeWeapons: parsed.allMeleeWeapons,
      allRangedWeapons: parsed.allRangedWeapons, allArmor: parsed.allArmor,
      weapons: resolveGear(weaponNames, "Weapon"),
      armor: resolveGear(armorNames, "Armor"),
      languages: parsed.languages,
      talents: featureUuids,
      talentChoiceCount: 0,
      classTalentTable: tableUuid,
      classAbilities: [], talentChoices: [],
      patron: { required: false, startingBoons: 0 },
      spellcasting: {
        ability: parsed.spellcasting?.ability ?? "",
        baseDifficulty: 10,
        // "" = casts its own list; a class UUID = borrows that class's list
        // (probed from the system's Knight of St. Ydris → Witch).
        class: parsed.spellcasting ? (spellClass?.uuid ?? "") : "__not_spellcaster__",
        // System shape (probed from shadowdark.classes Wizard, SD 4.x):
        // { "<level>": { "1": n|null … "5": n|null } }, null for "—".
        ...(parsed.spellcasting && (parsed.spellsKnown ?? []).length ? {
          spellsknown: Object.fromEntries(
            parsed.spellsKnown.filter((r) => r.level >= 1 && r.level <= 10).map((r) => [
              String(r.level),
              Object.fromEntries([1, 2, 3, 4, 5].map((t) => [String(t), r.tiers[t - 1] || null])),
            ])),
        } : {}),
      },
      titles: (parsed.titles ?? []).map((t) => ({
        from: Number(t.from) || 1, to: Number(t.to) || Number(t.from) || 1,
        lawful: t.lawful ?? "", chaotic: t.chaotic ?? "", neutral: t.neutral ?? "",
      })),
      source: { title: sourceTitle },
    },
    // classFlags: SDE-original class metadata (e.g. fixedDeity → DeityStep pin)
    flags: { [MODULE_ID]: { imported: true, ...(overlay?.classFlags ?? {}) } },
  };
  const madeClass = await _ensureItem(itemsPack, classData, ["Classes"], report);

  // TRAP (playbook §1): classTalentTable silently vanished once — re-read the
  // pack copy and repair if the field didn't persist.
  if (tableUuid && !madeClass.reused) {
    const id = madeClass.uuid.split(".").pop();
    let fresh = await itemsPack.getDocument(id);
    if (fresh && fresh.system.classTalentTable !== tableUuid) {
      await fresh.update({ "system.classTalentTable": tableUuid });
      fresh = await itemsPack.getDocument(id);
      if (fresh.system.classTalentTable !== tableUuid)
        report.warnings.push("classTalentTable did NOT persist on the class after a repair attempt — set it by hand and tell the maintainer.");
    }
  }

  report.classUuid = madeClass.uuid;
  report.tableUuid = tableUuid;
  return report;
}
