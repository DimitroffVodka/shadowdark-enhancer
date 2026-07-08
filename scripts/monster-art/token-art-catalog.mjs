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
   * A "filemap" source: another system/module's compendium-art map that is NOT
   * keyed to shadowdark (so it can't be read by id), but whose entries carry a
   * token path + per-token scale + portrait we can name-match by filename.
   * Chiefly dnd5e's bundled Forgotten Adventures set — its `tokens/` art is
   * transparent creature art that needs the mapping's scale to fill, so we take
   * only files the mapping covers (flat, scaled, no ring).
   */
  static FILEMAP_SOURCES = [
    {
      id: "dnd5e-fa",
      label: "Forgotten Adventures (dnd5e)",
      mapping: "systems/dnd5e/json/fa-token-mapping.json",
      probe: "systems/dnd5e/json/fa-token-mapping.json",
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
    // File-map sources (non-shadowdark maps, matched by filename).
    for (const fs of this.FILEMAP_SOURCES) {
      const ok = await foundry.utils.fetchJsonWithTimeout(fs.probe).then(() => true).catch(() => false);
      if (ok) sources.push({ ...fs, kind: "filemap" });
    }
    return sources;
  }

  /**
   * File-map source → monsterId → art. Reads the map, keeps each token's path +
   * scale + portrait, and name-matches the filenames (CamelCase-aware) to
   * monster names. Flat presentation with the map's scale (no ring), so the
   * transparent creature art fills its footprint.
   */
  static async _filemapArt(source, monsters) {
    const art = {};
    let json;
    try { json = await foundry.utils.fetchJsonWithTimeout(source.mapping); }
    catch (e) { return art; }
    const files = new Map(); // filename → { token, portrait, scaleX, scaleY }
    for (const docs of Object.values(json)) {
      for (const v of Object.values(docs)) {
        const src = v?.token?.texture?.src;
        if (!src) continue;
        const file = src.split("/").pop();
        if (files.has(file)) continue;
        files.set(file, {
          token: src,
          portrait: v.actor ?? src,
          scaleX: v.token.texture.scaleX ?? 1,
          scaleY: v.token.texture.scaleY ?? 1,
        });
      }
    }
    if (!files.size) return art;

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
      const e = files.get(a.file);
      if (!e) continue;
      art[m.id] = {
        token: e.token,
        portrait: e.portrait,
        tokenObj: { texture: { src: e.token, scaleX: e.scaleX, scaleY: e.scaleY } },
      };
    }
    return art;
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
      const wantSrc = overrides[m.id];
      const pick = (wantSrc && m.options.find((o) => o.source === wantSrc)) || m.options[0];
      table[m.id] = { actor: pick.portrait, token: pick.tokenObj };
      chosen[m.id] = pick.source;
      perSource[pick.source] = (perSource[pick.source] ?? 0) + 1;
    }
    return { table, chosen, stats: { total: catalog.byMonster.length, mapped: Object.keys(table).length, perSource } };
  }
}
