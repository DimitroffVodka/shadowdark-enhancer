/**
 * Shadowdark Enhancer — Sealed Content
 *
 * Ships finished, verified content documents inside the module WITHOUT
 * shipping readable rules text: each unit (a class + its talents + tables)
 * is AES-GCM encrypted with a key derived from anchor phrases of the book
 * section it came from. Pasting that section proves ownership: the anchors
 * are located in the normalized paste (the module stores only their hashes
 * and token lengths), the key is derived from the paste's own words, and the
 * pre-authored documents decrypt and import with links remapped.
 *
 * See .planning/CHAR-CONTENT-UNLOCK-SPEC.md ("sealed content" pivot).
 *
 * Payload doc conventions:
 *   - intra-unit links are "@@LOCAL:<index>@@" tokens (index into payload.docs)
 *   - system-compendium links (shadowdark.*) are kept literal — those uuids
 *     are identical in every world.
 */

import { MODULE_ID } from "../module-id.mjs";

/** Registry of sealed units shipped under data/locked/. Metadata only. */
export const SEALED_UNITS = [];
// DE-SEALED 2026-07-10: all 69 units converted to parse-and-author.
// Classes → class-overlays.mjs; tables → table-structure-seeds.mjs +
// applyTableStructureSeed; monsters/spells/gear/backgrounds/ancestries →
// their existing parsers (statblock/spell/item/char-content). Blobs archived
// in .planning/sealed-archive/ (dev-only). The unseal/seal helpers below stay
// for dev use against archived blobs; nothing ships in data/locked/.

/** Lowercase, strip everything but letters/digits, collapse spaces. */
export function normalizeKeyText(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function _aesKey(material, usage) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [usage]);
}

const _b64 = (u8) => {
  // Chunked to avoid a call-stack overflow from spreading a large payload into
  // String.fromCharCode (big units — e.g. the 22-table core encounter set — blow
  // the stack otherwise). 0x8000-byte windows keep each apply() call safe.
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const _unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Locate the unit's anchors inside a paste. The module knows only each
 * anchor's token length + hash; we slide a token window over the normalized
 * paste and hash candidates. Returns { found, total, material } — material
 * (the recovered plaintext anchors, joined) only when all are found.
 */
export async function findAnchors(unit, pasteText) {
  const tokens = normalizeKeyText(pasteText).split(" ");
  const recovered = [];
  let found = 0;
  for (const a of unit.anchors) {
    let hit = null;
    for (let i = 0; i + a.len <= tokens.length; i++) {
      const cand = tokens.slice(i, i + a.len).join(" ");
      // eslint-disable-next-line no-await-in-loop
      if (await _sha256Hex(cand) === a.hash) { hit = cand; break; }
    }
    if (hit) { found++; recovered.push(hit); } else recovered.push(null);
  }
  return { found, total: unit.anchors.length, material: found === unit.anchors.length ? recovered.join("|") : null };
}

/** Try to decrypt a unit with a paste. → { ok, payload?, found, total } */
export async function tryUnseal(unit, pasteText) {
  const { found, total, material } = await findAnchors(unit, pasteText);
  if (!material) return { ok: false, found, total };
  try {
    // .enc files are base64 text (repo-friendly); iv is the first 12 bytes.
    const u8 = _unb64((await (await fetch(unit.file)).text()).trim());
    const iv = u8.slice(0, 12);
    const key = await _aesKey(material, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, u8.slice(12));
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(plain)), found, total };
  } catch (err) {
    console.error(`${MODULE_ID} | unseal ${unit.id} failed:`, err);
    return { ok: false, found, total, error: "decrypt" };
  }
}

/**
 * DEV: seal a payload. anchors = plaintext phrases (normalized internally).
 * Returns { encBase64, anchorsMeta } — write the file + registry entry by hand.
 */
export async function sealUnit(payload, anchorPhrases) {
  const norm = anchorPhrases.map(normalizeKeyText);
  const anchorsMeta = [];
  for (const a of norm) anchorsMeta.push({ len: a.split(" ").length, hash: await _sha256Hex(a) });
  const material = norm.join("|");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _aesKey(material, "encrypt");
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + enc.length);
  out.set(iv); out.set(enc, iv.length);
  return { encBase64: _b64(out), anchorsMeta };
}

/** Compendium folder path ("Class/Roustabout") for a live doc, or null. */
function _sealFolderPath(doc) {
  const pack = doc.compendium ?? game.packs.get(doc.pack);
  let fid = doc.folder?.id ?? doc.folder ?? null;
  const parts = [];
  while (fid && pack) {
    const f = pack.folders.get(fid);
    if (!f) break;
    parts.unshift(f.name);
    fid = f.folder?.id ?? f.folder ?? null;
  }
  return parts.length ? parts.join("/") : null;
}

