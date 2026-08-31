import { MODULE_ID } from "../shared/module-id.mjs";
import { effectiveSource } from "../importer/monsters/actor-migration.mjs";
import { findMonsterPack } from "../importer/monsters/monster-pack.mjs";
import { isManagedActorPack } from "../importer/monsters/managed-actor-backfill.mjs";
import { MonsterTokenArt } from "./monster-token-art.mjs";
import { manualFolderPickPaths, normalizeTokenArtManagerState, tokenArtFolderSourceId } from "./token-art-manager-state.mjs";
import {
  CURATED_IMPORTED_MONSTER_ART,
  CURATED_IMPORTED_MONSTER_ART_STATUS,
  curatedImportedMonsterArtFor,
  importedMonsterArtDisposition,
  importedMonsterArtKey,
  planCuratedImportedMonsterArt,
} from "./imported-monster-art.mjs";

const PF_CHARACTER_GALLERY_ID = "pf2e-tokens-characters";
const PF_CHARACTER_GALLERY_LABEL = "Pathfinder: Character Gallery";
const PF_CHARACTER_GALLERY_CREDIT = "<em>Portrait, token, and subject artwork from the Pathfinder Tokens: Character Gallery.</em>";

/**
 * Token Art Catalog — discovers every art source that can skin the
 * `shadowdark.monsters` compendium and builds a per-monster options model.
 *
 * Two source kinds, unified:
 *  - "mapping": a package (module/system) that ships a Foundry compendium-art
 *    map for shadowdark (`flags.compendiumArtMappings.shadowdark.mapping`) — read
 *    directly from its file, so the source need not be *active* (e.g. Community
 *    Tokens, Paizo/pf2e-tokens). Keyed by monster id, presentation included.
 *  - "folder": an art module with no shadowdark map (e.g. the licensed Monster
 *    Manual) — matched to monster names via MonsterTokenArt, presentation from
 *    the module's own token-mapping.json.
 *
 * Nothing is copied: every path references files already on disk.
 */
export class TokenArtCatalog {
  /** F4's exact source-aware map, exposed for the manager and pure callers. */
  static CURATED_IMPORTED_MONSTER_ART = CURATED_IMPORTED_MONSTER_ART;
  static importedMonsterArtKey = importedMonsterArtKey;
  static curatedImportedMonsterArtFor = curatedImportedMonsterArtFor;

  /** Art modules that ship no shadowdark compendium map (matched by name). */
  static FOLDER_SOURCES = [
    {
      id: "dnd-monster-manual",
      label: "Monster Manual",
      tokenDir: "modules/dnd-monster-manual/assets/tokens",
      portraitDir: "modules/dnd-monster-manual/assets/portraits",
      subjectDir: "modules/dnd-monster-manual/assets/subjects",
      tokenMapping: "modules/dnd-monster-manual/token-mapping.json",
    },
    {
      // Same DnD-Beyond art pipeline as the Monster Manual (tokens/portraits/
      // subjects, ring-authored). Ships no token-mapping.json, so presentation
      // falls back to ring-on + scale 1. Mostly PC/class + a few beasts; useful
      // for the humanoid NPCs the Monster Manual doesn't cover.
      id: "dnd-players-handbook",
      label: "Player's Handbook",
      tokenDir: "modules/dnd-players-handbook/assets/tokens",
      portraitDir: "modules/dnd-players-handbook/assets/portraits",
      subjectDir: "modules/dnd-players-handbook/assets/subjects",
      tokenMapping: "modules/dnd-players-handbook/token-mapping.json",
    },
    {
      // Pathfinder Tokens: Character Gallery is optional and may be installed
      // while inactive. Static assets remain browseable in that state, so the
      // disk probe below intentionally does not inspect module.active.
      id: PF_CHARACTER_GALLERY_ID,
      label: PF_CHARACTER_GALLERY_LABEL,
      tokenDir: "modules/pf2e-tokens-characters/assets/tokens",
      portraitDir: "modules/pf2e-tokens-characters/assets/portraits",
      subjectDir: "modules/pf2e-tokens-characters/assets/subjects",
      tokenMapping: "modules/pf2e-tokens-characters/data/compendium-map.json",
      credit: PF_CHARACTER_GALLERY_CREDIT,
    },
  ];

  /**
   * Extra folder coverage for "mapping" sources: after the curated shadowdark
   * map, name-match the source's FULL token folder to fill monsters the map
   * doesn't cover (e.g. Paizo ships elf/soldier art it never maps to Shadowdark).
   * Presentation (ring/scale/subject) comes from the source's own token maps.
   */
  static MAPPING_FOLDERS = {
    "pf2e-tokens-monster-core": {
      tokenDir: "modules/pf2e-tokens-monster-core/assets/tokens",
      presentMaps: [
        "modules/pf2e-tokens-monster-core/image-mapping.json",
        "modules/pf2e-tokens-monster-core/assets/shadowdark-map.json",
      ],
    },
  };

  /** Default source priority when the user hasn't set one (ringed art first,
   *  Community last as the full-coverage fallback). Unknown/other sources sort
   *  after these in discovery order. */
  static DEFAULT_PRIORITY = [
    "dnd-monster-manual",
    "dnd-players-handbook",
    "pf2e-tokens-monster-core",
    PF_CHARACTER_GALLERY_ID,
    "dnd5e-fa",
    "shadowdark-community-tokens",
  ];

  /**
   * Shadowdark-original monsters that other packs only "match" via a loose,
   * wrong choice in their own curated maps (e.g. Paizo maps Rime Walker →
   * aeon-pleroma, Cave Brute → landslide). Default these to Community art, which
   * is the purpose-made Shadowdark art. An explicit per-monster override still
   * wins. Keyed by monster name.
   */
  static COMMUNITY_PINS = new Set([
    "Rime Walker",
    "Cave Brute",
    "Void Spawn",
    "Thug",
  ]);
  static COMMUNITY_SOURCE = "shadowdark-community-tokens";

