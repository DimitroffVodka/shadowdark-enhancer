/**
 * Regional Training — the window (Foundry AppV2).
 *
 * Pick a character, pick a trainer, roll the trainer's d4, keep the technique.
 *
 * The shape follows what the book prints rather than what would be tidiest.
 * A trainer spread is four TASKS and four BENEFITS, gated on "once each", so
 * the window is per-trainer and shows all four faces at once with the ones
 * already taught struck through — a trainer is worth four visits and the
 * player should be able to see how many are left. The d4 is rolled honestly
 * and then walked forward to the next untaught face (training-core's
 * `resolveRoll`) instead of rerolled, so a spent trainer cannot spin forever.
 *
 * The benefit text shown is the GM's OWN imported table row. When that table
 * is not imported the window says so and falls back to this module's
 * compressed label, exactly like pit-fighting naming a missing table rather
 * than inventing its contents.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import {
  TRAINERS,
  isMechanical,
  remainingRolls,
  resolveRoll,
  trainerByKey,
  trainersByRegion,
} from "./training-core.mjs";
import { benefitText, findBenefitsTable, grantBenefit, takenRolls } from "./training-grant.mjs";
import { importTrainerJournals, trainerJournal } from "./training-journal.mjs";
import { trainerArt } from "./training-art.mjs";
import { QUESTS_CHANGED, Quests } from "../quests/quests.mjs";
import { trainerTaskQuests } from "../quests/quest-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

export class TrainingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-training",
    classes: ["shadowdark", "sde-training"],
    window: { title: "SDE.training.title", icon: "fa-solid fa-dumbbell", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      trnRoll: function (...a) { return this._onRoll(...a); },
      trnImport: function (...a) { return this._onImportJournals(...a); },
      trnOpenJournal: function (...a) { return this._onOpenJournal(...a); },
      trnTakeTask: function (...a) { return this._onTakeTask(...a); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/training.hbs` },
  };

  /**
   * Open on a character.
   *
   * Defaults to the user's own character, then to a selected token's actor —
   * a player opening this almost always means "me", and a GM almost always
   * means "the one I have selected".
   */
  static open({ actor = null, trainer = null } = {}) {
    const subject = actor
      ?? game.user?.character
      ?? canvas?.tokens?.controlled?.[0]?.actor
      ?? null;
    const trainerKey = trainerByKey(trainer)?.key ?? null;
    const existing = foundry.applications.instances?.get?.("sde-training");
    if (existing) {
      existing.actorId = subject?.id ?? existing.actorId;
      if (trainerKey) existing.trainerKey = trainerKey;
      existing.render(true);
      existing.bringToFront?.();
      return existing;
    }
    const app = new TrainingApp();
    app.actorId = subject?.id ?? null;
    app.trainerKey = trainerKey ?? TRAINERS[0].key;
    app.render(true);
    return app;
  }

  get actor() {
    return this.actorId ? game.actors?.get(this.actorId) ?? null : null;
  }

  // A task taken or completed in the Quest Log shows here without a reopen.
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._questHook = Hooks.on(QUESTS_CHANGED, () => this.render());
  }

  _onClose(options) {
    Hooks.off(QUESTS_CHANGED, this._questHook);
    super._onClose(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const el of this.element.querySelectorAll("[data-trn-select]")) {
      el.addEventListener("change", (ev) => {
        const which = ev.currentTarget.dataset.trnSelect;
        if (which === "actor") this.actorId = ev.currentTarget.value || null;
        if (which === "trainer") this.trainerKey = ev.currentTarget.value;
        this.render();
      });
    }
  }

  async _prepareContext() {
    const actor = this.actor;
    const trainer = trainerByKey(this.trainerKey) ?? TRAINERS[0];
    const taken = actor ? takenRolls(actor, trainer.key) : [];
    const table = await findBenefitsTable(trainer.table);

    // The book's own wording, one row per face, read from the GM's table. An
    // absent table is a stated fact in the window, not a silent fallback.
    const benefits = [];
    for (const b of trainer.benefits) {
      benefits.push({
        roll: b.roll,
        label: b.label,
        printed: table ? await benefitText(trainer, b.roll) : "",
        todo: b.todo ?? "",
        mechanical: isMechanical(b),
        taken: taken.includes(b.roll),
      });
    }

    // The description and four TASKS, read from the filed journal's own flag
    // rather than by re-parsing the HTML this module wrote. No journal yet is
    // a normal state, not an error — the window offers the import instead.
    const journal = await trainerJournal(trainer.key);
    const page = journal?.pages?.find?.(
      (p) => p.getFlag(MODULE_ID, "regionTraining")?.trainer === trainer.key
    );
    const filed = page?.getFlag(MODULE_ID, "regionTraining") ?? {};
    const left = actor ? remainingRolls(trainer.key, taken).length : trainer.benefits.length;

    // Each task with the quest this character took it as, if any (#189).
    // "Once each" is not decided here: it stays on the grant.
    const questOf = actor ? trainerTaskQuests(Quests.list(), { actorUuid: actor.uuid, trainer: trainer.key }) : new Map();
    const tasks = (filed.tasks ?? []).map((text, index) => {
      const quest = questOf.get(index);
      return {
        text,
        index,
        quest: !!quest,
        done: quest?.status === "completed",
        canTake: !quest && !!actor && !!game.user?.isGM,
        // The quest is personal, so there is nothing to file until a character is chosen.
        needsActor: !quest && !actor && !!game.user?.isGM,
      };
    });

    return {
      tasks,
      description: filed.description ?? "",
      art: trainerArt(trainer.key),
      journalUuid: journal?.uuid ?? null,
      canImport: !!game.user?.isGM,
      // Rolling needs a character AND something left to learn. Disabling the
      // button is the honest state; the click handler still guards both.
      canRoll: !!actor && left > 0,
      actors: (game.actors ?? [])
        .filter((a) => a.type === "Player" && a.isOwner)
        .map((a) => ({ id: a.id, name: a.name, selected: a.id === this.actorId })),
      actorName: actor?.name ?? "",
      groups: trainersByRegion().map(({ region, trainers }) => ({
        region: region ?? t("SDE.training.noRegion"),
        trainers: trainers.map((x) => ({ key: x.key, name: `${x.topic} — ${x.trainer}`, selected: x.key === trainer.key })),
      })),
      trainer,
      benefits,
      remaining: left,
      spent: !!actor && left === 0,
      tableMissing: !table,
      hasActor: !!actor,
    };
  }

  /**
   * Roll the trainer's d4 and teach what it lands on.
   *
   * The roll is shown to the table (a real Roll, posted as a chat message) and
   * then walked to the next untaught face if it duplicated one — the player
   * sees the die they actually rolled, and still gets a technique.
   */
  async _onRoll() {
    const actor = this.actor;
    const trainer = trainerByKey(this.trainerKey);
    if (!actor || !trainer) { ui.notifications?.warn(t("SDE.training.notify.pickCharacter")); return; }

    const taken = takenRolls(actor, trainer.key);
    if (!remainingRolls(trainer.key, taken).length) {
      ui.notifications?.warn(t("SDE.training.notify.spent", { trainer: trainer.trainer }));
      return;
    }

    const roll = await new Roll("1d4").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: t("SDE.training.rollFlavor", { trainer: trainer.trainer, topic: trainer.topic }),
    });
    const granted = resolveRoll(trainer.key, roll.total, taken);

    const benefit = trainer.benefits.find((b) => b.roll === granted);
    let choiceKey = null;
    if (benefit?.choice?.length) {
      choiceKey = await this._askChoice(benefit);
      if (!choiceKey) return; // cancelled: nothing is written
    }

    const result = await grantBenefit(actor, trainer.key, granted, choiceKey);
    if (!result.ok) { ui.notifications?.error(t(`SDE.training.notify.${result.error}`)); return; }

    const lines = [
      `<p><strong>${result.item.name}</strong></p>`,
      ...(result.notes ?? []).map((n) => `<p>${n}</p>`),
    ];
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: lines.join(""),
      flavor: t("SDE.training.cardFlavor", { trainer: trainer.trainer }),
    });
    this.render();
  }

  /**
   * Read the 21 trainer spreads out of the GM's PDF and file them.
   *
   * Reports what it could not read rather than filing a silently empty entry:
   * a page that does not parse names itself, and a short read still files but
   * says how many tasks it found.
   */
  async _onImportJournals() {
    const button = this.element.querySelector("[data-action='trnImport']");
    if (button) button.disabled = true;
    try {
      const r = await importTrainerJournals();
      if (!r.ok) { ui.notifications?.error(t(`SDE.training.notify.${r.error}`)); return; }
      ui.notifications?.info(t("SDE.training.notify.imported", { created: r.created, updated: r.updated }));
      for (const p of r.problems) console.warn(`${MODULE_ID} | training journal`, p);
      if (r.problems.length) ui.notifications?.warn(t("SDE.training.notify.importProblems", { n: r.problems.length }));
    }
    finally {
      if (button) button.disabled = false;
      this.render();
    }
  }

  /**
   * Take one task as a quest for the chosen character (GM). The task's text
   * is read back from the filed journal, not from the page.
   */
  async _onTakeTask(_event, target) {
    const actor = this.actor;
    const trainer = trainerByKey(this.trainerKey);
    if (!actor || !trainer) { ui.notifications?.warn(t("SDE.training.notify.pickCharacter")); return; }
    const task = Number(target?.dataset?.task);
    const journal = await trainerJournal(trainer.key);
    const page = journal?.pages?.find?.((p) => p.getFlag(MODULE_ID, "regionTraining")?.trainer === trainer.key);
    const text = page?.getFlag(MODULE_ID, "regionTraining")?.tasks?.[task];
    if (!text) return;
    const quest = await Quests.takeTrainerTask({ actor, trainer: trainer.key, task, text, journalUuid: journal?.uuid ?? null });
    if (quest) ui.notifications?.info(t("SDE.training.notify.taskTaken", { name: quest.name }));
    this.render();
  }

  /** Open the filed journal entry for the trainer on show. */
  async _onOpenJournal() {
    const journal = await trainerJournal(this.trainerKey);
    if (!journal) { ui.notifications?.warn(t("SDE.training.notify.noJournal")); return; }
    journal.sheet?.render(true);
  }

  /** Which branch of an either/or benefit. Cancel writes nothing. */
  async _askChoice(benefit) {
    const buttons = benefit.choice.map((c) => ({ action: c.key, label: c.label }));
    try {
      return await DialogV2.wait({
        window: { title: t("SDE.training.choiceTitle") },
        content: `<p>${benefit.label}</p>`,
        buttons,
      });
    }
    catch { return null; }
  }
}
