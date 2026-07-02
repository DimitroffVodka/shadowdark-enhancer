import { BaseStep } from "./base-step.mjs";
import { ABILITY_ORDER, abilityMod } from "../constants.mjs";
import { coinsAfterGear } from "../commit.mjs";

/**
 * Step — Preview. A read-only summary of every choice, as the last tab before
 * "Create Character". Pulls straight from the builder state; language / talent
 * UUIDs resolve to names (cached). The tab's check mark reflects overall
 * readiness — it completes when every other step does.
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
      // eslint-disable-next-line no-await-in-loop
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
      ready: this.isComplete(),
      missing: this.app.steps
        .filter((s) => s !== this && !s.isComplete())
        .map((s) => game.i18n.localize(s.label)),
    };
  }
}