  /**
   * A "filemap" source: an art folder tree with no shadowdark map (chiefly
   * dnd5e's bundled Forgotten Adventures set under systems/dnd5e/tokens/<type>/).
   * Files are browsed from disk and name-matched. The art is transparent
   * creature art that needs a scale to fill: use the module's own token map
   * (`scaleMap`) where a file is listed, else `defaultScale`. Shown flat (round
   * pre-bordered look; no dynamic ring).
   */
  static FILEMAP_SOURCES = [
    {
      id: "dnd5e-fa",
      label: "Forgotten Adventures (dnd5e)",
      tokenRoot: "systems/dnd5e/tokens",
      thumbDir: "thumbs",
      scaleMap: "systems/dnd5e/json/fa-token-mapping.json",
      probe: "systems/dnd5e/tokens",
      defaultScale: 1.5,
      credit: "<em>Token artwork by Forgotten Adventures.</em>",
    },
  ];

  /**
   * Browse roots + presentation for the manual image browser (buildLibrary).
   * Keyed by source id. Any installed `pf2e-tokens-*` module is ALSO auto-added
   * (buildLibrary probes common token roots), so these need only cover sources
   * with a bespoke layout. Each entry:
   *   label       display name shown as the browser group header
   *   root        folder to walk recursively for token images
   *   skipDir     subfolder name to skip (e.g. FA thumbnails)
   *   present     token-map JSON(s) → per-file ring/scale/subject presentation
   *   scaleMap    token-map JSON → per-file fill scale (FA transparent art)
   *   subjectDir  ring-subject art folder for a map-less DnD-Beyond source: any
   *               token with a same-named subject gets the dynamic ring + subject
   *   subjectScale ring-subject scale paired with subjectDir (else 1)
   *   defaultScale fallback scale when no map lists the file
   *   iconics     pf2e naming convention: browse only `Name.webp` tokens (skip
   *               `…Full`/`…Subject` variants), pair the portrait to `…Full`
   */
  static LIBRARY_DIRS = {
    "dnd-monster-manual": {
      label: "Monster Manual",
      root: "modules/dnd-monster-manual/assets/tokens",
      present: ["modules/dnd-monster-manual/token-mapping.json"],
    },
    "dnd-players-handbook": {
      // No token-mapping.json: enable the ring from the sibling subjects/ folder
      // and fill with the same DnD-Beyond scale target as the Monster Manual.
      label: "Player's Handbook",
      root: "modules/dnd-players-handbook/assets/tokens",
      subjectDir: "modules/dnd-players-handbook/assets/subjects",
      defaultScale: 1.45,
      subjectScale: 1.26,
    },
    [PF_CHARACTER_GALLERY_ID]: {
      label: PF_CHARACTER_GALLERY_LABEL,
      root: "modules/pf2e-tokens-characters/assets/tokens",
      present: ["modules/pf2e-tokens-characters/data/compendium-map.json"],
      subjectDir: "modules/pf2e-tokens-characters/assets/subjects",
      defaultScale: 1.0,
      subjectScale: 1.0,
      credit: PF_CHARACTER_GALLERY_CREDIT,
    },
    "pf2e-tokens-monster-core": {
      label: "Pathfinder: Monster Core",
      root: "modules/pf2e-tokens-monster-core/assets/tokens",
      present: [
        "modules/pf2e-tokens-monster-core/image-mapping.json",
        "modules/pf2e-tokens-monster-core/assets/shadowdark-map.json",
      ],
    },
    "dnd5e-fa": {
      label: "Forgotten Adventures",
      root: "systems/dnd5e/tokens",
      skipDir: "thumbs",
      scaleMap: "systems/dnd5e/json/fa-token-mapping.json",
      defaultScale: 1.5,
    },
    "shadowdark-community-tokens": {
      label: "Shadowdark Community Tokens",
      root: "modules/shadowdark-community-tokens",
    },
    // pf2e game SYSTEM: ships no monster tokens — only the 59 iconic PC /
    // companion portraits (Amiri, Ezren, Droogami…). Browser-only (never a
    // name-match source); useful for humanoid NPCs.
    "pf2e-iconics": {
      label: "Pathfinder Iconics (pf2e system)",
      root: "systems/pf2e/icons/iconics",
      flat: true,          // root holds 512² tokens; skip portraits/subjects/tokens subdirs
      iconics: true,
    },
  };

  /** Discover installed sources → [{ id, label, kind, mapping?, dirs..., credit }]. */
  static async discoverSources() {
    const sources = [];
    // Native compendium-art providers (read the file regardless of active state).
    for (const pkg of [game.system, ...game.modules]) {
      if (pkg.id === MODULE_ID) continue;                 // skip our own generated map
      const flag = pkg.flags?.compendiumArtMappings?.shadowdark;
      if (!flag?.mapping) continue;
      sources.push({ id: pkg.id, label: pkg.title ?? pkg.id, kind: "mapping", mapping: flag.mapping, credit: flag.credit });
    }
    // Folder sources present on disk.
    for (const fs of this.FOLDER_SOURCES) {
      const ok = await MonsterTokenArt.FilePickerCls.browse("data", fs.tokenDir)
        .then((b) => Array.isArray(b?.files) && b.files.length > 0)
        .catch(() => false);
      if (ok) sources.push({ ...fs, kind: "folder" });
    }
    // File-map sources (disk folder tree, no shadowdark map, matched by filename).
    for (const fs of this.FILEMAP_SOURCES) {
      const ok = await MonsterTokenArt.FilePickerCls.browse("data", fs.probe).then((b) => (b.dirs?.length || b.files?.length)).catch(() => false);
      if (ok) sources.push({ ...fs, kind: "filemap" });
    }
    return sources;
  }

