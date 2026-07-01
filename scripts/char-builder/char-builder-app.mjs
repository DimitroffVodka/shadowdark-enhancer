import { MODULE_ID } from "../module-id.mjs";
import { CharBuilderState } from "./state.mjs";
import { DEFAULT_STAT_METHOD } from "./constants.mjs";
import { commitCharacter } from "./commit.mjs";
import { StatsStep } from "./steps/stats-step.mjs";
import { AncestryStep } from "./steps/ancestry-step.mjs";
import { ClassStep } from "./steps/class-step.mjs";
import { LanguagesStep } from "./steps/languages-step.mjs";
import { BackgroundStep } from "./steps/background-step.mjs";
import { AlignmentStep } from "./steps/alignment-step.mjs";
import { DeityStep } from "./steps/deity-step.mjs";
import { HpStep } from "./steps/hp-step.mjs";
import { GoldStep } from "./steps/gold-step.mjs";
import { GearStep } from "./steps/gear-step.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Shadowdark Character Builder — a guided, ordered replacement for the system's
 * random `CharacterGeneratorSD`. Vagabond-style layout (top tab bar, list/detail/
 * aside body, per-section + full random), Shadowdark theming; steps assemble a
 * PlayerSD actor that the system's own `createActorFromData` commits on finish.
 */
