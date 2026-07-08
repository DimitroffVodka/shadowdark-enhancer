import { MODULE_ID } from "../module-id.mjs";

/**
 * Monster Token Art — re-skin Shadowdark NPC tokens/portraits with art from a
 * locally-installed art module (default: the licensed `dnd-monster-manual`).
 *
 * Reference-only: this NEVER copies or bundles artwork. It only points token /
 * portrait *paths* at files already on disk in the user's own art module, which
 * Foundry serves as static files regardless of whether that module is enabled
 * (the Monster Manual is dnd5e-locked and cannot be activated in a Shadowdark
 * world — it doesn't need to be). Ships zero third-party art; the name→file map
 * is built at runtime via FilePicker.browse.
 *
 * Non-destructive: only replaces auto-applied art (system cowl / community
 * tokens / core default), never art the GM hand-picked, and never re-points art
 * already sourced from the art module — safe to re-run after placing monsters.
 */
export class MonsterTokenArt {
  /** Default art source (a locally-installed module id) + its asset layout. */
  static get SOURCE() {
    const id = game.settings.get(MODULE_ID, "tokenArtSource") || "dnd-monster-manual";
    return {
      id,
      tokenDir: `modules/${id}/assets/tokens`,
      portraitDir: `modules/${id}/assets/portraits`,
      subjectDir: `modules/${id}/assets/subjects`,
      // The art module's own compendium-art map — supplies each token's
      // intended dynamic-ring/scale presentation (MM authors every token for
      // the ring; scale reflects art framing, not creature size).
      tokenMapping: `modules/${id}/token-mapping.json`,
    };
  }

  /** Current art we consider auto-applied and therefore safe to replace. */
  static REPLACEABLE_PREFIX = [
    "systems/shadowdark/assets/",
    "modules/shadowdark-community-content/assets/",
    "modules/shadowdark-community-tokens/",
    "icons/",
  ];

  /**
   * Hand-picked semantic overrides fuzzy matching can't infer — chiefly
   * Shadowdark's elemental dragons → the Monster Manual's chromatic/metallic
   * line, plus a few disambiguations. Keys MUST be in norm() form (lowercase,
   * no commas/punctuation). Values are art slugs (no extension). Only meaningful
   * when the source is the Monster Manual; harmless for other sources.
   */
  static OVERRIDES = {
    "dragon fire": "adult-red-dragon",
    "dragon frost": "adult-white-dragon",
    "dragon desert": "adult-blue-dragon",
    "dragon forest": "ancient-green-dragon",
    "dragon swamp": "adult-black-dragon",
    "dragon sea": "ancient-bronze-dragon",
    "minotaur": "minotaur-of-baphomet",
    "naga": "spirit-naga",
    "shark megalodon": "giant-shark",
    "hag weald": "green-hag",
  };

  /**
   * Semantic name aliases — Shadowdark reflavours several D&D monsters under new
   * names to avoid WotC IP. These feed the matcher (as extra name variants), so
   * ANY art source that carries the D&D-named token matches. Keys in norm() form
   * (lowercase, no punctuation); values are alternate names to also try.
   */
  static ALIASES = {
    "brain eater": ["mind flayer", "illithid"],
    "stingbat": ["stirge"],
    "mushroomfolk": ["myconid"],
    "grimlow": ["grimlock"],
    "smilodon": ["saber toothed tiger", "sabertooth"],
    "viperian": ["yuan ti", "serpentfolk"],
    "deep one": ["kuo toa"],
    // Role-based humanoid NPCs (D&D stats ancestries as roles, not monsters).
    "peasant": ["commoner"],
    "soldier": ["warrior veteran", "veteran"],
    "elf": ["elf ranger"],
    // Angel hierarchy → D&D celestial tiers.
    "angel principi": ["deva"],
    "angel domini": ["planetar"],
    "archangel": ["solar"],
    // Snakes / swarms named differently across packs.
    "snake cobra": ["venomous snake", "poisonous snake", "viper"],
    "snake swarm": ["swarm venomous snakes", "swarm poisonous snakes"],
    "scarab swarm": ["swarm beetles", "swarm insects", "beetle swarm"],
  };