  /** Browse a single folder level (no recursion) → Map(basename → full data
   *  path). Use for sources whose root holds the tokens but also has sibling
   *  subfolders (portraits/subjects/…) we must not pull in. */
  static async _browseFlatDir(dir) {
    const found = new Map();
    let res;
    try { res = await MonsterTokenArt.FilePickerCls.browse("data", dir); } catch (_e) { return found; }
    for (const f of Array.isArray(res?.files) ? res.files : []) {
      if (typeof f !== "string") continue;
      if (!/\.(webp|png|jpg|jpeg)$/i.test(f)) continue;
      const base = f.split("/").pop();
      if (!found.has(base)) found.set(base, f);
    }
    return found;
  }

  /** Browse a folder tree → Map(basename → full data path). Skips `skipDir`. */
  static async _browseTree(root, skipDir) {
    const found = new Map();
    const walk = async (dir) => {
      let res;
      try { res = await MonsterTokenArt.FilePickerCls.browse("data", dir); } catch (_e) { return; }
      for (const f of Array.isArray(res?.files) ? res.files : []) {
        if (typeof f !== "string") continue;
        if (!/\.(webp|png|jpg|jpeg)$/i.test(f)) continue;
        const base = f.split("/").pop();
        if (!found.has(base)) found.set(base, f);
      }
      for (const d of Array.isArray(res?.dirs) ? res.dirs : []) {
        if (typeof d !== "string") continue;
        if (skipDir && d.split("/").pop() === skipDir) continue;
        await walk(d);
      }
    };
    await walk(root);
    return found;
  }

  /** Load a token-map's per-file scale → Map(basename → scaleX). */
  static async _loadScaleMap(path) {
    const scales = new Map();
    if (!path) return scales;
    let json;
    try { json = await foundry.utils.fetchJsonWithTimeout(path); }
    catch (_e) { return scales; }
    for (const docs of Object.values(json)) {
      for (const v of Object.values(docs)) {
        const src = v?.token?.texture?.src;
        if (!src) continue;
        const file = src.split("/").pop();
        const s = v.token.texture.scaleX;
        if (s && !scales.has(file)) scales.set(file, s);
      }
    }
    return scales;
  }

  /**
   * File-map source → monsterId → art. Browses the whole token tree from disk
   * and name-matches (CamelCase-aware). The art is transparent creature art, so
   * it's shown flat with a fill scale: the source's own token map where a file
   * is listed, else `defaultScale`. Portrait falls back to the token image.
   */
  static async _filemapArt(source, monsters) {
    const art = {};
    const files = await this._browseTree(source.tokenRoot, source.thumbDir);
    if (!files.size) return art;
    const scales = await this._loadScaleMap(source.scaleMap);
    const def = source.defaultScale ?? 1;

    const M = MonsterTokenArt;
    const byNorm = new Map();
    for (const f of files.keys()) {
      const k = M._norm(M._deNum(M._slugOf(f)));
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(f);
    }
    const sets = { tokenFiles: new Set(files.keys()), portraitFiles: new Set(files.keys()), byNorm, subjectFiles: new Set(), present: {} };
    for (const m of monsters) {
      const a = M.resolveArt(m.name, sets, { tokenDir: "", portraitDir: "" });
      if (!a) continue;
      const path = files.get(a.file);
      if (!path) continue;
      const scale = scales.get(a.file) ?? def;
      art[m.id] = {
        token: path,
        portrait: path,
        tokenObj: { texture: { src: path, scaleX: scale, scaleY: scale } },
      };
    }
    return art;
  }

  /** Load one or more of a source's token maps → filename → {tokenObj, portrait}.
   *  Keeps only texture + ring (drops width/height so a monster's footprint is
   *  never resized). Earlier maps win on duplicate filenames. */
  static async _loadPresentMaps(paths) {
    const out = new Map();
    for (const p of paths ?? []) {
      let json;
      try { json = await foundry.utils.fetchJsonWithTimeout(p); }
      catch (_e) { continue; }
      if (!json || typeof json !== "object" || Array.isArray(json)) continue;
      for (const docs of Object.values(json)) {
        if (!docs || typeof docs !== "object" || Array.isArray(docs)) continue;
        for (const v of Object.values(docs)) {
          const texture = v?.token?.texture;
          const src = typeof texture?.src === "string" ? texture.src : null;
          if (!src) continue;
          const file = src.split("/").pop();
          if (!file || out.has(file)) continue;
          const tokenObj = { texture };
          if (v.token.ring && typeof v.token.ring === "object") tokenObj.ring = v.token.ring;
          const portrait = typeof v.actor === "string" ? v.actor : src;
          out.set(file, { tokenObj, portrait });
        }
      }
    }
    return out;
  }

  /** Name-match a mapping source's full token folder to fill monsters its
   *  shadowdark map didn't cover. Mutates `art` (curated entries win). */
  static async _folderGapFill(fcfg, monsters, art) {
    const files = await this._browseTree(fcfg.tokenDir);
    if (!files.size) return;
    const present = await this._loadPresentMaps(fcfg.presentMaps);
    const M = MonsterTokenArt;
    const byNorm = new Map();
    for (const f of files.keys()) {
      const k = M._norm(M._deNum(M._slugOf(f)));
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(f);
    }
    const sets = { tokenFiles: new Set(files.keys()), portraitFiles: new Set(files.keys()), byNorm, subjectFiles: new Set(), present: {} };
    for (const m of monsters) {
      if (art[m.id]) continue;                       // curated shadowdark map wins
      const a = M.resolveArt(m.name, sets, { tokenDir: "", portraitDir: "" });
      if (!a) continue;
      const p = present.get(a.file);
      const path = files.get(a.file);
      const tokenObj = p?.tokenObj ?? { texture: { src: path, scaleX: 1, scaleY: 1 } };
      const src = tokenObj.texture?.src ?? path;
      art[m.id] = { token: src, portrait: p?.portrait ?? src, tokenObj };
    }
  }