const _WORLD_REF = /Compendium\.world\.[\w-]+\.[A-Za-z]+\.[A-Za-z0-9]{16}/g;

/**
 * DEV: capture a unit's CURRENT live docs into a seal payload. Starts from
 * `roots` (uuids — usually a class), follows every world-pack reference to a
 * transitive closure, then topologically sorts so a referenced doc always
 * precedes its referencer (import creates in order, remapping @@LOCAL tokens as
 * uuids become known). Intra-unit refs → @@LOCAL:n@@; system/other refs stay
 * literal. Folder paths are captured from the live structure. Pass
 * `bundleSpellsForClass` (a class uuid) to also pull in every world.spells doc
 * that lists that class — spells reference the class, not vice-versa, so they
 * aren't reachable by traversal (Necromancer's own list; Green Knight's druid
 * list). Returns { docs } for sealUnit — never leaves prose in the caller.
 */
export async function captureUnitPayload({ roots = [], bundleSpellsForClass = null, rootsOnly = false } = {}) {
  // Accept suite-pack refs (Compendium.world.*) AND bare world-directory roots
  // (e.g. "RollTable.<16id>" from game.tables — some curated core tables live
  // there, not in a pack). Never matches system packs (Compendium.shadowdark.*),
  // so traversal/roots stay scoped to the user's own content.
  const isWorld = (u) => typeof u === "string" &&
    (/^Compendium\.world\./.test(u) || /^[A-Z][A-Za-z]+\.[A-Za-z0-9]{16}$/.test(u));
  const docs = new Map();       // uuid -> live doc
  const refs = new Map();       // uuid -> Set(world refs inside it)
  const queue = [...roots];
  if (bundleSpellsForClass) {
    // Spells live in the sde-items suite pack (type:"Spell"), not a dedicated
    // "world.spells" collection — the old hardcoded pack no longer exists.
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-items") ?? game.packs.get("world.spells");
    for (const s of (pack ? await pack.getDocuments() : [])) {
      if (s.type !== "Spell") continue;
      let c = s.system.class; c = Array.isArray(c) ? c : (c ? [c] : []);
      if (c.includes(bundleSpellsForClass)) queue.push(s.uuid);
    }
  }
  while (queue.length) {
    const u = queue.shift();
    if (!isWorld(u) || docs.has(u)) continue;
    // eslint-disable-next-line no-await-in-loop
    const d = await fromUuid(u).catch(() => null);
    if (!d) continue;
    docs.set(u, d);
    const found = new Set();
    // rootsOnly: capture just the given docs, don't follow world refs. Needed
    // for spell units — a spell references its class(es), and traversal would
    // otherwise pull the whole (separately-sealed) class into the spell unit.
    if (!rootsOnly) for (const m of JSON.stringify(d.toObject()).matchAll(_WORLD_REF)) { found.add(m[0]); queue.push(m[0]); }
    refs.set(u, found);
  }

  // Topological order (refs first). A cycle just stops recursing — import's
  // token remap tolerates a not-yet-created target by leaving it empty.
  const inSet = new Set(docs.keys());
  const order = [];
  const state = new Map();
  const visit = (u) => {
    if (state.get(u)) return;                 // visiting(1) or done(2)
    state.set(u, 1);
    for (const r of (refs.get(u) || [])) if (inSet.has(r) && r !== u) visit(r);
    state.set(u, 2); order.push(u);
  };
  for (const u of docs.keys()) visit(u);

  const idx = new Map(order.map((u, i) => [u, i]));
  const out = [];
  for (const u of order) {
    const d = docs.get(u);
    const data = d.toObject();
    for (const k of ["_id", "_stats", "ownership", "sort", "folder"]) delete data[k];
    let json = JSON.stringify(data);
    for (const [refU, refI] of idx) if (refU !== u) json = json.split(refU).join(`@@LOCAL:${refI}@@`);
    const kind = d.documentName === "RollTable" ? "RollTable"
      : d.documentName === "Actor" ? "Actor" : "Item";
    out.push({ kind, data: JSON.parse(json), folder: _sealFolderPath(d) });
  }
  return { docs: out };
}

/** Rewrite "@@LOCAL:n@@" tokens using the created-uuid map. */
function _remap(value, uuids) {
  if (typeof value === "string") return value.replace(/@@LOCAL:(\d+)@@/g, (_, n) => uuids[Number(n)] ?? "");
  if (Array.isArray(value)) return value.map((v) => _remap(v, uuids));
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = _remap(v, uuids);
    return o;
  }
  return value;
}

/**
 * Import an unsealed payload: create docs in dependency order (payload.docs
 * are topologically ordered at seal time), remapping local links as uuids
 * become known. Items → sde-items pack, RollTables → sde-tables pack (with
 * folder). Returns created doc uuids.
 */
