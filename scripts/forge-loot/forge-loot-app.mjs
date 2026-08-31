/**
 * Shadowdark Enhancer — Forge & Loot window (G4).
 *
 * The ApplicationV2 layer is deliberately thin.  Generator rules and all
 * persistence live behind `ForgeLootController`'s adapter contract in
 * forge-loot-core.mjs; this file only selects a generator, collects its
 * declared inputs, and presents the immutable preview/approve boundary.
 */
import { isActiveGM } from "../shared/gm-relay.mjs";
import {
  FORGE_LOOT_PHASES,
  GENERATOR_LABELS,
  ForgeLootController,
  ForgeLootGenerators,
  buildPreviewDisplay,
  canApprovePreview,
  canGeneratePreview,
} from "./forge-loot-core.mjs";
import { ensureRivalClassTableFresh } from "./rival-class-table-adapter.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomSeed() {
  return foundry.utils?.randomID?.() ?? `forge-loot-${Date.now().toString(36)}`;
}

function fieldValue(input, field) {
  const value = input?.[field.key];
  if (value === undefined || value === null) return field.default ?? "";
  return value;
}

function fieldContext(field, input) {
  const type = ["text", "number", "checkbox", "select", "textarea"].includes(field.type) ? field.type : "text";
  return {
    key: String(field.key),
    label: String(field.label ?? field.key),
    hint: field.hint ? String(field.hint) : "",
    type,
    isCheckbox: type === "checkbox",
    isSelect: type === "select",
    isTextarea: type === "textarea",
    required: field.required === true,
    placeholder: field.placeholder ? String(field.placeholder) : "",
    value: fieldValue(input, field),
    checked: type === "checkbox" && fieldValue(input, field) === true,
    options: Array.isArray(field.options)
      ? field.options.map((option) => ({
        value: String(typeof option === "object" ? option.value : option),
        label: String(typeof option === "object" ? option.label ?? option.value : option),
        selected: String(fieldValue(input, field)) === String(typeof option === "object" ? option.value : option),
      }))
      : [],
  };
}

function diagnosticContext(values) {
  return (values ?? []).map((entry) => ({
    code: entry.code,
    message: entry.message,
    evidence: entry.evidence == null ? "" : typeof entry.evidence === "string" ? entry.evidence : JSON.stringify(entry.evidence),
  }));
}