  /**
   * Per-source scale multiplier, applied to each token's own built-in scale so a
   * standard creature (Animated Armor) lands on the desired look while every
   * monster keeps its relative framing. Value is either a single factor (applied
   * to both the texture Scale-Ratio and the ring subject) or `{ tex, subject }`
   * for dynamic-ring sources that need the two tuned apart. Factor = target ÷ the
   * source's base scale. Targets (from a hand-tuned Animated Armor):
   *   Paizo  → Scale-Ratio 3 (base 2 → ×1.5), ring subject 2.5 (base 2 → ×1.25)
   *   Monster Manual → Scale-Ratio 1.45, ring subject 1.26 (base 1/1)
   *   Forgotten Adventures (flat) → 1.25 (base 1.5 → ×0.833)
   * Community is left alone. A source not listed keeps its built-in scale.
   */
  static SOURCE_SCALE = {
    "pf2e-tokens-monster-core": { tex: 3 / 2, subject: 2.5 / 2 },
    "dnd-monster-manual": { tex: 1.45 / 1, subject: 1.26 / 1 },
    "dnd-players-handbook": { tex: 1.45 / 1, subject: 1.26 / 1 },  // same DnD-Beyond pipeline as MM
    "dnd5e-fa": 1.25 / 1.5,
  };

  /** Return a copy of `tokenObj` with its texture Scale-Ratio and ring-subject
   *  scale multiplied — `factor` is a single number (both) or `{ tex, subject }`.
   *  Rounded to 3 decimals to avoid float noise; non-mutating, so shared token-map
   *  objects stay intact. */
  static _scaleTokenObj(tokenObj, factor) {
    if (!tokenObj || !factor) return tokenObj;
    const texF = typeof factor === "object" ? (factor.tex ?? 1) : factor;
    const subF = typeof factor === "object" ? (factor.subject ?? texF) : factor;
    if (texF === 1 && subF === 1) return tokenObj;
    const r = (n, f) => Math.round((n ?? 1) * f * 1000) / 1000;
    const out = { ...tokenObj };
    if (tokenObj.texture) out.texture = { ...tokenObj.texture, scaleX: r(tokenObj.texture.scaleX, texF), scaleY: r(tokenObj.texture.scaleY, texF) };
    if (tokenObj.ring?.subject) out.ring = { ...tokenObj.ring, subject: { ...tokenObj.ring.subject, scale: r(tokenObj.ring.subject.scale, subF) } };
    return out;
  }

  /** Build monsterId → { token, portrait, tokenObj } for one source. Scale comes
   *  from the source's own token maps, then SOURCE_SCALE proportionally adjusts it. */
  static async _sourceArt(source, monsters) {
    let art = {};
    if (source.kind === "mapping") {
      let json;
      try { json = await foundry.utils.fetchJsonWithTimeout(source.mapping); }
      catch (_e) { return art; }
      const tbl = json?.["shadowdark.monsters"] ?? {};
      for (const [id, v] of Object.entries(tbl)) {
        const src = v?.token?.texture?.src;
        if (!src) continue;
        art[id] = { token: src, portrait: v.actor ?? src, tokenObj: v.token };
      }
      // Fill gaps by name-matching the source's full token folder (if configured).
      const fcfg = this.MAPPING_FOLDERS[source.id];
      if (fcfg) await this._folderGapFill(fcfg, monsters, art);
    } else if (source.kind === "filemap") {
      art = await this._filemapArt(source, monsters);
    } else {
      const sets = await MonsterTokenArt.buildFileSets(source);
      if (!sets) return art;
      for (const m of monsters) {
        const a = MonsterTokenArt.resolveArt(m.name, sets, source);
        if (!a) continue;
        art[m.id] = { token: a.token, portrait: a.portrait, tokenObj: MonsterTokenArt._tokenArt(a.file, sets, source) };
      }
    }
    // Proportionally scale this source's tokens (preserves per-creature framing).
    const factor = this.SOURCE_SCALE[source.id];
    if (factor && factor !== 1) for (const a of Object.values(art)) a.tokenObj = this._scaleTokenObj(a.tokenObj, factor);
    return art;
  }

  /**
   * Build the full catalog:
   *   { sources: [{id,label,kind,credit,count}], byMonster: [{id,name,options:[{source,token,portrait,tokenObj}]}] }
   * `options` order follows the source-priority order.
   */
  static _monsterEntries(index, pack, { includeManagedTypes = false } = {}) {
    // `getIndex()` is normally an Array, but a Collection-shaped fixture (or a
    // future Foundry adapter) exposes the entries under `.contents`. Keep the
    // census boundary here so every covered pack contributes each allowed Actor
    // once. The optional managed-import boundary admits Mount forms only when
    // the caller has already proved the pack is one of our world packs.
    const entries = Array.isArray(index) ? index : (index?.contents ?? []);
    const seen = new Set();
    return entries.flatMap((e) => {
      const type = String(e?.type ?? "").trim().toLowerCase();
      const allowed = !type || type === "npc"
        || (includeManagedTypes && (type === "mount" || type === `${MODULE_ID}.mount`));
      if (!e?._id || !e.name || !allowed || seen.has(e._id)) return [];
      seen.add(e._id);
      return [{ id: e._id, name: e.name, pack }];
    });
  }

