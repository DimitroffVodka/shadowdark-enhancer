import { MODULE_ID } from "../shared/module-id.mjs";
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
      const ok = await MonsterTokenArt.FilePickerCls.browse("data", fs.tokenDir).then((b) => b.files.length > 0).catch(() => false);
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
    try { res = await MonsterTokenArt.FilePickerCls.browse("data", dir); } catch (e) { return found; }
    for (const f of res.files ?? []) {
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
      try { res = await MonsterTokenArt.FilePickerCls.browse("data", dir); } catch (e) { return; }
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
  static async build() {
    // Every covered pack: the base bestiary + the importer's managed pack (once
    // it exists). Each monster carries its pack so resolve() can key art per pack.
    const packIds = MonsterTokenArt.presentPacks();
    if (!packIds.length) return { sources: [], byMonster: [] };
    const monsters = [];
    for (const packId of packIds) {
      const index = await game.packs.get(packId).getIndex();
      for (const e of index) {
        if (e.type && e.type !== "NPC") continue;   // skip non-monster docs in mixed packs
        monsters.push({ id: e._id, name: e.name, pack: packId });
      }
    }
    if (!monsters.length) return { sources: [], byMonster: [] };

    const discovered = await this.discoverSources();
    const priority = this.resolvePriority(discovered.map((s) => s.id));
    discovered.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
    for (const s of discovered) s._art = await this._sourceArt(s, monsters);

    const byMonster = monsters
      .map((m) => ({
        id: m.id,
        name: m.name,
        pack: m.pack,
        options: discovered.filter((s) => s._art[m.id]).map((s) => ({ source: s.id, ...s._art[m.id] })),
      }))
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
    const sources = [...configured, ...autos];
    // Known-priority sources first; browser-only extras (iconics, extra token
    // modules) append in discovery order.
    const priority = this.resolvePriority(sources.map((s) => s.id));
    sources.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));

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
    const saved = game.settings.get(MODULE_ID, "tokenArtManager")?.priority ?? [];
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
    const state = game.settings.get(MODULE_ID, "tokenArtManager") ?? {};
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
      if (!m.options.length) continue;
      // 2) explicit override; else a Community pin (loose foreign match); else priority.
      const wantSrc = overrides[m.id]
        || (this.COMMUNITY_PINS.has(m.name) ? this.COMMUNITY_SOURCE : null);
      const best = m.options.reduce((a, b) => (rank(b.source) < rank(a.source) ? b : a));
      const pick = (wantSrc && m.options.find((o) => o.source === wantSrc)) || best;
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
      if (art) byName.set(m.name, { portrait: art.actor, tokenObj: art.token });
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
    return [...prefixes];
  }
}
