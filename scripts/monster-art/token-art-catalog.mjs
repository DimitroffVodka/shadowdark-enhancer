import { MODULE_ID } from "../module-id.mjs";
import { MonsterTokenArt } from "./monster-token-art.mjs";

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
    "pf2e-tokens-monster-core",
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
      const ok = await FilePicker.browse("data", fs.tokenDir).then((b) => b.files.length > 0).catch(() => false);
      if (ok) sources.push({ ...fs, kind: "folder" });
    }
    // File-map sources (disk folder tree, no shadowdark map, matched by filename).
    for (const fs of this.FILEMAP_SOURCES) {
      const ok = await FilePicker.browse("data", fs.probe).then((b) => (b.dirs?.length || b.files?.length)).catch(() => false);
      if (ok) sources.push({ ...fs, kind: "filemap" });
    }
    return sources;
  }

  /** Browse a folder tree → Map(basename → full data path). Skips `skipDir`. */
  static async _browseTree(root, skipDir) {
    const found = new Map();
    const walk = async (dir) => {
      let res;
      try { res = await FilePicker.browse("data", dir); } catch (e) { return; }
      for (const f of res.files ?? []) {
        if (!/\.(webp|png|jpg|jpeg)$/i.test(f)) continue;
        const base = f.split("/").pop();
        if (!found.has(base)) found.set(base, f);
      }
      for (const d of res.dirs ?? []) {
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
    catch (e) { return scales; }
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
      catch (e) { continue; }
      for (const docs of Object.values(json)) {
        for (const v of Object.values(docs)) {
          const src = v?.token?.texture?.src;
          if (!src) continue;
          const file = src.split("/").pop();
          if (out.has(file)) continue;
          const tokenObj = { texture: v.token.texture };
          if (v.token.ring) tokenObj.ring = v.token.ring;
          out.set(file, { tokenObj, portrait: v.actor ?? src });
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

  /** Build monsterId → { token, portrait, tokenObj } for one source. */
  static async _sourceArt(source, monsters) {
    const art = {};
    if (source.kind === "mapping") {
      let json;
      try { json = await foundry.utils.fetchJsonWithTimeout(source.mapping); }
      catch (e) { return art; }
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
      return this._filemapArt(source, monsters);
    } else {
      const sets = await MonsterTokenArt.buildFileSets(source);
      if (!sets) return art;
      for (const m of monsters) {
        const a = MonsterTokenArt.resolveArt(m.name, sets, source);
        if (!a) continue;
        art[m.id] = { token: a.token, portrait: a.portrait, tokenObj: MonsterTokenArt._tokenArt(a.file, sets, source) };
      }
    }
    return art;
  }

  /**
   * Build the full catalog:
   *   { sources: [{id,label,kind,credit,count}], byMonster: [{id,name,options:[{source,token,portrait,tokenObj}]}] }
   * `options` order follows the source-priority order.
   */
  static async build() {
    const pack = game.packs.get("shadowdark.monsters");
    if (!pack) return { sources: [], byMonster: [] };
    const index = await pack.getIndex();
    const monsters = [...index].map((e) => ({ id: e._id, name: e.name }));

    const discovered = await this.discoverSources();
    const priority = this.resolvePriority(discovered.map((s) => s.id));
    discovered.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
    for (const s of discovered) s._art = await this._sourceArt(s, monsters);

    const byMonster = monsters
      .map((m) => ({
        id: m.id,
        name: m.name,
        options: discovered.filter((s) => s._art[m.id]).map((s) => ({ source: s.id, ...s._art[m.id] })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sources = discovered.map((s) => ({
      id: s.id, label: s.label, kind: s.kind, credit: s.credit ?? null,
      count: Object.keys(s._art).length,
    }));
    return { sources, byMonster };
  }

  /** Merge the saved priority with any newly-discovered source ids (defaults
   *  slot known sources first, unknown ones append). */
  static resolvePriority(discoveredIds) {
    const saved = game.settings.get(MODULE_ID, "tokenArtManager")?.priority ?? [];
    const ordered = [];
    for (const id of saved) if (discoveredIds.includes(id) && !ordered.includes(id)) ordered.push(id);
    for (const id of this.DEFAULT_PRIORITY) if (discoveredIds.includes(id) && !ordered.includes(id)) ordered.push(id);
    for (const id of discoveredIds) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }

  /**
   * Resolve the chosen art per monster into a compendium-art table:
   *   { <monsterId>: { actor, token } }
   * Choice = per-monster override, else the first source (by priority) that has
   * art. Returns { table, chosen: {id:source}, stats }.
   */
  static resolve(catalog) {
    const state = game.settings.get(MODULE_ID, "tokenArtManager") ?? {};
    const overrides = state.overrides ?? {};
    const table = {};
    const chosen = {};
    const perSource = {};
    for (const m of catalog.byMonster) {
      if (!m.options.length) continue;
      // explicit override wins; else a Community pin (loose foreign match); else priority.
      const wantSrc = overrides[m.id]
        || (this.COMMUNITY_PINS.has(m.name) ? this.COMMUNITY_SOURCE : null);
      const pick = (wantSrc && m.options.find((o) => o.source === wantSrc)) || m.options[0];
      table[m.id] = { actor: pick.portrait, token: pick.tokenObj };
      chosen[m.id] = pick.source;
      perSource[pick.source] = (perSource[pick.source] ?? 0) + 1;
    }
    return { table, chosen, stats: { total: catalog.byMonster.length, mapped: Object.keys(table).length, perSource } };
  }
}
