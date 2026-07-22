import { BaseStep } from "./base-step.mjs";
import { ABILITY_ORDER, abilityMod } from "../constants.mjs";
import { coinsAfterGear } from "../commit.mjs";
import { ancestryArt, classArt } from "../art.mjs";
import { emptyArt } from "../state.mjs";
import { galleryEnabled, pickGalleryArt } from "../art-gallery.mjs";

/** Shown in the art thumbs when nothing is chosen and no bundled art matches. */
const PLACEHOLDER_IMG = "icons/svg/mystery-man.svg";

/**
 * Step — Preview. A read-only summary of every choice, as the last tab before
 * "Create Character". Pulls straight from the builder state; language / talent
 * UUIDs resolve to names (cached). The tab's check mark reflects overall
 * readiness — it completes when every other step does.
 *
 * Also the one place art is chosen: portrait + token, via the bundled suggestion,
 * a pasted URL, the GM-curated gallery, or a plain FilePicker (with FILES_BROWSE).
 * Art is optional — leaving it unset means commit never touches `img`/`prototypeToken`,
 * so the system defaults (or, on the edit-in-place path, the actor's existing art)
 * survive untouched.
 */
export class PreviewStep extends BaseStep {
  constructor(app) {
    super(app);
    this._nameCache = new Map();   // uuid → display name
  }

  get id() { return "preview"; }
  get label() { return "SDE.charBuilder.step.preview"; }
  get icon() { return "fa-solid fa-clipboard-check"; }
  get partial() { return "sde-cb-preview"; }

  isComplete() {
    return this.app.steps.every((s) => s === this || s.isComplete());
  }

  async _name(uuid) {
    if (this._nameCache.has(uuid)) return this._nameCache.get(uuid);
    const doc = await fromUuid(uuid).catch(() => null);
    const name = doc?.name ?? null;
    this._nameCache.set(uuid, name);
    return name;
  }

  async _names(uuids) {
    const out = [];
    for (const u of (uuids || [])) {
       
      const n = await this._name(u);
      if (n) out.push(n);
    }
    return out;
  }

