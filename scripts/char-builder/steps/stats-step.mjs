import { BaseStep } from "./base-step.mjs";
import {
  ABILITY_ORDER, ABILITY_LABELS, ABILITY_INFO,
  STAT_METHODS, POINT_BUY_BUDGET, POINT_BUY_MIN, POINT_BUY_MAX,
  pointBuyCost, pointBuySpent, modLabel, builderDiceAnimation,
} from "../constants.mjs";

/**
 * Step — Abilities.
 *
 * The generation method is GM-dictated (world setting `charBuilderStatMethod`)
 * and shown read-only — players don't pick it. Every Roll / Reroll / Random
 * posts a chat card (audit trail). For "assign" methods the rolled dice are
 * shown as a visible pool and placed by clicking a die, then a stat. Fixed
 * arrays use the same pool/assignment path without rolling; point buy adjusts
 * each ability directly against its budget.
 */
export class StatsStep extends BaseStep {
  constructor(app) {
    super(app);
    this._picked = null;   // transient: index of the pool die the user picked up
  }

  get id() { return "stats"; }
  get label() { return "SDE.charBuilder.step.stats"; }
  get icon() { return "fa-solid fa-dice-d6"; }
  get partial() { return "sde-cb-stats"; }

  isComplete() {
    if (this.isPointBuy) {
      return ABILITY_ORDER.every((k) => {
        const score = this.state.stats.values[k];
        return Number.isInteger(score) && score >= POINT_BUY_MIN && score <= POINT_BUY_MAX;
      }) && pointBuySpent(this.state.stats.values) <= POINT_BUY_BUDGET;
    }
    return ABILITY_ORDER.every((k) => this.state.stats.values[k] > 0);
  }
  get method() { return STAT_METHODS[this.state.stats.method] ?? STAT_METHODS["3d6-reroll"]; }
  get isAssign() { return !!this.method.assign; }
  get isFixed() { return Array.isArray(this.method.fixed); }
  get isPointBuy() { return !!this.method.pointBuy; }

  async prepareContext() {
    const st = this.state.stats;
    const m = this.method;
    if (this.isFixed) this._ensureFixedPool();
    if (this.isPointBuy) this._ensurePointBuy();
    const pool = st.pool ?? [];
    const rolled = this.isFixed || pool.length === ABILITY_ORDER.length;
    const maxRoll = rolled ? Math.max(...pool) : 0;
    const assign = this.isAssign;
    const usedIdx = new Set(Object.values(st.assignment).filter((v) => v !== null && v !== undefined));
    const spent = this.isPointBuy ? pointBuySpent(st.values) : 0;

    const abilities = ABILITY_ORDER.map((k) => ({
      key: k,
      label: ABILITY_LABELS[k],
      value: st.values[k] || null,
      mod: modLabel(st.values[k]),
      empty: !(st.values[k] > 0),
      isAssign: assign,
      pointBuy: this.isPointBuy,
      pointBuyCost: this.isPointBuy ? pointBuyCost(st.values[k]) : null,
      canIncrease: this._canAdjustPointBuy(k, 1),
      canDecrease: this._canAdjustPointBuy(k, -1),
      info: ABILITY_INFO[k],   // description shown directly beneath the tile
    }));

    const poolChips = (assign && rolled)
      ? pool.map((v, idx) => ({ idx, value: v, used: usedIdx.has(idx), picked: idx === this._picked }))
      : [];

    return {
      methodLabel: game.i18n.localize(m.label),
      isAssign: assign,
      isFixed: this.isFixed,
      isPointBuy: this.isPointBuy,
      rolled,
      total: rolled ? pool.reduce((a, b) => a + b, 0) : 0,
      spent,
      remaining: this.isPointBuy ? POINT_BUY_BUDGET - spent : 0,
      pointBuyBudget: POINT_BUY_BUDGET,
      pointBuyMin: POINT_BUY_MIN,
      pointBuyMax: POINT_BUY_MAX,
      abilities,
      poolChips,
      showReroll: !!m.rerollUnder14,
      canReroll: !!m.rerollUnder14 && rolled && maxRoll < 14,
      showReset: this.isFixed || this.isPointBuy || rolled,
      complete: this.isComplete(),
    };
  }

  supportsRandom() { return !this.isPointBuy; }

  async randomize() {
    if (this.isPointBuy) {
      this._resetRoll();
      return;
    }
    if (this.isFixed) {
      this._ensureFixedPool();
      ABILITY_ORDER.forEach((k, i) => this._assign(k, i));
      return;
    }
    await this._roll("random");
    if (this.isAssign) ABILITY_ORDER.forEach((k, i) => this._assign(k, i));
  }