  /**
   * Carry N6's final curation decision alongside a managed imported row. The
   * ordinary options remain intact for Browse and deliberate source choices;
   * `resolve()` uses this status only to decide whether an automatic fallback
   * is allowed. A curated row is available only when both reviewed paths are
   * represented by one exact catalog option. If that option disappears while a
   * fuzzy alternative remains, the row becomes Browse-only until the GM picks.
   */
  static _curatedImportedArtStatus(monster, options) {
    if (!monster?.managedImported) return null;
    const key = importedMonsterArtKey(monster.source, monster.name);
    const disposition = importedMonsterArtDisposition(monster.source, monster.name);
    if (!key || !disposition) return null;
    if (disposition === CURATED_IMPORTED_MONSTER_ART_STATUS.UNMATCHED) {
      return { key, status: CURATED_IMPORTED_MONSTER_ART_STATUS.UNMATCHED };
    }

    const row = curatedImportedMonsterArtFor(monster.source, monster.name);
    const exact = (options ?? []).some((entry) =>
      entry?.source === row?.source
      && entry?.token === row?.token
      && entry?.portrait === row?.portrait);
    return {
      key,
      status: exact
        ? CURATED_IMPORTED_MONSTER_ART_STATUS.CURATED
        : CURATED_IMPORTED_MONSTER_ART_STATUS.PATH_UNAVAILABLE,
    };
  }

  /**
   * Load the managed imported NPCs with their source-bearing documents intact.
   * The public catalog intentionally stays an index-shaped `{id,name,pack}`
   * model, while F4 needs the full Actor to read `effectiveSource()` and must
   * not infer source from a Core/world row or a bare name.
   */
  static async _managedImportedMonsterRecords(pack) {
    let documents;
    if (typeof pack?.getDocuments === "function") documents = await pack.getDocuments();
    else if (typeof pack?.getIndex === "function") documents = await pack.getIndex();
    else documents = [];

    const entries = Array.isArray(documents) ? documents : (documents?.contents ?? []);
    const indexEntries = entries.map((document) => document?._id
      ? document
      : { ...document, _id: document?.id });
    const rows = this._monsterEntries(indexEntries, pack.collection, {
      includeManagedTypes: isManagedActorPack(pack),
    });
    const byId = new Map(entries.map((document) => [String(document?._id ?? document?.id ?? ""), document]));

    return rows.map((row) => {
      const document = byId.get(String(row.id));
      const source = effectiveSource(document) ?? document?.folder?.name ?? null;
      return { ...row, source, document, managedImported: true };
    });
  }

  /** Whether one exact data-root path was returned by a FilePicker browse. */
  static _listedExactPath(result, path) {
    const wanted = String(path ?? "");
    const file = wanted.split("/").pop();
    return !!file && (result?.files ?? []).some((candidate) => {
      const value = String(candidate ?? "");
      return value === wanted || value === file;
    });
  }

  /**
   * FilePicker fallback for a curated path which is not represented by the
   * browser's basename map (Community Tokens has token/portrait siblings with
   * the same basename). Exact parent-directory browsing keeps that case
   * source-safe and avoids constructing a path from a fuzzy match.
   */
  static async _hasExactCuratedPath(path) {
    const wanted = String(path ?? "");
    const slash = wanted.lastIndexOf("/");
    const FP = globalThis.foundry?.applications?.apps?.FilePicker?.implementation
      ?? globalThis.FilePicker;
    if (slash < 1 || !FP?.browse) return false;
    try {
      const result = await FP.browse("data", wanted.slice(0, slash));
      return this._listedExactPath(result, wanted);
    } catch (_e) {
      return false;
    }
  }

  /**
   * Resolve one N6 row by exact source + token + portrait paths. `library` is
   * normally the disk-backed buildLibrary result; its entries already came
   * from FilePicker and therefore validate both paths. A direct browse handles
   * a same-basename token/portrait pair that buildLibrary's basename map can
   * only retain one of.
   */
  static async _resolveCuratedImportedMonsterArt(row, library, pathExists) {
    const exact = (library ?? []).find((entry) =>
      entry?.source === row.source && entry.token === row.token && entry.portrait === row.portrait);
    const validate = async (path, fromLibrary = false) => {
      if (typeof pathExists === "function") return !!(await pathExists(path));
      return fromLibrary || await this._hasExactCuratedPath(path);
    };
    if (exact && await validate(row.token, true) && await validate(row.portrait, true)) return exact;

    const tokenExists = await validate(row.token);
    const portraitExists = row.portrait === row.token
      ? tokenExists
      : await validate(row.portrait);
    if (!tokenExists || !portraitExists) return null;

    // Reuse presentation discovered for the exact token when available. If the
    // source has no presentation map, curatedMonsterPick supplies a flat object.
    const sameToken = (library ?? []).find((entry) =>
      entry?.source === row.source && entry.token === row.token);
    return {
      source: row.source,
      file: row.token.split("/").pop(),
      token: row.token,
      portrait: row.portrait,
      tokenObj: sameToken?.tokenObj,
    };
  }