  /** Relative path (under Data) of the generated compendium-art mapping. */
  static get MAPPING_DIR() { return `modules/${MODULE_ID}/data`; }
  static get MAPPING_FILE() { return "monster-art-mapping.json"; }
  static get MAPPING_PATH() { return `${this.MAPPING_DIR}/${this.MAPPING_FILE}`; }

  static register() {
    game.settings.register(MODULE_ID, "tokenArtSource", {
      name: "SDE.settings.tokenArtSource.name",
      hint: "SDE.settings.tokenArtSource.hint",
      scope: "world",
      config: true,
      type: String,
      default: "dnd-monster-manual",
    });
    // Whether the module injects its generated compendium-art mapping on load
    // (so every monster drag gets the art). Toggled by the tool, not the UI.
    game.settings.register(MODULE_ID, "tokenArtCompendium", {
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
    });
    // Token Art Manager state: source priority order + per-monster overrides
    // ({ priority: [sourceId], overrides: { monsterId: sourceId } }). Managed by
    // the manager app, not the settings UI.
    game.settings.register(MODULE_ID, "tokenArtManager", {
      scope: "world",
      config: false,
      type: Object,
      default: { priority: [], overrides: {} },
    });
  }

  /**
   * Write an already-resolved art table and inject it as the compendium overlay.
   * @param {object} table  { <monsterId>: { actor:<portraitPath>, token:<tokenObj> } }
   */
  static async applyResolvedMapping(table) {
    if (!game.user.isGM) { ui.notifications.warn("Only the GM can do that."); return null; }
    const mapping = { "shadowdark.monsters": table };
    const file = new File([JSON.stringify(mapping, null, 2)], this.MAPPING_FILE, { type: "application/json" });
    await FilePicker.upload("data", this.MAPPING_DIR, file, {}, { notify: false });
    await game.settings.set(MODULE_ID, "tokenArtCompendium", true);
    await this._injectMapping();
    return { count: Object.keys(table).length };
  }

  /**
   * On ready: if the compendium mapping is enabled and its file exists, inject
   * our art flag and (re)build the core CompendiumArt map so `shadowdark.monsters`
   * serves the referenced art. No module.json edit / world relaunch required.
   */
  static async initCompendiumArt() {
    try {
      if (!game.settings.get(MODULE_ID, "tokenArtCompendium")) return;
      const dir = await FilePicker.browse("data", this.MAPPING_DIR).catch(() => null);
      const has = dir?.files?.some((f) => f.endsWith(this.MAPPING_FILE));
      if (!has) return;                 // enabled but file gone (e.g. module update) — stay inert
      await this._injectMapping();
    } catch (e) {
      console.error(`${MODULE_ID} | initCompendiumArt failed:`, e);
    }
  }

  /** Point the in-memory module flag at our mapping, out-prioritize other art
   *  packages, rebuild the CompendiumArt map, and drop the pack cache so already
   *  loaded docs re-initialize with the new art. */
  static async _injectMapping() {
    const ca = game.compendiumArt;
    if (!ca?._registerArt) { console.warn(`${MODULE_ID} | CompendiumArt API unavailable`); return false; }
    const mod = game.modules.get(MODULE_ID);
    foundry.utils.setProperty(mod, `flags.${ca.FLAG}`, {
      [game.system.id]: { mapping: this.MAPPING_PATH, credit: "Shadowdark Enhancer — referenced from a locally-installed art module" },
    });
    await this._ensurePriority();
    await ca._registerArt();
    game.packs.get("shadowdark.monsters")?.clear?.();
    return true;
  }

