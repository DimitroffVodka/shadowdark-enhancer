import { MODULE_ID } from "../shared/module-id.mjs";
import {
  getGuidelinesTable,
  guidelineFor,
  planLevelAdjust,
  spellLevelAdjustment,
} from "./level-guidelines.mjs";
import { actorToDraft } from "./encounter-creator.mjs";
import { buildNpcNotes } from "./npc-statblock.mjs";
import { createMutatedFromDraft } from "./monster-mutator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Where the pre-adjustment stats live. Deliberately NOT the v3 `mutation`
 *  provenance flag — this is a lightweight stat swap, not a generated effect. */
const BACKUP_FLAG = "quickAdjustBackup";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/** Render a number the way a stat block does. */
function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? String(v) : `+${v}`;
}

/**
 * Token HUD quick-adjust — re-level a monster in place.
 *
 * The Monster Creator remains the deep-edit path; this is the fast one: pick a
 * level, see exactly what would change, untick anything you want left alone,
 * apply. Every mutation is backed up to a flag first so Revert can put the
 * creature back exactly as it was.
 *
 * The stat block in `system.notes` is rebuilt on every apply. Shadowdark bakes
 * the printed line ("AC 9, HP 30, ATK 2 greatclub +6 (2d6) … LV 6") into the
 * actor's description, so changing the underlying fields without rewriting it
 * leaves the sheet contradicting itself.
 */