  async prepareContext() {
    const st = this.state;
    const L = (k) => game.i18n.localize(k);

    const abilities = ABILITY_ORDER.map((k) => {
      const v = st.stats.values[k] || 0;
      const m = abilityMod(v) ?? 0;
      return { key: k.toUpperCase(), value: v || "—", mod: v ? (m >= 0 ? `+${m}` : `${m}`) : "" };
    });

    const talents = [
      ...await this._names(st.ancestryTalents),
      ...st.classTalents.map((t) => t.name),
    ];
    if (!st.classTalents.length && st.classTalentRoll?.textResult) talents.push(st.classTalentRoll.textResult);

    const coins = coinsAfterGear(st);
    const fmtCoins = (c) => [c.gp && `${c.gp} gp`, c.sp && `${c.sp} sp`, c.cp && `${c.cp} cp`]
      .filter(Boolean).join(" ") || "0 gp";

    return {
      name: st.name || L("SDE.charBuilder.defaultName"),
      ancestry: st.ancestry?.name ?? null,
      class: st.class?.name ?? null,
      background: st.background?.name ?? null,
      deity: st.deity?.name ?? null,
      alignment: L(CONFIG.SHADOWDARK?.ALIGNMENTS?.[st.alignment] ?? st.alignment),
      trinket: st.trinket || null,
      patron: st.patron?.name ?? null,
      abilities,
      hp: st.hp.max || null,
      goldRolled: st.goldRolled ? `${st.coins.gp} gp` : null,
      coinsAfter: fmtCoins(coins),
      languages: await this._names(st.languages),
      talents,
      spells: [...st.spells].sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name))
        .map((s) => ({ name: s.name, tier: s.tier })),
      gear: st.gear.map((g) => ({ name: g.name, qty: g.qty })),
      art: this._artContext(),
      ready: this.isComplete(),
      missing: this.app.steps
        .filter((s) => s !== this && !s.isComplete())
        .map((s) => game.i18n.localize(s.label)),
    };
  }

  // --- Artwork ---------------------------------------------------------------

  /**
   * Bundled class/ancestry art for the current build, used as the "Use Suggested
   * Art" source and to preview a portrait the player hasn't overridden. Null when
   * the build has no matching art (see art.mjs).
   */
  _suggestedArt() {
    return classArt(this.state.class?.name) ?? ancestryArt(this.state.ancestry?.name);
  }

  _artContext() {
    const art = this.state.art;
    const suggested = this._suggestedArt();
    // Foundry's FilePicker needs FILES_BROWSE to read the data dir — a permission the
    // Player role lacks by default, and granting it exposes the WHOLE data dir (core
    // has no per-role directory restriction). So the direct picker is gated, and a
    // permission-less player is steered to the bundled suggestion, a pasted URL, or
    // the GM-proxied gallery instead — none of which need file access.
    const canBrowse = game.user.can("FILES_BROWSE");
    // A GM-curated gallery proxies the browse through the GM's client, so it gives
    // a permission-less player a way to pick art without opening the data dir.
    const canPickFiles = canBrowse || galleryEnabled();
    return {
      portrait: art.portrait,
      token: art.token,
      // The portrait thumb falls back to bundled art, then to a generic icon;
      // `portraitIsSuggested` lets the template mark it as not-yet-chosen.
      portraitSrc: art.portrait ?? suggested ?? PLACEHOLDER_IMG,
      portraitIsSuggested: !art.portrait && !!suggested,
      tokenSrc: art.token ?? PLACEHOLDER_IMG,
      canPickFiles,
      // Offer the bundled art whenever it exists and hasn't already been taken.
      canSuggest: !!suggested && (art.portrait !== suggested || art.token !== suggested),
      // "From URL…" is always available (a plain string field, no permission), so the
      // card is never empty. Only nudge when the direct picker is unavailable, so a
      // player knows the lighter options are deliberate rather than broken.
      lightOnly: !canBrowse,
      any: !!(art.portrait || art.token),
    };
  }

  /**
   * Apply the bundled class/ancestry art to both slots. The only art path open to a
   * player with no file permissions: it writes a `modules/…` path nobody has to
   * upload or browse to.
   */
  _onUseSuggested() {
    const suggested = this._suggestedArt();
    if (!suggested) return;
    const st = this.state;
    st.art.portrait = suggested;
    st.art.token = suggested;
  }

  /**
   * Accept absolute http(s) URLs, data-image URIs, and world-relative image paths.
   * Note `new URL(x, origin)` resolves ANY string as a relative path (so it can't
   * reject junk) — so validate the shape explicitly instead.
   */
  _looksLikeImageUrl(s) {
    s = String(s ?? "").trim();
    if (!s) return false;
    if (/^data:image\//i.test(s)) return true;
    // Absolute URL: must carry an http(s) scheme and a host.
    if (/^https?:\/\//i.test(s)) {
      try { return !!new URL(s).host; } catch (_e) { return false; }
    }
    // Otherwise a world-relative path: no whitespace, and pathlike — has a slash or
    // an image extension. Rejects free text like "not a url at all".
    if (/\s/.test(s)) return false;
    return s.includes("/") || /\.(webp|png|jpe?g|gif|svg|avif|bmp|tiff?|apng|ico)$/i.test(s);
  }

  /**
   * The custom-art path open to everyone, needing no file permission and no GM:
   * paste an image URL. `img` / `prototypeToken.texture.src` are plain string fields,
   * so setting them to a remote link (or a path the player already knows) is just a
   * document value — the GM-commit socket carries it untouched. Lets a table let
   * players self-serve their own portrait instead of the GM curating every one.
   */
  async _onPickUrl() {
    const st = this.state;
    const L = (k) => game.i18n.localize(k);
    const esc = foundry.utils.escapeHTML;
    const content = `<div class="sde-cb-art-url">
      <label class="field"><span>${L("SDE.charBuilder.art.urlLabel")}</span>
        <input type="text" name="url" placeholder="https://…" value="${esc(st.art.portrait ?? "")}">
      </label>
      <div class="slots">
        <label><input type="checkbox" name="portrait" checked> ${L("SDE.charBuilder.art.portrait")}</label>
        <label><input type="checkbox" name="token" checked> ${L("SDE.charBuilder.art.token")}</label>
      </div>
      <p class="hint">${L("SDE.charBuilder.art.urlHint")}</p>
    </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: L("SDE.charBuilder.art.urlTitle"), icon: "fa-solid fa-link" },
      classes: ["shadowdark"],
      content,
      ok: {
        label: L("SDE.charBuilder.art.urlApply"),
        icon: "fa-solid fa-check",
        callback: (_e, button) => {
          const f = button.form;
          return { url: f.elements.url.value.trim(), portrait: f.elements.portrait.checked, token: f.elements.token.checked };
        },
      },
      rejectClose: false,
    });
    if (!result?.url || (!result.portrait && !result.token)) return;
    if (!this._looksLikeImageUrl(result.url)) {
      ui.notifications.warn(L("SDE.charBuilder.art.urlInvalid"));
      return;
    }
    if (result.portrait) st.art.portrait = result.url;
    if (result.token) st.art.token = result.url;
    this.app.render();
  }

  /** Pick an image for one slot: the real FilePicker with FILES_BROWSE, else the
   * GM-proxied curated gallery. */
  async _onPickArt(slot) {
    const st = this.state;
    const apply = (path) => {
      st.art[slot] = path;
      this.app.render();
    };

    // No FilePicker permission: fall back to the GM-proxied curated gallery.
    if (!game.user.can("FILES_BROWSE")) {
      if (!galleryEnabled()) {
        ui.notifications.warn(game.i18n.localize("SDE.charBuilder.art.noBrowse"));
        return;
      }
      const picked = await pickGalleryArt(st.art[slot]);
      if (picked) apply(picked);
      return;
    }

    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      current: st.art[slot] ?? this._suggestedArt() ?? undefined,
      callback: apply,
    });
    fp.render(true);
  }

  /** @override */
  async handleAction(action, _event, _target) {
    switch (action) {
      case "cb-art-portrait":
      case "cb-art-token":
        await this._onPickArt(action === "cb-art-portrait" ? "portrait" : "token");
        return false;    // the FilePicker / gallery callback re-renders on pick
      case "cb-art-suggest":
        this._onUseSuggested();
        return true;
      case "cb-art-url":
        await this._onPickUrl();
        return false;    // the dialog callback re-renders on apply
      case "cb-art-clear":
        this.state.art = emptyArt();
        return true;
      default:
        return false;
    }
  }
}