  /** Give our package a higher CompendiumArt priority than every other provider
   *  so MM art wins for matched monsters (community art still fills the gaps). */
  static async _ensurePriority() {
    try {
      const ca = game.compendiumArt;
      const others = ca.getPackages().filter((p) => p.packageId !== MODULE_ID);
      const max = Math.max(CONST.SORT_INTEGER_DENSITY, ...others.map((p) => p.priority ?? 0));
      const cfg = foundry.utils.deepClone(game.settings.get("core", ca.SETTING) ?? {});
      const cur = cfg[MODULE_ID];
      // Only the GM writes the world-scoped core setting; players read the value
      // the GM already persisted.
      if (game.user.isGM && (!cur || (cur.priority ?? 0) <= max)) {
        cfg[MODULE_ID] = { priority: max + CONST.SORT_INTEGER_DENSITY, portraits: true, tokens: true };
        await game.settings.set("core", ca.SETTING, cfg);
      }
    } catch (e) { console.warn(`${MODULE_ID} | could not set CompendiumArt priority:`, e); }
  }

  /**
   * GM: build the name→art mapping for every monster in `shadowdark.monsters`,
   * write it to the module data dir, enable + inject it. Every future monster
   * drag then carries the matched art. Returns { mapped, total, missing }.
   */
  static async generateCompendiumMapping() {
    if (!game.user.isGM) { ui.notifications.warn("Only the GM can do that."); return null; }
    const source = this.SOURCE;
    const sets = await this.buildFileSets(source);
    if (!sets) {
      ui.notifications.error(`Token art source "${source.id}" not found under Data/modules/${source.id}.`);
      return { mapped: 0, total: 0, missing: true };
    }
    const pack = game.packs.get("shadowdark.monsters");
    if (!pack) { ui.notifications.error("shadowdark.monsters compendium not found."); return null; }
    const index = await pack.getIndex();

    const table = {};
    let mapped = 0;
    for (const e of index) {
      const art = this.resolveArt(e.name, sets, source);
      if (!art) continue;
      table[e._id] = {
        __MONSTER_NAME__: e.name,
        actor: art.portrait,
        token: this._tokenArt(art.file, sets, source),   // src + scale + dynamic ring/subject
      };
      mapped++;
    }
    const mapping = { "shadowdark.monsters": table };

    const file = new File([JSON.stringify(mapping, null, 2)], this.MAPPING_FILE, { type: "application/json" });
    await FilePicker.upload("data", this.MAPPING_DIR, file, {}, { notify: false });
    await game.settings.set(MODULE_ID, "tokenArtCompendium", true);
    await this._injectMapping();

    return { mapped, total: index.size, missing: index.size - mapped };
  }