  /**
   * Apply N6's exact curated rows to the manager's existing per-document pick
   * store. This is the only F4 write preparation step: `resolve()` and
   * `applyResolvedMapping()` remain the single mapping/injection machinery.
   *
   * Existing Browser picks (including legacy picks without an origin marker) and
   * explicit source overrides are authoritative. A prior F4 pick is marked
   * `origin: "curated"`, so a later run may refresh it when the reviewed path
   * changes while still removing it if its installed files have disappeared.
   *
   * @param {object} [opts]
   * @param {object} [opts.pack] injected managed pack for tests
   * @param {Array} [opts.library] exact disk-backed library for tests
   * @param {Function} [opts.pathExists] optional exact path validator
   * @param {object} [opts.map] injected source-aware map
   * @returns {Promise<object|null>}
   */
  static async applyCuratedImportedArt({ pack: suppliedPack = null, library: suppliedLibrary = null, pathExists = null, map = CURATED_IMPORTED_MONSTER_ART } = {}) {
    if (!globalThis.game?.user?.isGM) {
      globalThis.ui?.notifications?.warn?.("Only the GM can apply curated monster art.");
      return null;
    }

    const pack = suppliedPack ?? findMonsterPack({ game: globalThis.game });
    if (!pack) return { status: "skipped", reason: "no-pack", total: 0, applied: [], preserved: [], unmatched: [], removed: [], changed: false };
    if (!isManagedActorPack(pack)) {
      return { status: "skipped", reason: "unmanaged-pack", pack: pack.collection, total: 0, applied: [], preserved: [], unmatched: [], removed: [], changed: false };
    }

    let records;
    try {
      records = await this._managedImportedMonsterRecords(pack);
    } catch (error) {
      return { status: "failed", reason: "pack-unreadable", pack: pack.collection, total: 0, applied: [], preserved: [], unmatched: [], removed: [], changed: false, error };
    }
    if (!records.length) {
      return { status: "skipped", reason: "no-actors", pack: pack.collection, total: 0, applied: [], preserved: [], unmatched: [], removed: [], changed: false };
    }

    let library;
    try {
      library = suppliedLibrary ?? await this.buildLibrary();
    } catch (error) {
      return { status: "failed", reason: "library-unreadable", pack: pack.collection, total: records.length, applied: [], preserved: [], unmatched: [], removed: [], changed: false, error };
    }
    const candidates = new Map();
    for (const row of Object.values(map ?? {})) {
      const key = row.key ?? importedMonsterArtKey(row.book, row.name);
      if (!key) continue;
      let candidate = null;
      try {
        candidate = await this._resolveCuratedImportedMonsterArt(row, library, pathExists);
      } catch (_error) {
        // A single stale/unreadable reviewed path is an unmatched row, not a
        // reason to abort the rest of the managed-pack curation pass.
      }
      candidates.set(key, candidate);
    }

    const state = normalizeTokenArtManagerState(globalThis.game.settings.get(MODULE_ID, "tokenArtManager"));
    const plan = planCuratedImportedMonsterArt(records, {
      picks: state.picks,
      overrides: state.overrides,
      managedPaths: state.managedPaths,
      candidates,
      map,
    });
    if (plan.changed) {
      const next = normalizeTokenArtManagerState({
        ...state,
        picks: plan.picks,
        managedPaths: plan.managedPaths,
      });
      await globalThis.game.settings.set(MODULE_ID, "tokenArtManager", next);
    }
    return {
      status: "completed",
      pack: pack.collection,
      total: records.length,
      mapped: plan.applied.length + plan.preserved.filter((entry) => entry.reason === "already-curated").length,
      ...plan,
    };
  }