export class ShadowdarkCharBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    let statMethod = DEFAULT_STAT_METHOD;
    try {
      statMethod = game.settings.get(MODULE_ID, "charBuilderStatMethod") ?? DEFAULT_STAT_METHOD;
    } catch (_e) { /* setting not registered yet */ }

    // NB: `state` is getter-only on ApplicationV2 (render lifecycle) — the
    // builder's own state lives on `builderState`.
    this.builderState = new CharBuilderState({ level0: !!options.level0, statMethod });
    this.actor = options.actor ?? null;
    this.stepIndex = 0;
    this.steps = [
      new StatsStep(this),
      new AncestryStep(this),
      new ClassStep(this),
      new LanguagesStep(this),
      new BackgroundStep(this),
      new AlignmentStep(this),
      new DeityStep(this),
      new HpStep(this),
      new GoldStep(this),
      new GearStep(this),
    ];
  }

  static DEFAULT_OPTIONS = {
    id: "sde-char-builder",
    classes: ["shadowdark", "sde-char-builder"],
    window: {
      title: "SDE.charBuilder.title",
      icon: "fa-solid fa-user-plus",
      resizable: true,
    },
    position: { width: 1040, height: 780 },
    actions: {
      "cb-goto": ShadowdarkCharBuilder._onGoto,
      "cb-prev": ShadowdarkCharBuilder._onPrev,
      "cb-next": ShadowdarkCharBuilder._onNext,
      "cb-finish": ShadowdarkCharBuilder._onFinish,
      "cb-dismiss": ShadowdarkCharBuilder._onDismiss,
      "cb-random": ShadowdarkCharBuilder._onRandom,
      "cb-full-random": ShadowdarkCharBuilder._onFullRandom,
      "cb-roll-stats": ShadowdarkCharBuilder._onStepAction,
      "cb-reroll-stats": ShadowdarkCharBuilder._onStepAction,
      "cb-reset-stats": ShadowdarkCharBuilder._onStepAction,
      "cb-roll-hp": ShadowdarkCharBuilder._onStepAction,
      "cb-max-hp": ShadowdarkCharBuilder._onStepAction,
      "cb-roll-gold": ShadowdarkCharBuilder._onStepAction,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/char-builder/char-builder.hbs` },
  };

  get activeStep() { return this.steps[this.stepIndex]; }

  async _prepareContext() {
    const step = this.activeStep;
    const stepCtx = await step.prepareContext();
    return {
      steps: this.steps.map((s, i) => ({
        id: s.id,
        label: game.i18n.localize(s.label),
        icon: s.icon,
        active: i === this.stepIndex,
        complete: s.isComplete(),
        index: i,
        num: i + 1,
      })),
      stepPartial: step.partial,
      stepId: step.id,
      step: stepCtx,
      nav: {
        canPrev: this.stepIndex > 0,
        isLast: this.stepIndex === this.steps.length - 1,
        supportsRandom: step.supportsRandom?.() ?? false,
        showFullRandom: this.stepIndex === 0,
        allComplete: this.steps.every((s) => s.isComplete()),
      },
    };
  }

  _onRender(_context, _options) {
    this.activeStep.onRender(this.element);
  }

  // --- Navigation -----------------------------------------------------------

  static async _onGoto(_event, target) {
    const idx = Number(target?.dataset?.index);
    if (Number.isInteger(idx) && idx >= 0 && idx < this.steps.length) {
      this.stepIndex = idx;
      await this.render();
    }
  }

  static async _onPrev() {
    if (this.stepIndex > 0) { this.stepIndex -= 1; await this.render(); }
  }

  static async _onNext() {
    if (this.stepIndex < this.steps.length - 1) { this.stepIndex += 1; await this.render(); }
  }

  static async _onDismiss() { await this.close(); }

  static async _onRandom() {
    await this.activeStep.randomize?.();
    await this.render();
  }

  static async _onFullRandom() {
    for (const step of this.steps) {
      // eslint-disable-next-line no-await-in-loop
      if (step.supportsRandom?.()) await step.randomize?.();
    }
    await this.render();
  }

  /** Delegate a step-scoped action to the active step manager. */
  static async _onStepAction(event, target) {
    const changed = await this.activeStep.handleAction(target?.dataset?.action, event, target);
    if (changed !== false) await this.render();
  }

  static async _onFinish() {
    // Require the essentials before committing.
    const requiredIds = ["stats", "ancestry", "class"];
    const missing = this.steps.filter((s) => requiredIds.includes(s.id) && !s.isComplete());
    if (missing.length) {
      ui.notifications.warn(game.i18n.format("SDE.charBuilder.commit.incomplete", {
        steps: missing.map((s) => game.i18n.localize(s.label)).join(", "),
      }));
      return;
    }

    const st = this.builderState;
    const L = (k) => game.i18n.localize(k);
    const row = (labelKey, val) => `<li><span>${L(labelKey)}</span><b>${val}</b></li>`;
    const summary = `<div class="sde-cb-confirm"><p class="name">${st.name || L("SDE.charBuilder.defaultName")}</p><ul>`
      + row("SDE.charBuilder.step.ancestry", st.ancestry?.name || "—")
      + row("SDE.charBuilder.step.class", st.class?.name || "—")
      + row("SDE.charBuilder.step.background", st.background?.name || "—")
      + row("SDE.charBuilder.step.alignment", CONFIG.SHADOWDARK?.ALIGNMENTS?.[st.alignment] ?? st.alignment)
      + row("SDE.charBuilder.step.deity", st.deity?.name || "—")
      + row("SDE.charBuilder.step.hp", st.hp.max || "—")
      + row("SDE.charBuilder.step.gold", `${st.coins.gp} gp`)
      + row("SDE.charBuilder.commit.contents", `${st.gear.length} ${L("SDE.charBuilder.commit.items")}, ${st.spells.length} ${L("SDE.charBuilder.commit.spells")}`)
      + "</ul></div>";

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("SDE.charBuilder.commit.title"), icon: "fa-solid fa-user-plus" },
      content: summary,
      yes: { label: L("SDE.charBuilder.commit.create"), icon: "fa-solid fa-check" },
      no: { label: L("SDE.charBuilder.commit.back") },
    });
    if (!ok) return;

    try {
      const actor = await commitCharacter(st);
      if (actor !== undefined) await this.close();
    } catch (e) {
      console.error("shadowdark-enhancer | char-builder commit failed:", e);
      ui.notifications.error(L("SDE.charBuilder.commit.failed"));
    }
  }

  /** @override — the app uses a fixed element id, so it is a singleton. */
  async close(options) {
    if (ShadowdarkCharBuilder._instance === this) ShadowdarkCharBuilder._instance = null;
    return super.close(options);
  }

  /** Entry point — open the builder (singleton; brings an open one to front). */
  static open(options = {}) {
    const existing = ShadowdarkCharBuilder._instance;
    if (existing?.rendered) {
      existing.bringToFront?.();
      return existing;
    }
    ShadowdarkCharBuilder._instance = new ShadowdarkCharBuilder(options);
    return ShadowdarkCharBuilder._instance.render(true);
  }
}