  /** GM: turn the compendium mapping back off — remove our flag, rebuild, and
   *  restore the underlying (community/system) art. Leaves the file on disk. */
  static async disableCompendiumMapping() {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, "tokenArtCompendium", false);
    const ca = game.compendiumArt;
    const mod = game.modules.get(MODULE_ID);
    if (mod?.flags?.[ca.FLAG]) delete mod.flags[ca.FLAG];
    await ca._registerArt?.();
    game.packs.get("shadowdark.monsters")?.clear?.();
  }

  // ---- normalization + matching helpers -----------------------------------
  static _norm(s) {
    return String(s ?? "")
      // split CamelCase (Forgotten Adventures filenames like "RedDragonAncient")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }
  static _deNum(s) { return s.replace(/[-_ ]\d+$/, ""); }
  static _words(s) { return new Set(this._norm(s).split(" ").filter(Boolean)); }
  static _slugOf(f) { return f.replace(/\.(webp|png|jpg|jpeg|svg)$/i, ""); }

  static _variants(name) {
    const out = new Set([name]);
    if (name.includes(",")) {
      const parts = name.split(",").map((s) => s.trim());
      out.add([...parts].reverse().join(" "));
      out.add(parts.join(" "));
    }
    out.add(name.replace(/\(.*?\)/g, "").trim());
    out.add(name.replace(/^The\s+/i, ""));
    // Semantic aliases (Shadowdark → D&D reflavours).
    const aliases = this.ALIASES[this._norm(name)];
    if (aliases) for (const a of aliases) out.add(a);
    return [...out];
  }

  static _jaccard(a, b) {
    const A = this._words(a), B = this._words(b);
    let i = 0;
    for (const x of A) if (B.has(x)) i++;
    return i / (A.size + B.size - i);
  }

  /** Browse the source dirs → { tokenFiles, portraitFiles, subjectFiles, byNorm, present }. */
  static async buildFileSets(source = this.SOURCE) {
    const browse = async (dir) => {
      try {
        const b = await FilePicker.browse("data", dir);
        return new Set(b.files.map((f) => f.split("/").pop()));
      } catch (e) { return null; }
    };
    const tokenFiles = await browse(source.tokenDir);
    const portraitFiles = await browse(source.portraitDir);
    const subjectFiles = await browse(source.subjectDir);
    if (!tokenFiles || tokenFiles.size === 0) return null;
    const byNorm = new Map();
    for (const f of tokenFiles) {
      const k = this._norm(this._deNum(this._slugOf(f)));
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(f);
    }
    const present = await this._loadPresentation(source);
    return { tokenFiles, portraitFiles, subjectFiles, byNorm, present };
  }

  /**
   * Load the art module's token-mapping.json into a filename → presentation
   * lookup { scaleX, scaleY, ringScale } (ring is always on for MM art). Absent
   * or unreadable file → empty map (tokens fall back to flat, scale 1).
   */
  static async _loadPresentation(source = this.SOURCE) {
    const map = {};
    try {
      const json = await foundry.utils.fetchJsonWithTimeout(source.tokenMapping);
      for (const docs of Object.values(json)) {
        for (const v of Object.values(docs)) {
          const src = v?.token?.texture?.src;
          if (!src) continue;
          const f = src.split("/").pop();
          if (map[f]) continue;
          map[f] = {
            scaleX: v.token.texture.scaleX ?? 1,
            scaleY: v.token.texture.scaleY ?? 1,
            ringOn: v.token.ring?.enabled ?? false,
            ringScale: v.token.ring?.subject?.scale ?? 1,
          };
        }
      }
    } catch (e) { /* no mapping file — flat fallback */ }
    return map;
  }

  /**
   * Build the token art object for a matched file, reproducing the art module's
   * intended presentation (dynamic ring + per-art scale + explicit subject
   * texture, since the source module isn't active to supply its ring-subject
   * mapping). Returns a nested `{ texture, ring? }` suitable for a prototype
   * token / compendium-art mapping.
   */
  static _tokenArt(file, sets, source = this.SOURCE) {
    const p = sets.present?.[file];
    const hasSubject = sets.subjectFiles?.has(file);
    const texture = {
      src: `${source.tokenDir}/${file}`,
      scaleX: p?.scaleX ?? 1,
      scaleY: p?.scaleY ?? 1,
    };
    const obj = { texture };
    // The source (MM) authors every token for the dynamic ring, so enable it
    // whenever a subject image exists — even for files absent from the source's
    // own mapping (numbered variants etc.), which otherwise render flat/tiny.
    const ringOn = p?.ringOn ?? hasSubject;
    if (ringOn) {
      obj.ring = { enabled: true, subject: { scale: p?.ringScale ?? 1 } };
      if (hasSubject) obj.ring.subject.texture = `${source.subjectDir}/${file}`;
    }
    return obj;
  }

  /** Prefer the most generic candidate: fewest words, then shortest slug. */
  static _pickGeneric(arr) {
    return arr.slice().sort((a, b) =>
      this._words(this._slugOf(a)).size - this._words(this._slugOf(b)).size ||
      a.length - b.length)[0];
  }

  /**
   * Resolve a monster name to { token, portrait, score } absolute paths, or
   * null when there's no confident match (< minScore).
   */
  static resolveArt(name, sets, source = this.SOURCE, minScore = 0.5) {
    const { tokenFiles, portraitFiles, byNorm } = sets;
    const ov = this.OVERRIDES[this._norm(name)];
    let file = null, score = 0;

    // Override slug (MM-specific) — apply only if THIS source actually has that
    // file; otherwise fall through to name/alias/fuzzy matching so other sources
    // (Paizo/FA) still resolve the monster.
    if (ov) {
      const f = [...tokenFiles].find((f) => this._slugOf(f).toLowerCase() === ov);
      if (f) { file = f; score = 1; }
    }
    if (!file) {
      for (const v of this._variants(name)) {          // exact (de-numbered)
        const k = this._norm(v);
        if (byNorm.has(k)) { file = this._pickGeneric(byNorm.get(k)); score = 1; break; }
      }
      if (!file) {                                     // fuzzy
        for (const f of tokenFiles) {
          let s = 0;
          for (const v of this._variants(name)) {
            s = Math.max(s, this._jaccard(this._norm(v), this._norm(this._deNum(this._slugOf(f)))));
          }
          const better = s > score ||
            (s === score && file &&
              (this._words(this._slugOf(f)).size < this._words(this._slugOf(file)).size ||
               (this._words(this._slugOf(f)).size === this._words(this._slugOf(file)).size &&
                f.length < file.length)));
          if (better) { score = s; file = f; }
        }
      }
    }

    if (!file || score < minScore) return null;
    const portraitName = portraitFiles?.has(file) ? file : null;
    return {
      file,
      token: `${source.tokenDir}/${file}`,
      portrait: portraitName ? `${source.portraitDir}/${portraitName}` : `${source.tokenDir}/${file}`,
      score,
    };
  }

  static _isReplaceable(src) {
    return !src || this.REPLACEABLE_PREFIX.some((p) => src.startsWith(p));
  }

  /**
   * Apply matched art to NPC tokens/actors. Returns a report
   * { tokens, portraits, kept, skipped:[], missing:bool }.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.scene=true]      re-skin the active scene's NPC tokens
   * @param {boolean} [opts.actors=true]     re-skin NPC actors in the Actors tab
   * @param {boolean} [opts.portraits=true]  also set the sheet image (actor.img)
   * @param {boolean} [opts.dryRun=false]    report only; change nothing
   * @param {number}  [opts.minScore=0.5]    fuzzy threshold below which to skip
   */
  static async apply({ scene = true, actors = true, portraits = true, dryRun = false, minScore = 0.5 } = {}) {
    if (!game.user.isGM) { ui.notifications.warn("Only the GM can apply monster token art."); return null; }
    const source = this.SOURCE;
    const sets = await this.buildFileSets(source);
    if (!sets) {
      ui.notifications.error(`Token art source "${source.id}" not found. Install its module under Data/modules/${source.id} (it does not need to be enabled).`);
      return { tokens: 0, portraits: 0, kept: 0, skipped: [], missing: true };
    }

    let tok = 0, por = 0, kept = 0;
    const skipped = [];
    const seen = new Set();

    const skin = async (actor, tokenDoc) => {
      const art = this.resolveArt(actor.name, sets, source, minScore);
      if (!art) { if (!seen.has(actor.name)) skipped.push(actor.name); seen.add(actor.name); return; }
      seen.add(actor.name);
      // Full presentation (src + scale + dynamic ring/subject) so large art
      // fills its footprint instead of sitting tiny in the middle.
      const p = this._tokenArt(art.file, sets, source);
      // Already fully skinned to our art (src + ring + subject)? then leave it.
      const isDone = (d) =>
        d.texture.src === art.token &&
        (d.ring?.enabled ?? false) === !!p.ring?.enabled &&
        (d.ring?.subject?.texture ?? null) === (p.ring?.subject?.texture ?? null);
      // Skin when it's auto-applied art we own (replaceable) OR already our
      // texture but missing the ring/scale (e.g. texture synced flat by a hook).
      const shouldSkin = (d) =>
        !isDone(d) && (this._isReplaceable(d.texture.src) || d.texture.src === art.token);

      if (tokenDoc) {
        if (shouldSkin(tokenDoc)) { if (!dryRun) await tokenDoc.update(p); tok++; }
        else kept++;
        return;
      }
      const upd = {};
      if (shouldSkin(actor.prototypeToken)) { upd["prototypeToken"] = p; tok++; }
      else kept++;
      if (portraits && this._isReplaceable(actor.img) && actor.img !== art.portrait) {
        upd["img"] = art.portrait; por++;
      }
      if (!dryRun && Object.keys(upd).length) await actor.update(upd);
    };

    if (scene && game.scenes.active) {
      for (const t of game.scenes.active.tokens) {
        const a = t.actor;
        if (!a || a.type !== "NPC") continue;
        await skin(a, t);
      }
    }
    if (actors) {
      for (const a of game.actors) {
        if (a.type !== "NPC") continue;
        await skin(a, null);
      }
    }

    if (skipped.length) {
      console.log(`${MODULE_ID} | Monster Art: no confident match (${skipped.length}) — set by hand:\n` + skipped.sort().join(", "));
    }
    return { tokens: tok, portraits: por, kept, skipped, missing: false };
  }

  /** GM entry point: pick a mode → apply → report. */
  static async openDialog() {
    if (!game.user.isGM) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const source = this.SOURCE;
    const on = game.settings.get(MODULE_ID, "tokenArtCompendium");
    const content = `
      <div style="padding:6px 4px; display:flex; flex-direction:column; gap:10px;">
        <p style="margin:0;">Skin Shadowdark monsters with art from <code>${source.id}</code>
          — <em>referenced from disk, no files are copied</em>. Unmatched monsters keep their current art
          (listed in the console, F12).</p>
        <div style="border:1px solid var(--color-border-light-2,#666); border-radius:4px; padding:6px 8px;">
          <strong><i class="fa-solid fa-book-open"></i> Whole compendium ${on ? "— <span style='color:var(--color-text-hyperlink,#88f)'>on</span>" : ""}</strong>
          <p style="margin:4px 0 0; opacity:.85;">Overlays the art on <code>shadowdark.monsters</code> so
            <em>every</em> monster you drag out is skinned automatically — no re-running needed. Non-destructive
            (the pack is never modified) and reversible.</p>
        </div>
        <div style="border:1px solid var(--color-border-light-2,#666); border-radius:4px; padding:6px 8px;">
          <strong><i class="fa-solid fa-wand-magic-sparkles"></i> Already-placed monsters</strong>
          <p style="margin:4px 0 6px; opacity:.85;">Re-skin monsters that are already on scenes or in the Actors tab.</p>
          <label><input type="checkbox" name="scene" checked> Active scene's NPC tokens</label><br>
          <label><input type="checkbox" name="actors" checked> NPC actors in the Actors tab</label><br>
          <label><input type="checkbox" name="portraits" checked> Also set portraits (sheet image)</label>
        </div>
      </div>`;

    const runCompendium = async () => {
      const r = await this.generateCompendiumMapping();
      if (r && !r.missing) {
        ui.notifications.info(`Compendium art on: ${r.mapped}/${r.total} monsters skinned automatically on every drag. ${r.missing} kept their art.`);
      }
      return true;
    };
    const runPlaced = async (dlg) => {
      const el = dlg.element;
      const r = await this.apply({
        scene: el.querySelector('input[name="scene"]').checked,
        actors: el.querySelector('input[name="actors"]').checked,
        portraits: el.querySelector('input[name="portraits"]').checked,
      });
      if (r && !r.missing) {
        ui.notifications.info(`Re-skinned ${r.tokens} tokens, ${r.portraits} portraits. ${r.kept} kept (custom), ${r.skipped.length} unmatched (see console).`);
      }
      return true;
    };
    const runRestore = async () => {
      await this.disableCompendiumMapping();
      ui.notifications.info("Compendium art turned off — monsters show their default art again.");
      return true;
    };

    const buttons = [
      { action: "compendium", label: "Apply to compendium", icon: "fa-solid fa-book-open", default: true, callback: () => runCompendium() },
      { action: "placed", label: "Re-skin placed", icon: "fa-solid fa-wand-magic-sparkles", callback: (_e, _b, dlg) => runPlaced(dlg) },
    ];
    if (on) buttons.push({ action: "restore", label: "Turn off", icon: "fa-solid fa-rotate-left", callback: () => runRestore() });
    buttons.push({ action: "cancel", label: "Close" });

    await DialogV2.wait({
      window: { title: "Monster Token Art", icon: "fa-solid fa-dragon" },
      content,
      buttons,
      rejectClose: false,
    }).catch(() => null);
  }
}