/**
 * Item document type → suite pack descriptor id. Character-builder content is
 * routed to its own pack (mirroring the reorg'd world); gear (Basic/Weapon/
 * Armor/…) falls back to sde-items.
 */
const SEALED_ITEM_PACK = {
  Class: "classes",
  Talent: "talents",
  "Class Ability": "class-abilties",
  Spell: "spells",
  Background: "background",
  Ancestry: "ancestries",
  Patron: "patrons-and-deities",
  Deity: "patrons-and-deities",
};

export async function importSealedPayload(payload) {
  const { ensureSuite, findSuitePack } = await import("./compendium-suite.mjs");
  await ensureSuite();
  const itemPack = findSuitePack("sde-items") ?? game.packs.get("world.shadowdark-enhancer--items");
  const tablePack = findSuitePack("sde-tables") ?? game.packs.get("world.shadowdark-enhancer--roll-tables");
  const actorPack = findSuitePack("sde-actors") ?? game.packs.get("world.shadowdark-enhancer--actors");
  // Route an Item to its type-specific pack (falls back to sde-items for gear).
  const packForItem = (type) => (SEALED_ITEM_PACK[type] && findSuitePack(SEALED_ITEM_PACK[type])) || itemPack;
  const uuids = [];
  const created = [];
  // Folder paths ("Talents/Class") recreate the user's compendium taxonomy —
  // documents are NEVER left at pack root (standing user directive).
  const ensureFolder = async (pack, path, type) => {
    let parent = null;
    for (const part of String(path).split("/")) {
      let fo = pack.folders.find((x) => x.name === part && (x.folder?.id ?? null) === (parent?.id ?? null));
      if (!fo) fo = await Folder.create({ name: part, type, folder: parent?.id ?? null }, { pack: pack.collection });
      parent = fo;
    }
    return parent;
  };
  for (const entry of payload.docs) {
    const data = _remap(entry.data, uuids);
    // Idempotent: a doc of the same name/type already in the pack is reused,
    // so re-unlocks and units sharing docs (e.g. two classes, one weapon)
    // never duplicate.
    let doc;
    if (entry.kind === "Item") {
      const pack = packForItem(data.type);
      const idx = await pack.getIndex({ fields: ["type"] });
      const e = idx.find((x) => x.name === data.name && x.type === data.type);
      if (e) { uuids.push(`Compendium.${pack.collection}.Item.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      if (entry.folder) data.folder = (await ensureFolder(pack, entry.folder, "Item")).id;
      [doc] = await Item.createDocuments([data], { pack: pack.collection });
    } else if (entry.kind === "RollTable") {
      const idx = await tablePack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${tablePack.collection}.RollTable.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(tablePack, entry.folder, "RollTable")).id : null;
      [doc] = await RollTable.createDocuments([{ ...data, folder: folderId }], { pack: tablePack.collection });
    } else if (entry.kind === "Actor") {
      const idx = await actorPack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${actorPack.collection}.Actor.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(actorPack, entry.folder, "Actor")).id : null;
      [doc] = await Actor.createDocuments([{ ...data, folder: folderId }], { pack: actorPack.collection });
    }
    uuids.push(doc?.uuid ?? "");
    created.push({ kind: entry.kind, name: doc?.name, uuid: doc?.uuid });
  }
  return created;
}

/** Sealed unit matching a manifest/census entry: by name, or by a set-level
 *  unit covering the entry's document type (e.g. any Background → the full
 *  backgrounds set). */
export function sealedUnitFor(name, type = null) {
  return SEALED_UNITS.find((u) => u.anchors.length && u.name.toLowerCase() === String(name).toLowerCase())
    ?? (type ? SEALED_UNITS.find((u) => u.anchors.length && u.coversType === type) ?? null : null);
}

/**
 * Ordered candidate units for a census/manifest entry — a paste is tried
 * against each until one unseals. Handles MULTIPLE set-level units of the same
 * type (e.g. per-book Spell units CS4/CS5/CS6/WR) that `sealedUnitFor` can't
 * disambiguate: exact name (classes) → same coversType AND same source (the
 * right book) → same coversType any source (single-set types / src fallback).
 * The anchors guarantee correctness — only the matching book's paste satisfies
 * a unit's phrases — so trying extra candidates is safe.
 */
export function sealedUnitsFor({ name = "", type = null, source = null } = {}) {
  const live = SEALED_UNITS.filter((u) => u.anchors.length);
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };
  // coversType may be a single type or an array (e.g. wr-gear covers Basic/Weapon/Armor).
  const covers = (u, t) => Array.isArray(u.coversType) ? u.coversType.includes(t) : u.coversType === t;
  push(live.find((u) => u.name.toLowerCase() === String(name).toLowerCase()));
  if (type) {
    if (source) for (const u of live) if (covers(u, type) && u.source === source) push(u);
    for (const u of live) if (covers(u, type)) push(u);
  }
  return out;
}