export class ForgeLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-forge-loot",
    tag: "form",
    window: { title: "Forge & Loot", icon: "fas fa-hammer", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      selectGenerator: ForgeLootApp.prototype._onSelectGenerator,
      setInput: ForgeLootApp.prototype._onSetInput,
      generatePreview: ForgeLootApp.prototype._onGeneratePreview,
      reroll: ForgeLootApp.prototype._onReroll,
      cancel: ForgeLootApp.prototype._onCancel,
      approve: ForgeLootApp.prototype._onApprove,
      reset: ForgeLootApp.prototype._onReset,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/forge-loot.hbs" },
  };

  static _instance = null;

  /** Open the one shared preview-first Forge & Loot tool (GM only). */
  static open({ generator = null, seed = null, input = {}, controller = null } = {}) {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can use Forge & Loot.");
      return null;
    }
    // A class import can change eligibility without opening the tool.  Refresh
    // the derived table in the background before a Rival plan can consume it;
    // the adapter coalesces this with any invalidation refresh already running.
    void ensureRivalClassTableFresh({ game }).catch((error) =>
      console.error("shadowdark-enhancer | Rival class table freshness check failed:", error));
    if (!this._instance) {
      this._instance = new ForgeLootApp({
        controller: controller ?? new ForgeLootController({
          registry: ForgeLootGenerators,
          seed: seed ?? randomSeed(),
          isActiveGM,
        }),
      });
    }
    const inst = this._instance;
    if (generator) inst._controller.selectGenerator(generator, input);
    else if (Object.keys(input ?? {}).length) inst._controller.setInputs(input);
    if (seed) inst._controller.setSeed(seed);
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }

  constructor({ controller = null, ...options } = {}) {
    super(options);
    this._controller = controller ?? new ForgeLootController({ registry: ForgeLootGenerators, seed: randomSeed(), isActiveGM });
    this._renderAbort = null;
  }

  get state() {
    return this._controller.state;
  }

  async close(options = {}) {
    this._controller.cancel();
    this._renderAbort?.abort();
    ForgeLootApp._instance = null;
    return super.close(options);
  }

  async _prepareContext() {
    const state = this.state;
    const adapters = this._controller.registry?.list?.() ?? [];
    const adapter = this._controller.adapter;
    const previewView = buildPreviewDisplay({
      preview: state.preview,
      view: state.previewView,
      generator: state.generator,
      seed: state.seed,
    });
    const diagnostics = {
      missing: diagnosticContext(state.missing),
      exclusions: diagnosticContext(state.exclusions),
      warnings: diagnosticContext(state.warnings),
    };
    return {
      phase: state.phase,
      seed: state.seed,
      rerollCount: state.rerollCount,
      generator: state.generator,
      generators: adapters.map((entry) => ({
        id: entry.id,
        label: entry.label ?? GENERATOR_LABELS[entry.id] ?? entry.id,
        description: entry.description ?? "",
        icon: entry.id === "rival" ? "fa-users" : "fa-user",
        selected: entry.id === state.generator,
      })),
      hasGenerator: !!state.generator,
      generatorLabel: adapter?.label ?? GENERATOR_LABELS[state.generator] ?? "Forge & Loot",
      generatorDescription: adapter?.description ?? "",
      fields: (adapter?.fields ?? []).map((field) => fieldContext(field, state.input)),
      preview: previewView,
      hasPreview: !!state.preview,
      canPreview: canGeneratePreview(state),
      canApprove: canApprovePreview(state),
      canReroll: !!state.generator && state.phase !== FORGE_LOOT_PHASES.PLANNING
        && state.phase !== FORGE_LOOT_PHASES.COMMITTING && state.phase !== FORGE_LOOT_PHASES.COMMITTED,
      canCancel: state.phase !== FORGE_LOOT_PHASES.COMMITTING && state.phase !== FORGE_LOOT_PHASES.COMMITTED,
      isPlanning: state.phase === FORGE_LOOT_PHASES.PLANNING,
      isBlocked: state.phase === FORGE_LOOT_PHASES.BLOCKED || state.blocked,
      isDisabled: state.phase === FORGE_LOOT_PHASES.DISABLED || state.disabled,
      isCommitting: state.phase === FORGE_LOOT_PHASES.COMMITTING,
      isCommitted: state.phase === FORGE_LOOT_PHASES.COMMITTED,
      isCancelled: state.phase === FORGE_LOOT_PHASES.CANCELLED,
      statusMessage: state.statusMessage,
      error: state.error ? diagnosticContext([state.error])[0] : null,
      diagnostics,
      result: state.result,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;
    for (const input of this.element.querySelectorAll("[data-forge-input]")) {
      input.addEventListener("change", () => {
        const value = input.type === "checkbox" ? input.checked : input.value;
        this._controller.setInput(input.dataset.forgeInput, value);
        this.render();
      }, { signal });
    }
  }

  _onSelectGenerator(_event, target) {
    const result = this._controller.selectGenerator(target.dataset.generator);
    if (!result.ok) ui.notifications?.warn("That generator is not available.");
    this.render();
  }

  _onSetInput(_event, target) {
    const value = target.type === "checkbox" ? target.checked : target.value;
    this._controller.setInput(target.dataset.forgeInput, value);
  }

  _onGeneratePreview() {
    // Recheck immediately before a Rival planner consumes the derived table;
    // opening the window performs the same coalesced check in the background.
    const freshness = this.state.generator === "rival"
      ? ensureRivalClassTableFresh({ game })
      : Promise.resolve();
    const work = freshness.then(() => this._controller.preview());
    this.render();
    return work.finally(() => this.render());
  }

  _onReroll() {
    const work = this._controller.reroll();
    this.render();
    return work.finally(() => this.render());
  }

  _onCancel() {
    const result = this._controller.cancel();
    if (!result.ok) {
      const message = result.reason === "commit-in-progress"
        ? "An approval is already in progress."
        : "That preview was already consumed; start over for a new proposal.";
      ui.notifications?.warn(message);
      this.render();
      return;
    }
    return this.close();
  }

  _onApprove() {
    const work = this._controller.approve();
    this.render();
    return work
      .then((result) => {
        if (result.ok) ui.notifications?.info("Created from the approved Forge & Loot preview.");
        else if (result.error?.message) ui.notifications?.error(`Forge & Loot blocked: ${result.error.message}`);
        return result;
      })
      .finally(() => this.render());
  }

  _onReset() {
    if (this.state.commit?.inFlight) {
      ui.notifications?.warn("An approval is already in progress.");
      return;
    }
    this._controller.dispatch({ type: "reset", seed: randomSeed() });
    this.render();
  }
}

export { ForgeLootGenerators };