export class QuickAdjustApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-quick-adjust",
    tag: "div",
    classes: ["shadowdark", "sde-quick-adjust"],
    window: { title: "SDE.quickAdjust.title", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      "qa-apply":  QuickAdjustApp._onApply,
      "qa-revert": QuickAdjustApp._onRevert,
      "qa-copy":   QuickAdjustApp._onCreateCopy,
      "qa-step":   QuickAdjustApp._onStepLevel,
      "qa-open-creator": QuickAdjustApp._onOpenInCreator,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/quick-adjust.hbs` },
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    this._target = null;
    this._apply = { ac: true, hp: true, abilities: true, attacks: true };
  }

  get title() {
    return game.i18n.format("SDE.quickAdjust.title", { name: this.actor?.name ?? "Monster" });
  }

  static _instance = null;

  /** Only one panel at a time; clicking a different token retargets it rather
   *  than stacking a second window. */
  static open(actor) {
    const live = QuickAdjustApp._instance;
    if (live?.rendered) {
      live.actor = actor;
      live._target = null;
      live.render({ force: true });
      return live;
    }
    const app = new QuickAdjustApp({ actor });
    QuickAdjustApp._instance = app;
    app.render({ force: true });
    return app;
  }

  async close(options) {
    if (QuickAdjustApp._instance === this) QuickAdjustApp._instance = null;
    return super.close(options);
  }

  // ─── Reading the actor ──────────────────────────────────────────────────

  /** Current level as a plain number (`system.level` is `{value, xp}`). */
  static levelOf(actor) {
    const lvl = actor?.system?.level;
    const value = typeof lvl === "object" ? lvl?.value : lvl;
    return Number(value) || 0;
  }

  /** Normalized snapshot in the shape `planLevelAdjust` expects. */
  _snapshot() {
    const actor = this.actor;
    const sys = actor.system ?? {};
    return {
      level: QuickAdjustApp.levelOf(actor),
      ac: Number(sys.attributes?.ac?.value ?? 10),
      hp: {
        value: Number(sys.attributes?.hp?.value ?? 1),
        max:   Number(sys.attributes?.hp?.max ?? 1),
      },
      abilities: Object.fromEntries(
        ABILITY_KEYS.map(k => [k, Number(sys.abilities?.[k]?.mod ?? 0)]),
      ),
      attacks: actor.items
        .filter(i => i.type === "NPC Attack")
        .map(i => ({
          id: i.id,
          name: i.name,
          num:    Number(i.system?.attack?.num ?? 1),
          bonus:  Number(i.system?.bonuses?.attackBonus ?? 0),
          damage: String(i.system?.damage?.value ?? ""),
        })),
    };
  }

  _plan(target = this._targetLevel()) {
    return planLevelAdjust(this._snapshot(), target, {
      table: getGuidelinesTable(),
      applyAbilities: this._apply.abilities,
    });
  }

  _targetLevel() {
    if (Number.isFinite(this._target)) return this._target;
    return QuickAdjustApp.levelOf(this.actor);
  }

  /** Highest level the guidelines table covers — the stepper's ceiling. */
  _maxLevel() {
    const levels = Object.keys(getGuidelinesTable()).map(Number).filter(Number.isFinite);
    return levels.length ? Math.max(...levels) : 30;
  }

  /** −/+ stepper next to the target level. The native number spinners are
   *  hard to hit at Foundry's input size, so the panel provides its own. */
  static _onStepLevel(_event, target) {
    const step = Number(target?.dataset?.step) || 0;
    if (!step) return;
    const next = this._targetLevel() + step;
    this._target = Math.min(this._maxLevel(), Math.max(0, next));
    this.render();
  }

  async _prepareContext() {
    const actor = this.actor;
    const table = getGuidelinesTable();
    const current = QuickAdjustApp.levelOf(actor);
    const target = this._targetLevel();
    const plan = this._plan(target);

    const decorate = (row, isSigned = false) => row && {
      ...row,
      fromLabel:  isSigned ? signed(row.from) : String(row.from),
      toLabel:    isSigned ? signed(row.to) : String(row.to),
      deltaLabel: row.delta === 0 ? "" : signed(row.delta),
    };
    const group = key => plan.rows.filter(r => r.group === key);
    const abilities = group("abilities").map(r => decorate(r, true));

    // Spells push the creature above its written level; surfaced as advice so
    // the GM can pick the higher target deliberately.
    const spellBump = spellLevelAdjustment(actor.items.filter(i => i.type === "Spell"));

    const levels = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const maxLevel = levels[levels.length - 1] ?? 30;

    return {
      actorName: actor.name,
      img: actor.img,
      currentLevel: current,
      targetLevel: target,
      maxLevel,
      atMinLevel: target <= 0,
      atMaxLevel: target >= maxLevel,
      levelChanged: target !== current,
      apply: this._apply,
      guideline: guidelineFor(target, table),
      rows: { ac: decorate(group("ac")[0]), hp: decorate(group("hp")[0]), abilities },
      abilitiesChanged: abilities.some(r => r.changed),
      attacks: plan.attacks,
      hasAttacks: plan.attacks.length > 0,
      attacksChanged: plan.attacks.some(a => a.changed),
      changed: plan.changed,
      hasBackup: !!actor.getFlag(MODULE_ID, BACKUP_FLAG),
      spellBump: spellBump.adjustment,
      spellReasons: spellBump.reasons,
      spellLevel: current + spellBump.adjustment,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const level = this.element.querySelector("[data-qa-level]");
    level?.addEventListener("change", ev => {
      const v = Number(ev.currentTarget.value);
      this._target = Number.isFinite(v) ? Math.max(0, v) : null;
      this.render();
    });

    for (const box of this.element.querySelectorAll("[data-qa-apply]")) {
      box.addEventListener("change", ev => {
        const key = ev.currentTarget.dataset.qaApply;
        if (!(key in this._apply)) return;
        // A re-render, not a silent flip: HP is derived from CON, so toggling
        // Abilities changes the HP the preview is promising.
        this._apply[key] = ev.currentTarget.checked;
        this.render();
      });
    }
  }

  // ─── Applying ───────────────────────────────────────────────────────────

  /**
   * Capture everything this tool can touch, once, before the first change.
   * Subsequent adjustments keep the ORIGINAL backup so Revert always returns
   * to the creature as it shipped, not to the previous adjustment.
   */
  async _ensureBackup() {
    if (this.actor.getFlag(MODULE_ID, BACKUP_FLAG)) return;
    const sys = this.actor.system ?? {};
    const backup = {
      level: QuickAdjustApp.levelOf(this.actor),
      ac: Number(sys.attributes?.ac?.value ?? 10),
      hp: { max: Number(sys.attributes?.hp?.max ?? 1), value: Number(sys.attributes?.hp?.value ?? 1) },
      abilities: Object.fromEntries(ABILITY_KEYS.map(k => [k, Number(sys.abilities?.[k]?.mod ?? 0)])),
      notes: String(sys.notes ?? ""),
      attacks: Object.fromEntries(
        this.actor.items
          .filter(i => i.type === "NPC Attack")
          .map(i => [i.id, {
            num:    Number(i.system?.attack?.num ?? 1),
            bonus:  Number(i.system?.bonuses?.attackBonus ?? 0),
            damage: String(i.system?.damage?.value ?? ""),
            special: String(i.system?.damage?.special ?? ""),
          }]),
      ),
    };
    await this.actor.setFlag(MODULE_ID, BACKUP_FLAG, backup);
  }

  static async _onApply() {
    const actor = this.actor;
    if (!game.user.isGM) return;

    const target = this._targetLevel();
    const plan = this._plan(target);
    const checkedAny = Object.entries(this._apply).some(([key, on]) => {
      if (!on) return false;
      if (key === "attacks") return plan.attacks.length > 0;
      return true;
    });
    if (!checkedAny) {
      ui.notifications.warn(game.i18n.localize("SDE.quickAdjust.nothingChecked"));
      return;
    }
    if (!plan.changed && target === QuickAdjustApp.levelOf(actor)) {
      ui.notifications.info(game.i18n.format("SDE.quickAdjust.noChange", { level: target }));
      return;
    }

    try {
      await this._ensureBackup();

      const update = { "system.level.value": target };
      if (this._apply.ac) update["system.attributes.ac.value"] = plan.guideline.ac;
      if (this._apply.hp) {
        update["system.attributes.hp.max"] = plan.nextHp;
        update["system.attributes.hp.value"] = plan.nextHp;
      }
      if (this._apply.abilities) {
        for (const [key, value] of Object.entries(plan.nextAbilities)) {
          update[`system.abilities.${key}.mod`] = value;
        }
      }

      const itemUpdates = this._apply.attacks
        ? plan.attacks.map(a => ({
          _id: a.id,
          "system.attack.num": a.num.to,
          "system.bonuses.attackBonus": a.bonus.to,
          "system.damage.value": a.damage.to,
        }))
        : [];

      // Items first: the stat block below is rebuilt from the actor's items,
      // so it has to read the NEW attack lines.
      if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);
      await actor.update(update);

      // Shadowdark prints a full stat block into system.notes. Rebuild it from
      // the freshly-updated actor so the description can't drift from the data.
      const draft = await actorToDraft(actor);
      await actor.update({ "system.notes": buildNpcNotes(draft) });

      ui.notifications.info(
        game.i18n.format("SDE.quickAdjust.applied", { name: actor.name, level: target }),
      );
      this._target = null;
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | quick adjust failed:`, err);
      ui.notifications.error(`Quick adjust failed: ${err.message}`);
    }
  }

  static async _onRevert() {
    const actor = this.actor;
    if (!game.user.isGM) return;

    const backup = actor.getFlag(MODULE_ID, BACKUP_FLAG);
    if (!backup) {
      ui.notifications.warn(game.i18n.localize("SDE.quickAdjust.noBackup"));
      return;
    }

    try {
      const update = {
        "system.level.value": backup.level,
        "system.attributes.ac.value": backup.ac,
        "system.attributes.hp.max": backup.hp.max,
        "system.attributes.hp.value": backup.hp.value,
        "system.notes": backup.notes,
      };
      for (const [key, mod] of Object.entries(backup.abilities ?? {})) {
        update[`system.abilities.${key}.mod`] = mod;
      }

      // Only restore attacks that still exist — an item deleted since the
      // backup was taken is not this tool's to resurrect.
      const itemUpdates = Object.entries(backup.attacks ?? {})
        .filter(([id]) => actor.items.get(id))
        .map(([id, a]) => ({
          _id: id,
          "system.attack.num": a.num,
          "system.bonuses.attackBonus": a.bonus,
          "system.damage.value": a.damage,
        }));

      if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);
      await actor.update(update);
      await actor.unsetFlag(MODULE_ID, BACKUP_FLAG);

      ui.notifications.info(game.i18n.format("SDE.quickAdjust.reverted", { name: actor.name }));
      this._target = null;
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | quick adjust revert failed:`, err);
      ui.notifications.error(`Revert failed: ${err.message}`);
    }
  }

  /**
   * Hand this monster off to the full Creator for detailed work — features,
   * spells, actions, description. The Creator records the actor as its source,
   * so its Save updates this monster in place rather than making a near-copy.
   *
   * Any UNAPPLIED level change here is deliberately not carried over: the
   * Creator's own Level Baseline section can apply it, and silently baking in
   * a pending change the GM hasn't committed would be a surprise.
   */
  static async _onOpenInCreator() {
    const actor = this.actor;
    if (!actor) return;
    try {
      const { MonsterCreator } = await import("./encounter-creator.mjs");
      await MonsterCreator.openWithActor(actor);
      await this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | could not open the Creator:`, err);
      ui.notifications.error(`Could not open the Monster Creator: ${err.message}`);
    }
  }

  /**
   * Build a NEW actor at the target level, leaving the original untouched.
   * Reuses the Creator's own draft→actor path so the copy carries the same
   * provenance a Creator-made variant would.
   */
  static async _onCreateCopy() {
    if (!game.user.isGM) return;
    const target = this._targetLevel();
    const plan = this._plan(target);

    try {
      const draft = await actorToDraft(this.actor);
      draft.level = target;
      if (this._apply.ac) draft.ac = plan.guideline.ac;
      if (this._apply.hp) {
        draft.hp.max = plan.nextHp;
        draft.hp.value = plan.nextHp;
      }
      if (this._apply.abilities) {
        for (const [key, value] of Object.entries(plan.nextAbilities)) draft.abilities[key] = value;
      }
      if (this._apply.attacks) {
        const byId = new Map(plan.attacks.map(a => [a.id, a]));
        for (const action of draft.actions) {
          // actorToDraft mints fresh draft ids, so match the plan (built from
          // the actor's items) by name rather than by id.
          const row = [...byId.values()].find(r => r.name === action.name);
          if (!row || action.type !== "NPC Attack") continue;
          action.num = row.num.to;
          action.bonus = row.bonus.to;
          action.damage = row.damage.to;
        }
      }
      // Name goes through customName, not draft.name — the mutator records
      // draft.name as the provenance baseName.
      const actor = await createMutatedFromDraft(draft, [], `${this.actor.name} (LV ${target})`);
      if (actor) {
        ui.notifications.info(game.i18n.format("SDE.quickAdjust.copyCreated", { name: actor.name }));
      }
    } catch (err) {
      console.error(`${MODULE_ID} | quick adjust copy failed:`, err);
      ui.notifications.error(`Create copy failed: ${err.message}`);
    }
  }
}

/**
 * Token HUD entry point. GM-only, NPC tokens only. Registered once from the
 * module entry's ready hook.
 */
export function registerQuickAdjustHUD() {
  Hooks.on("renderTokenHUD", (hud, html, _tokenData) => {
    if (!game.user.isGM) return;
    const actor = hud?.object?.actor;
    if (!actor || actor.type !== "NPC") return;

    // v14 hands over an HTMLElement; older callers (and some modules) still
    // pass jQuery. Handle both, like the loot HUD button does.
    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector(".col.right") ?? root?.querySelector(".right");
    if (!col) return;

    const btn = document.createElement("div");
    btn.classList.add("control-icon");
    btn.dataset.action = "sde-quick-adjust";
    btn.title = game.i18n.localize("SDE.quickAdjust.hudTooltip");
    btn.innerHTML = `<i class="fa-solid fa-scale-balanced"></i>`;
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      hud.close();
      QuickAdjustApp.open(actor);
    });
    col.appendChild(btn);
  });
}