  static async build() {
    // Every covered pack: the base bestiary + the importer's managed pack (once
    // it exists). Each monster carries its pack so resolve() can key art per pack.
    const packIds = MonsterTokenArt.presentPacks();
    if (!packIds.length) return { sources: [], byMonster: [] };
    const monsters = [];
    for (const packId of packIds) {
      const pack = game.packs.get(packId);
      const managed = isManagedActorPack(pack);
      if (packId !== "shadowdark.monsters" && !managed) continue;
      if (managed && typeof pack?.getDocuments === "function") {
        // The managed pack is the only covered source whose full Actor shape is
        // needed: source flags identify N6 rows, and Mount forms are real
        // imported Actors even though their type is not NPC. Core remains an
        // index-only NPC census, and `isManagedActorPack` keeps third-party
        // packs outside this wider boundary.
        monsters.push(...await this._managedImportedMonsterRecords(pack));
      } else {
        const index = await pack.getIndex();
        monsters.push(...this._monsterEntries(index, packId));
      }
    }
    if (!monsters.length) return { sources: [], byMonster: [] };

    const discovered = await this.discoverSources();
    const priority = this.resolvePriority(discovered.map((s) => s.id));
    discovered.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
    for (const s of discovered) s._art = await this._sourceArt(s, monsters);

    const byMonster = monsters
      .map((m) => {
        const options = discovered
          .filter((s) => s._art[m.id])
          .map((s) => ({ source: s.id, ...s._art[m.id] }));
        const curatedImportedArt = this._curatedImportedArtStatus(m, options);
        return {
          id: m.id,
          name: m.name,
          pack: m.pack,
          options,
          ...(curatedImportedArt ? { curatedImportedArt } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const sources = discovered.map((s) => ({
      id: s.id, label: s.label, kind: s.kind, credit: s.credit ?? null,
      count: Object.keys(s._art).length,
    }));
    return { sources, byMonster };
  }

  /**
   * Every installed `pf2e-tokens-*` module → a browser source, probing common
   * token roots. Lets any Paizo bestiary token pack the user installs appear in
   * the browser automatically, without a hardcoded LIBRARY_DIRS entry per module.
   * Returns [{ id, label, root }].
   */
  static async _discoverPf2eTokenModules() {
    const out = [];
    for (const mod of game.modules ?? []) {
      if (!/^pf2e-tokens-/.test(mod.id) || this.LIBRARY_DIRS[mod.id]) continue;   // configured ones handled already
      for (const root of [`modules/${mod.id}/assets/tokens`, `modules/${mod.id}/tokens`, `modules/${mod.id}`]) {
        const ok = await MonsterTokenArt.FilePickerCls.browse("data", root).then((b) => (b.files?.length || b.dirs?.length)).catch(() => false);
        if (ok) { out.push({ id: mod.id, label: mod.title ?? mod.id, root }); break; }
      }
    }
    return out;
  }

  /**
   * Full token library across installed sources — EVERY token file, not just the
   * handful that name-match a monster. Powers the manual image browser so a
   * monster with no automatic match (imported CS/WR monsters) can still be
   * skinned by hand. Sources = LIBRARY_DIRS + any installed pf2e-tokens-* module.
   * Each file's presentation (ring/scale/subject) is inherited from that source's
   * own token map where listed, else a flat/default-scale fallback. Priority-
   * ordered by source, then A→Z by filename. Returns
   *   [{ source, label, file, token, portrait, tokenObj }]
   */
  static async buildLibrary() {
    const configured = Object.entries(this.LIBRARY_DIRS).map(([id, cfg]) => ({ id, ...cfg }));
    const autos = await this._discoverPf2eTokenModules();
    // Named folders are deliberately Browse-only. They never enter
    // discoverSources(), build(), or _sourceArt(), so adding a folder cannot
    // silently introduce automatic name matching or change Apply's defaults.
    const manualFolders = normalizeTokenArtManagerState(
      game.settings.get(MODULE_ID, "tokenArtManager")
    ).folders.map((folder) => ({
      id: tokenArtFolderSourceId(folder),
      label: folder.label,
      root: folder.path,
      kind: "manual-folder",
    }));
    const installed = [...configured, ...autos];
    // Known-priority sources first; browser-only extras (iconics, extra token
    // modules) append in discovery order. Manual folders append in the order
    // the GM configured them and are not part of source priority.
    const priority = this.resolvePriority(installed.map((s) => s.id));
    installed.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
    const sources = [...installed, ...manualFolders];

    const out = [];
    for (const s of sources) {
      const files = s.flat ? await this._browseFlatDir(s.root) : await this._browseTree(s.root, s.skipDir);
      if (!files.size) continue;
      const present = s.present ? await this._loadPresentMaps(s.present) : new Map();
      const scales = s.scaleMap ? await this._loadScaleMap(s.scaleMap) : new Map();
      const subjects = s.subjectDir ? await this._browseFlatDir(s.subjectDir) : null;
      const def = s.defaultScale ?? 1;
      for (const base of [...files.keys()].sort((a, b) => a.localeCompare(b))) {
        // pf2e iconics: browse only the `Name.webp` token; hide portrait/subject
        // variants and pair the portrait to `…Full` when it exists.
        if (s.iconics && /(full|subject)\.(webp|png|jpg|jpeg)$/i.test(base)) continue;
        const path = files.get(base);
        const p = present.get(base);
        let tokenObj;
        if (p?.tokenObj) tokenObj = foundry.utils.deepClone(p.tokenObj);
        else if (scales.has(base)) { const sc = scales.get(base); tokenObj = { texture: { src: path, scaleX: sc, scaleY: sc } }; }
        else {
          tokenObj = { texture: { src: path, scaleX: def, scaleY: def } };
          // Map-less DnD-Beyond source: enable the dynamic ring + subject art
          // for any token that has a matching subject image.
          if (subjects?.has(base)) {
            tokenObj.ring = { enabled: true, subject: { scale: s.subjectScale ?? 1, texture: subjects.get(base) } };
          }
        }
        if (!tokenObj.texture) tokenObj.texture = {};
        if (!tokenObj.texture.src) tokenObj.texture.src = path;   // present maps already carry src
        let portrait = p?.portrait ?? path;
        if (s.iconics) {
          const full = base.replace(/\.(webp|png|jpg|jpeg)$/i, "Full.$1");
          if (files.has(full)) portrait = files.get(full);
        }
        out.push({
          source: s.id,
          label: s.label ?? s.id,
          file: base,
          token: tokenObj.texture.src ?? path,
          portrait,
          tokenObj,
        });
      }
    }
    return out;
  }

  /** Re-order every monster's `options` to match a priority list, so the
   *  manager's thumbnail row shows sources in priority order after a live
   *  change without a rebuild (which re-browses disk). `resolve()` ranks by the
   *  current priority itself, so it no longer depends on this ordering — this is
   *  purely for display. */
  static reorder(catalog, priority) {
    const rank = (src) => { const i = priority.indexOf(src); return i < 0 ? Infinity : i; };
    for (const m of catalog.byMonster) m.options.sort((a, b) => rank(a.source) - rank(b.source));
  }

  /** Merge the saved priority with any newly-discovered source ids (defaults
   *  slot known sources first, unknown ones append). */
  static resolvePriority(discoveredIds) {
    const saved = normalizeTokenArtManagerState(
      game.settings.get(MODULE_ID, "tokenArtManager")
    ).priority;
    const ordered = [];
    for (const id of saved) if (discoveredIds.includes(id) && !ordered.includes(id)) ordered.push(id);
    for (const id of this.DEFAULT_PRIORITY) if (discoveredIds.includes(id) && !ordered.includes(id)) ordered.push(id);
    for (const id of discoveredIds) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }

  /**
   * Resolve the chosen art per monster into a per-pack compendium-art mapping:
   *   { <packId>: { <monsterId>: { actor, token } } }
   * Precedence: a hand-picked image (from the image browser) wins outright — even
   * when nothing name-matched — then a per-monster source override, then a
   * Community pin, then the highest-priority source that has art.
   * Returns { tables, chosen: {id:source|"__manual__"}, stats }.
   */
  static resolve(catalog) {
    const state = normalizeTokenArtManagerState(game.settings.get(MODULE_ID, "tokenArtManager"));
    const overrides = state.overrides ?? {};
    const picks = state.picks ?? {};
    // Rank options by the CURRENT priority rather than trusting the catalog's
    // build-time option order — so a live priority change picks the new default
    // without a rebuild, and API callers (resolveCatalog) stay correct too.
    const priority = this.resolvePriority((catalog.sources ?? []).map((s) => s.id));
    const rank = (src) => { const i = priority.indexOf(src); return i < 0 ? Infinity : i; };
    const tables = {};
    const chosen = {};
    const perSource = {};
    for (const m of catalog.byMonster) {
      const pack = m.pack ?? "shadowdark.monsters";
      const options = m.options ?? [];
      // 1) Hand-picked image — a specific file, not a source name-match. Works
      //    for monsters with zero options (imported CS/WR monsters).
      const manual = picks[m.id];
      if (manual?.tokenObj) {
        (tables[pack] ??= {})[m.id] = { actor: manual.portrait ?? manual.token, token: manual.tokenObj };
        chosen[m.id] = "__manual__";                 // sentinel: highlight none of the source options
        const sk = manual.source ?? "custom";
        perSource[sk] = (perSource[sk] ?? 0) + 1;
        continue;
      }
      if (!options.length) continue;

      // N6's reviewed-unmatched and path-unavailable rows stay in the catalog
      // so Browse can still show every option, but ordinary automatic matching
      // must not turn a rejected fuzzy candidate (e.g. generic bat.webp) into a
      // persisted mapping. A deliberate GM override is the sole exception: it
      // must name an option that is actually present, never silently fall back
      // to a different fuzzy source.
      const curatedStatus = m.curatedImportedArt?.status;
      const autoExcluded = curatedStatus === CURATED_IMPORTED_MONSTER_ART_STATUS.UNMATCHED
        || curatedStatus === CURATED_IMPORTED_MONSTER_ART_STATUS.PATH_UNAVAILABLE;
      const overrideSource = overrides[m.id];
      const overridePick = overrideSource
        ? options.find((o) => o.source === overrideSource)
        : null;
      if (autoExcluded && !overridePick) continue;

      // 2) explicit override; else a Community pin (loose foreign match); else priority.
      const wantSrc = overrideSource
        || (autoExcluded ? null : (this.COMMUNITY_PINS.has(m.name) ? this.COMMUNITY_SOURCE : null));
      const best = options.reduce((a, b) => (rank(b.source) < rank(a.source) ? b : a));
      const pick = overridePick || (wantSrc && options.find((o) => o.source === wantSrc)) || best;
      (tables[pack] ??= {})[m.id] = { actor: pick.portrait, token: pick.tokenObj };
      chosen[m.id] = pick.source;
      perSource[pick.source] = (perSource[pick.source] ?? 0) + 1;
    }
    const mapped = Object.values(tables).reduce((n, t) => n + Object.keys(t).length, 0);
    return { tables, chosen, stats: { total: catalog.byMonster.length, mapped, perSource } };
  }

  /**
   * Resolve the manager's picks into a name → chosen art map, for re-skinning
   * already-placed NPC tokens/actors (which we match by name, not compendium
   * id). Same choice logic as resolve(); returns Map(name → { portrait, tokenObj }).
   */
  static resolveByName(catalog) {
    const { tables } = this.resolve(catalog);
    const byId = {};
    for (const t of Object.values(tables)) Object.assign(byId, t);
    const byName = new Map();
    for (const m of catalog.byMonster) {
      const art = byId[m.id];
      if (!art) continue;
      // A placed world Actor is name-addressed, so it cannot carry the pack id
      // that distinguishes two catalog rows with the same name. Keep the Core
      // choice when both sources are present, matching MonsterLinker's
      // Core-first contract; an imported row still wins when Core has no art.
      const current = byName.get(m.name);
      if (!current || m.pack === "shadowdark.monsters") {
        byName.set(m.name, { portrait: art.actor, tokenObj: art.token });
      }
    }
    return byName;
  }

  /**
   * Path prefixes for every art source this catalog can apply. Used when
   * re-skinning already-placed tokens to decide which current art is "managed"
   * (safe to overwrite with the manager's pick) vs the user's own custom art —
   * so switching a placed token from one art source to another actually takes.
   */
  static managedArtPrefixes() {
    const prefixes = new Set();
    for (const s of this.FOLDER_SOURCES) if (s.tokenDir) prefixes.add(`modules/${s.id}/`);
    for (const s of this.FILEMAP_SOURCES) if (s.tokenRoot) prefixes.add(s.tokenRoot);
    for (const [id, cfg] of Object.entries(this.MAPPING_FOLDERS)) if (cfg.tokenDir) prefixes.add(`modules/${id}/`);
    // A manual Browse pick is manager-owned art too. Include its configured
    // roots so Re-skin placed can switch between managed sources while still
    // leaving arbitrary hand-authored paths untouched.
    for (const folder of normalizeTokenArtManagerState(
      game.settings.get(MODULE_ID, "tokenArtManager")
    ).folders) prefixes.add(folder.path.endsWith("/") ? folder.path : `${folder.path}/`);
    return [...prefixes];
  }

  /**
   * Exact manager-owned paths remembered from Browse picks. Unlike a prefix,
   * each entry matches one concrete token/portrait file, so a removed or
   * renamed folder cannot make a previously placed manager image look like GM
   * custom art, and an unrelated file under the same broad-looking root stays
   * protected.
   */
  static managedArtPaths() {
    const state = normalizeTokenArtManagerState(game.settings.get(MODULE_ID, "tokenArtManager"));
    const paths = new Set(state.managedPaths);
    for (const pick of Object.values(state.picks)) {
      for (const path of manualFolderPickPaths(pick)) paths.add(path);
    }
    return [...paths];
  }
}