  async handleAction(action, _event, target) {
    switch (action) {
      case "cb-roll-stats":
        await this._roll("roll");
        return true;
      case "cb-reroll-stats":
        await this._roll("reroll");
        return true;
      case "cb-reset-stats":
        this._resetRoll();
        return true;
      case "cb-point-buy-increase":
        return this._adjustPointBuy(target?.dataset?.ability, 1);
      case "cb-point-buy-decrease":
        return this._adjustPointBuy(target?.dataset?.ability, -1);
      default:
        return false;
    }
  }

  /** Put the configured fixed array into the existing assignment pool. */
  _ensureFixedPool() {
    const st = this.state.stats;
    const fixed = this.method.fixed;
    if (st.pool?.length === fixed.length && st.pool.every((value, i) => value === fixed[i])) return;
    st.pool = [...fixed];
    st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, 0]));
    st.assignment = Object.fromEntries(ABILITY_ORDER.map((k) => [k, null]));
  }

  /** Initialize point buy without disturbing an already valid in-progress spread. */
  _ensurePointBuy() {
    const st = this.state.stats;
    const valid = ABILITY_ORDER.every((k) => {
      const score = st.values[k];
      return Number.isInteger(score) && score >= POINT_BUY_MIN && score <= POINT_BUY_MAX;
    }) && pointBuySpent(st.values) <= POINT_BUY_BUDGET;
    if (valid && !Object.values(st.assignment ?? {}).some((value) => value !== null && value !== undefined)) return;
    st.pool = [];
    st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, POINT_BUY_MIN]));
    st.assignment = Object.fromEntries(ABILITY_ORDER.map((k) => [k, null]));
  }

  /** Whether a one-point point-buy adjustment would leave a legal spread. */
  _canAdjustPointBuy(abil, delta) {
    if (!this.isPointBuy || !ABILITY_ORDER.includes(abil) || !Number.isInteger(delta) || Math.abs(delta) !== 1) return false;
    const current = this.state.stats.values[abil];
    const next = current + delta;
    const currentCost = pointBuyCost(current);
    const nextCost = pointBuyCost(next);
    if (currentCost === null || nextCost === null) return false;
    return pointBuySpent(this.state.stats.values) - currentCost + nextCost <= POINT_BUY_BUDGET;
  }

  /** Apply one point-buy increment/decrement, returning false when refused. */
  _adjustPointBuy(abil, delta) {
    if (!this._canAdjustPointBuy(abil, delta)) return false;
    this.state.stats.values[abil] += delta;
    return true;
  }

  onRender(root) {
    const st = this.state.stats;

    // --- Rolled dice: drag to place, or click as a fallback. ----------------
    root.querySelectorAll("[data-cb-pool]").forEach((el) => {
      const idx = Number(el.dataset.cbPool);
      const used = Object.values(st.assignment).includes(idx);
      if (!used) {
        el.setAttribute("draggable", "true");
        el.addEventListener("dragstart", (ev) => {
          this._picked = null;
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", JSON.stringify({ from: "pool", idx }));
        });
      }
      // Click fallback: pick up a die, then click a stat to place it.
      el.addEventListener("click", async () => {
        if (Object.values(st.assignment).includes(idx)) return; // already placed
        this._picked = this._picked === idx ? null : idx;
        await this.app.render();
      });
    });

    // --- Ability tiles: drop targets, draggable when filled. -----------------
    root.querySelectorAll("[data-cb-tile]").forEach((el) => {
      const abil = el.dataset.cbTile;
      const cur = st.assignment[abil];

      if (cur !== null && cur !== undefined) {
        el.setAttribute("draggable", "true");
        el.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", JSON.stringify({ from: "tile", abil }));
        });
      }

      el.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        el.classList.add("drop-hover");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drop-hover"));
      el.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        el.classList.remove("drop-hover");
        const data = this._readDrag(ev);
        if (!data) return;
        this._applyDrop(abil, data);
        this._picked = null;
        await this.app.render();
      });

      // Click fallback: place the picked die, or clear a filled stat.
      el.addEventListener("click", async () => {
        const held = st.assignment[abil];
        if (this._picked !== null) {
          this._assign(abil, this._picked);
          this._picked = null;
        } else if (held !== null && held !== undefined) {
          this._assign(abil, null);   // return the die to the pool
        }
        await this.app.render();
      });
    });

    // --- The rolled-dice row: drop a placed die here to return it. -----------
    const poolDrop = root.querySelector("[data-cb-pool-drop]");
    if (poolDrop) {
      poolDrop.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
      });
      poolDrop.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const data = this._readDrag(ev);
        if (data?.from === "tile") {
          this._assign(data.abil, null);
          await this.app.render();
        }
      });
    }
  }

  /** Parse the JSON payload off a drag event; null on anything malformed. */
  _readDrag(ev) {
    try { return JSON.parse(ev.dataTransfer.getData("text/plain")); }
    catch (_e) { return null; }
  }

  /** Resolve a drop onto `targetAbil` from either the pool or another tile. */
  _applyDrop(targetAbil, data) {
    const st = this.state.stats;
    if (data.from === "pool") {
      this._assign(targetAbil, data.idx);   // swaps any current occupant back to the pool
    } else if (data.from === "tile") {
      const srcAbil = data.abil;
      if (srcAbil === targetAbil) return;
      const srcIdx = st.assignment[srcAbil];
      const dstIdx = st.assignment[targetAbil];
      this._assign(targetAbil, srcIdx);      // target takes the dragged die, clears its old home
      if (dstIdx !== null && dstIdx !== undefined) this._assign(srcAbil, dstIdx); // swap
    }
  }

  async _roll(actionKey = "roll") {
    if (this.isFixed || this.isPointBuy) return;
    const m = this.method;
    const rolls = [];
    for (let i = 0; i < ABILITY_ORDER.length; i++) {
       
      rolls.push(await new Roll(m.formula).evaluate());
    }
    const results = rolls.map((r) => r.total);
    const st = this.state.stats;
    st.pool = results;
    this._picked = null;
    if (this.isAssign) {
      st.assignment = Object.fromEntries(ABILITY_ORDER.map((k) => [k, null]));
      st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, 0]));
    } else {
      st.values = Object.fromEntries(ABILITY_ORDER.map((k, i) => [k, results[i]]));
      st.assignment = Object.fromEntries(ABILITY_ORDER.map((k) => [k, null]));
    }
    await this._postRollCard(rolls, actionKey);
  }

  /**
   * Post a chat card recording the roll — the audit trail so players can't
   * quietly re-roll. Attaches the Roll objects so Dice So Nice animates and the
   * message stores the dice as proof.
   */
  async _postRollCard(rolls, actionKey) {
    const isAssign = this.isAssign;
    const methodLabel = game.i18n.localize(this.method.label);
    const heading = game.i18n.localize(`SDE.charBuilder.stats.card.${actionKey}`);
    const rows = rolls.map((r, i) => {
      const key = isAssign ? `#${i + 1}` : ABILITY_LABELS[ABILITY_ORDER[i]];
      const dice = (r.dice[0]?.results || [])
        .map((d) => (d.discarded || d.rerolled ? `<span class="dropped">${d.result}</span>` : `${d.result}`))
        .join(" ");
      return `<tr><td class="k">${key}</td><td class="t">${r.total}</td><td class="d">${dice}</td></tr>`;
    }).join("");
    const sub = isAssign ? `${methodLabel} — ${game.i18n.localize("SDE.charBuilder.stats.rollPool")}` : methodLabel;
    const content = `<div class="sde-cb-rollcard"><h4>${heading}</h4>`
      + `<div class="method">${sub}</div><table>${rows}</table></div>`;
    // The visible table is the audit trail (each die, dropped ones struck out),
    // so we can suppress the 3D dice unless the GM opted into the animation.
    const animate = builderDiceAnimation();
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        flavor: game.i18n.localize("SDE.charBuilder.title"),
        content,
        rolls: animate ? rolls : [],
        sound: animate ? CONFIG.sounds.dice : undefined,
      });
    } catch (e) {
      console.error("shadowdark-enhancer | char-builder roll card failed:", e);
    }
  }

  _resetRoll() {
    const st = this.state.stats;
    this._picked = null;
    if (this.isFixed) {
      this._ensureFixedPool();
      st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, 0]));
    } else if (this.isPointBuy) {
      st.pool = [];
      st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, POINT_BUY_MIN]));
    } else {
      st.pool = [];
      st.values = Object.fromEntries(ABILITY_ORDER.map((k) => [k, 0]));
    }
    st.assignment = Object.fromEntries(ABILITY_ORDER.map((k) => [k, null]));
  }

  /** Assign a pool index to an ability, swapping out whoever else held it. */
  _assign(abil, idx) {
    const st = this.state.stats;
    if (idx !== null) {
      for (const k of ABILITY_ORDER) {
        if (k !== abil && st.assignment[k] === idx) {
          st.assignment[k] = null;
          st.values[k] = 0;
        }
      }
    }
    st.assignment[abil] = idx;
    st.values[abil] = idx === null ? 0 : st.pool[idx];
  }
}
