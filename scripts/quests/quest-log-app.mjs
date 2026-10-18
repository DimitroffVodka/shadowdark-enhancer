/**
 * Shadowdark Enhancer — the Quest Log window (Foundry AppV2).
 *
 * One tab per status (Hidden is the GM's only), filters by character, party
 * and source, a list on the left and the chosen quest on the right. The GM
 * edits in place; a player sees the same quest read-only. Alt+Q, or the
 * button at the foot of the Journal sidebar.
 *
 * The UX borrows from Forien's Quest Log (MIT): status tabs, a details pane,
 * items dragged on as rewards. None of its code is used.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { dateToTime } from "../overland/hud-core.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { TRAINERS } from "../training/training-core.mjs";
import {
  SOURCE_KINDS, SOURCE_LABELS, STATUSES, STATUS_LABELS,
  addObjective, addSubStep, canRequestAccept, dateLabel, dayChanged, deadlineState, hasNotes, hasRewards, lastDayPrinted, MAX_NOTES, matchesFilter, objectiveProgress, planStatusChange, removeObjective, setObjectiveDone, setObjectiveSecret, setObjectiveText,
  textToParagraphs, timeToDate, trainerLabel, visibleStatuses,
} from "./quest-core.mjs";
import { QUESTS_CHANGED, Quests, actorName, partiesAvailable, partyActors, partyMembers, questPayoutContent } from "./quests.mjs";
import { L as t } from "../shared/i18n.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fields a GM types into; a redraw waits while one of them has focus. */
const DATE_FIELDS = ["startsAt", "deadline"];
const TEXT_FIELDS = "textarea, input:not([type]), input[type='text'], input[type='number']";

/** Run `fn` when the world clock moves into another day; returns the [hook, id] pair for Hooks.off. */
export function onQuestDay(fn) {
  return ["updateWorldTime", Hooks.on("updateWorldTime", (worldTime, delta) => {
    if (dayChanged(worldTime - delta, worldTime, secondsPerDay(game.time.calendar))) fn();
  })];
}

/** A trouble rumor hands back the trouble's existing quest, maybe Active: only Hidden ones were drafted. */
export const fromRumorsDrafted = (made) => made?.filter((q) => q.status === "hidden") ?? made;

/** The Hidden quest From rumors shows when nothing is new: the first (newest) one a rumor or trouble made. */
export const firstHiddenRumorQuest = (list) => list?.find((q) => q.status === "hidden" && ["rumor", "trouble"].includes(q.source?.kind)) ?? null;

export class QuestLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-quest-log",
    classes: ["shadowdark", "sde-quest-log", "sde-ui"],
    window: { title: "SDE.quests.title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 780, height: 620 },
    actions: {
      qlTab: function (_ev, el) { this.tab = el.dataset.status; this.selectedId = null; this.newSecret = false; this.newSubSecret = false; this.render(); },
      qlSelect: function (_ev, el) { this.selectedId = el.dataset.id; this.newSecret = false; this.newSubSecret = false; this.render(); },
      qlNew: function () { return this._onNew(); },
      qlFromRumors: function () { return this._onFromRumors(); },
      qlConfirmPayout: function () { return this._onConfirmPayout(); },
      qlCancelPayout: function () { this.payoutId = null; this.render(); },
      qlOpenJournal: function () { game.journal.get(this.selectedId)?.sheet?.render(true); },
      qlOpenSource: async function () {
        const uuid = Quests.get(this.selectedId)?.source.uuid;
        const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
        // A page opens inside its journal, in view mode: on its own its sheet is
        // the editor (a trouble's or a rumor ledger's page, #190).
        if (doc?.documentName === "JournalEntryPage") doc.parent.sheet.render(true, { pageId: doc.id });
        else doc?.sheet?.render(true);
      },
      qlJump: function () { return Quests.jumpToPin(this.selectedId); },
      qlAccept: function () { return Quests.requestAccept(this.selectedId); },
      qlAddObjective: function () { return this._onAddObjective(); },
      // Opens (or closes) the sub-step row under a step.
      qlAddSubStep: function (_ev, el) { this.subFor = this.subFor === el.dataset.objective ? null : el.dataset.objective; this._focusSub = !!this.subFor; this.render(); },
      qlSubmitSubStep: function () { return this._onAddSubStep(); },
      qlToggleSecret: function (_ev, el) {
        const id = el.dataset.objective;
        return this._edit((q) => setObjectiveSecret(q, id, !q.objectives.find((o) => o.id === id)?.secret));
      },
      qlRemoveObjective: function (_ev, el) { return this._edit((q) => removeObjective(q, el.dataset.objective)); },
      qlRemoveItem: function (_ev, el) {
        const i = Number(el.dataset.index);
        return this._edit((q) => ({ ...q, rewards: { ...q.rewards, items: q.rewards.items.filter((_x, n) => n !== i) } }));
      },
      qlClearDate: function (_ev, el) { return DATE_FIELDS.includes(el.dataset.date) && this._edit((q) => ({ ...q, [el.dataset.date]: null })); },
      qlClearGiver: function () { return this._edit((q) => ({ ...q, giver: null })); },
      qlRemoveNote: function (_ev, el) {
        const i = Number(el.dataset.index);
        return this._edit((q) => ({ ...q, rewards: { ...q.rewards, notes: q.rewards.notes.filter((_x, n) => n !== i) } }));
      },
      qlSubmitNote: function () { return this._onAddNote(); },
      qlRemoveCharacter: function (_ev, el) { return this._edit((q) => ({ ...q, characters: q.characters.filter((c) => c !== el.dataset.uuid) })); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/quest-log.hbs`, scrollable: [".ql-list", ".ql-detail"] },
  };

  constructor(options = {}, host = null) { super(options); this.host = host; }
  render(...args) { return this.host ? this.host.render() : super.render(...args); }

  /** Opens the window; with a quest id or uuid this user can read, on that quest's tab with it selected. */
  static open(idOrUuid) {
    const existing = foundry.applications.instances?.get?.("sde-quest-log");
    const app = existing ?? new QuestLogApp();
    const quest = idOrUuid ? Quests.get(idOrUuid) : null;
    if (quest) app.show(quest);
    app.render(true);
    if (existing) existing.bringToFront?.();
    return app;
  }

  /** Goes to a quest: its tab, selected, no filter hiding it. */
  show(quest) {
    this.tab = quest.status;
    this.selectedId = quest.id;
    this.filters = { character: "", party: "", source: "" };
  }

  tab = "active";
  subFor = null;
  newSecret = false;
  newSubSecret = false;
  whenOpen = false;   // the When block stays open across redraws once the GM opens it
  selectedId = null;
  payoutId = null;
  filters = { character: "", party: "", source: "" };

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._hook = Hooks.on(QUESTS_CHANGED, () => this._onQuestsChanged());
    this._dayHook = onQuestDay(() => this._onQuestsChanged());   // the Overdue chip and the due line follow the clock
  }

  /**
   * Redraw for a change, but never under the GM's typing: a render rebuilds
   * every field from the stored quest, so text not yet saved would be lost.
   * While a text field here has focus the redraw waits for it to lose focus.
   * Not for its change event: Enter fires change with focus still in the
   * field, before the write lands, and a redraw then would put the old value
   * back under the cursor.
   */
  _onQuestsChanged() {
    const field = document.activeElement;
    const typing = !!field && !!this.element?.contains(field) && field.matches(TEXT_FIELDS);
    if (!typing) { this.render(); return; }
    if (this._heldFor === field) return;
    this._heldFor = field;
    field.addEventListener("blur", event => { this._heldFor = null; if (!event.relatedTarget?.closest("[data-action]")) this.render(); }, { once: true });
  }

  _onClose(options) {
    Hooks.off(QUESTS_CHANGED, this._hook);
    if (this._dayHook) Hooks.off(...this._dayHook);
    super._onClose(options);
  }

  async _prepareContext() {
    const isGM = !!game.user?.isGM;
    const tabsFor = visibleStatuses(isGM);
    if (!tabsFor.includes(this.tab)) this.tab = "active";

    const hasParties = partiesAvailable();
    const parties = hasParties ? partyActors() : [];
    const players = (game.actors?.contents ?? []).filter((a) => a.type === "Player")
      .filter(a => !this.partyScope || partyMembers(this.partyScope).includes(a.uuid))
      .sort((a, b) => a.name.localeCompare(b.name));

    const f = this.partyScope ? { ...this.filters, party: this.partyScope } : this.filters;
    const shown = Quests.list().filter((q) => matchesFilter(q,
      { character: f.character || null, party: f.party || null, sourceKind: f.source || null },
      { partyMembers: f.party ? partyMembers(f.party) : [] }));
    const inTab = shown.filter((q) => q.status === this.tab);
    const quest = inTab.find((q) => q.id === this.selectedId) ?? inTab[0] ?? null;
    this.selectedId = quest?.id ?? null;

    return {
      isGM,
      inline: !!this.host,
      payoutHTML: quest && this.payoutId === quest.id ? questPayoutContent(quest, quest.name, { partyScope: this.partyScope }) : "",
      hasParties,
      tabs: tabsFor.map((s) => ({
        status: s, label: t(STATUS_LABELS[s]), active: s === this.tab,
        count: shown.filter((q) => q.status === s).length,
      })),
      filterCharacters: players.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === f.character })),
      filterParties: parties.map((p) => ({ uuid: p.uuid, name: p.name, selected: p.uuid === f.party })),
      filterSources: SOURCE_KINDS.map((k) => ({ kind: k, label: t(SOURCE_LABELS[k]), selected: k === f.source })),
      quests: inTab.map((q) => ({
        id: q.id, name: q.name, selected: q.id === this.selectedId,
        sourceLabel: t(SOURCE_LABELS[q.source.kind]), progress: objectiveProgress(q, { isGM }),
      })),
      quest: quest ? await this._detail(quest, { isGM, players, parties }) : null,
    };
  }

  /** The When block's two date rows, and the lines that say what a passed date will do. */
  _when(q, isGM) {
    const cal = game.time.calendar, now = game.time.worldTime, spd = secondsPerDay(cal);
    const state = deadlineState(q, now, spd);
    const open = q.status === "available" || q.status === "active";
    const row = (field) => {
      const d = q[field] === null ? null : timeToDate(cal, q[field]);
      return {
        field, label: t(field === "startsAt" ? "SDE.quests.startsAt" : "SDE.quests.deadline"),
        day: d?.day ?? "", year: d?.year ?? "", set: !!d,
        months: (cal.months?.values ?? []).map((m, i) => ({ value: i + 1, label: t(m.name), selected: d?.month === i + 1 })),
      };
    };
    return {
      rows: isGM ? [row("startsAt"), row("deadline")] : [],
      // A Hidden quest already overdue stays Hidden, so only a quest that will really appear gets the appears line.
      appearsPassed: isGM && q.status === "hidden" && q.startsAt !== null && now >= q.startsAt && state !== "overdue",
      failPassed: isGM && open && q.autoFail && state === "overdue",
      overdue: state === "overdue" && (open || (isGM && q.status === "hidden")),
      dueText: !isGM && q.deadline !== null ? t("SDE.quests.dueLine", { date: dateLabel(cal, q.deadline, t) }) : "",
    };
  }

  /** The right-hand pane for one quest. */
  async _detail(q, { isGM, players, parties }) {
    const r = q.rewards;
    return {
      ...q,
      when: this._when(q, isGM),
      whenOpen: this.whenOpen,
      sourceLabel: t(SOURCE_LABELS[q.source.kind]),
      statusLabel: t(STATUS_LABELS[q.status]),
      statusOptions: STATUSES.map((s) => ({ value: s, label: t(STATUS_LABELS[s]), selected: s === q.status })),
      characterList: q.characters.map((uuid) => ({ uuid, name: actorName(uuid) })),
      addableCharacters: players.filter((a) => !q.characters.includes(a.uuid)).map((a) => ({ uuid: a.uuid, name: a.name })),
      partyName: q.party ? actorName(q.party) : "",
      partyOptions: parties.map((p) => ({ uuid: p.uuid, name: p.name, selected: p.uuid === q.party })),
      descriptionHtml: isGM ? "" : await foundry.applications.ux.TextEditor.implementation.enrichHTML(textToParagraphs(q.description)),
      progress: objectiveProgress(q, { isGM }),
      revealOptions: ["all", "next"].map((v) => ({ value: v, label: t(v === "next" ? "SDE.quests.revealNext" : "SDE.quests.revealAll"), selected: v === q.reveal })),
      newSecret: this.newSecret,
      newSubSecret: this.newSubSecret,
      objectives: q.objectives.map((o, i, all) => ({
        ...o,
        // The add-a-sub-step row sits under the last sub-step of the chosen step.
        subRow: !!this.subFor && (o.parent ?? o.id) === this.subFor && (all[i + 1]?.parent ?? null) !== this.subFor,
      })),
      trainerName: r.training ? trainerLabel(r.training) : "",
      trainerOptions: TRAINERS.map((x) => ({ key: x.key, label: trainerLabel(x.key), selected: x.key === r.training })),
      renownSigned: r.renown > 0 ? `+${r.renown}` : r.renown,
      hasRewards: hasRewards(r),
      hasNotes: hasNotes(r),
      showRewards: hasRewards(r) || hasNotes(r),
      canAddNote: r.notes.length < MAX_NOTES,
      hasDeadline: q.deadline !== null,
      noteList: r.notes.map((text, index) => ({ text, index })),
      coinRewards: Object.entries(r.coins ?? {}).filter(([,n]) => n > 0).map(([coin,n]) => t("SDE.quests.reward.coins", { coin, n })),
      hasPin: Quests.hasPin(q),
      canAccept: canRequestAccept(q, { isGM }),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindControls(this.element, context);
    // Inline in the Party sheet, the sheet makes these keyboard links itself.
    if (!this.host) for (const control of this.element.querySelectorAll("a[data-action]")) {
      control.setAttribute("role", "button"); control.tabIndex = 0;
      control.addEventListener("keydown", (ev) => { if (["Enter", " "].includes(ev.key)) { ev.preventDefault(); control.click(); } });
    }
  }
  bindControls(root, context) {
    this.root = root;
    for (const el of root.querySelectorAll("[data-ql-filter]")) {
      el.addEventListener("change", (ev) => { this.filters[el.dataset.qlFilter] = ev.currentTarget.value; this.selectedId = null; this.render(); });
    }
    if (!context.isGM || !context.quest) return;

    for (const el of root.querySelectorAll("[data-ql-field]")) {
      el.addEventListener("change", (ev) => this._onField(el.dataset.qlField, ev.currentTarget));
    }
    root.querySelector("[data-ql-when]")?.addEventListener("toggle", (ev) => { this.whenOpen = ev.currentTarget.open; });
    for (const row of root.querySelectorAll("[data-ql-date]")) {
      for (const el of row.querySelectorAll("[data-part]")) el.addEventListener("change", () => this._onDate(row));
    }
    root.querySelector("[data-ql-new-objective]")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this._onAddObjective(); }
    });
    root.querySelector("[data-ql-new-substep]")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this._onAddSubStep(); }
    });
    root.querySelector("[data-ql-new-secret]")?.addEventListener("change", (ev) => { this.newSecret = ev.currentTarget.checked; });
    root.querySelector("[data-ql-new-substep-secret]")?.addEventListener("change", (ev) => { this.newSubSecret = ev.currentTarget.checked; });
    if (this._focusSub) { this._focusSub = false; root.querySelector("[data-ql-new-substep]")?.focus(); }
    root.querySelector("[data-ql-new-note]")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this._onAddNote(); }
    });
    const giverDrop = root.querySelector(".sde-ql-giver");
    if (giverDrop) {
      giverDrop.addEventListener("dragover", (ev) => { ev.preventDefault(); giverDrop.classList.add("sde-drag-over"); });
      giverDrop.addEventListener("dragleave", () => giverDrop.classList.remove("sde-drag-over"));
      giverDrop.addEventListener("drop", (ev) => this._onDropGiver(ev, giverDrop));
    }
    const drop = root.querySelector(".sde-ql-drop");
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("sde-drag-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("sde-drag-over"));
      drop.addEventListener("drop", (ev) => this._onDropItem(ev, drop));
    }
  }

  /** Apply `fn` to the stored quest, then redraw (the change hook redraws other windows). */
  async _edit(fn) {
    if (!this.selectedId) return;
    await Quests.update(this.selectedId, fn);
  }

  async _onField(field, el) {
    const id = this.selectedId;
    const value = el.type === "checkbox" ? el.checked : el.value;
    switch (field) {
      case "status": {
        const quest = Quests.get(id);
        if (this.host && quest && planStatusChange(quest, value).pay && !quest.payout) {
          this.payoutId = id;
          return this.render();
        }
        this.payoutId = null;
        // Follow the quest to its new tab; a cancelled payout redraws the old status.
        const moved = await Quests.setStatus(id, value, { openTraining: !this.host });
        if (moved) this.tab = moved.status;
        return this.render();
      }
      case "name": return Quests.update(id, { name: value });
      case "description": return this._edit((q) => ({ ...q, description: value }));
      case "party": return this._edit((q) => ({ ...q, party: value || null }));
      case "addCharacter": return value && this._edit((q) => ({ ...q, characters: [...q.characters, value] }));
      case "xp": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, xp: value } }));
      case "gp": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, coins: { ...q.rewards.coins, gp: value } } }));
      case "sp": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, coins: { ...q.rewards.coins, sp: value } } }));
      case "cp": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, coins: { ...q.rewards.coins, cp: value } } }));
      case "renown": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, renown: value } }));
      case "training": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, training: value || null } }));
      // A number typed here is the number on any map; Hex Data is what ties a quest to one scene's hex.
      case "autoFail": return this._edit((q) => ({ ...q, autoFail: value }));
      case "reveal": return this._edit((q) => ({ ...q, reveal: value }));
      case "hex": return this._edit((q) => ({ ...q, hex: value, hexScene: null }));
      // An emptied line is dropped when the quest is normalized.
      case "noteText": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, notes: q.rewards.notes.map((n, i) => (i === Number(el.dataset.index) ? value : n)) } }));
      case "objectiveDone": return this._edit((q) => setObjectiveDone(q, el.dataset.objective, value));
      case "objectiveText": return this._edit((q) => setObjectiveText(q, el.dataset.objective, value));
    }
  }

  /** Save a date once its day, month and year are all numbers; a day the calendar lacks keeps the old date. */
  async _onDate(row) {
    const field = row.dataset.qlDate;
    if (!DATE_FIELDS.includes(field)) return;
    const [day, month, year] = ["day", "month", "year"].map((p) => {
      const v = row.querySelector(`[data-part="${p}"]`)?.value ?? "";
      return v === "" ? NaN : Number(v);
    });
    if (![day, month, year].every(Number.isInteger)) return;   // half typed: wait for the rest
    let time = dateToTime(game.time.calendar, { year, month, day });
    if (time === null) { ui.notifications?.warn(t("SDE.quests.notify.noSuchDay")); this.render(); return; }
    if (field === "deadline") time = lastDayPrinted(game.time.calendar, time, secondsPerDay(game.time.calendar));
    await this._edit((q) => ({ ...q, [field]: time }));
  }

  async _onAddObjective() {
    const input = (this.root ?? this.element).querySelector("[data-ql-new-objective]");
    const text = input?.value ?? "";
    if (!text.trim()) return;
    input.value = "";
    await this._edit((q) => addObjective(q, text, { secret: this.newSecret, newId: () => foundry.utils.randomID() }));
    // Show it now: the box is empty again, so this redraw loses nothing, and
    // its name puts the cursor back for the next objective.
    this.render();
  }

  async _onAddNote() {
    const input = (this.root ?? this.element).querySelector("[data-ql-new-note]");
    const text = input?.value ?? "";
    if (!text.trim()) return;
    input.value = "";
    await this._edit((q) => ({ ...q, rewards: { ...q.rewards, notes: [...q.rewards.notes, text] } }));
    this.render();
  }

  async _onAddSubStep() {
    const input = (this.root ?? this.element).querySelector("[data-ql-new-substep]");
    const text = input?.value ?? "";
    if (!text.trim() || !this.subFor) return;
    input.value = "";
    const parent = this.subFor;
    await this._edit((q) => addSubStep(q, parent, text, { secret: this.newSubSecret, newId: () => foundry.utils.randomID() }));
    this._focusSub = true;
    this.render();
  }

  async _onNew() {
    const quest = await Quests.create(this.partyScope ? { party: this.partyScope } : {});
    if (!quest) return;
    this.tab = quest.status;
    this.selectedId = quest.id;
    this.filters = { character: "", party: "", source: "" };
    this.render();
  }

  /** Hidden quests for the ledger's rumors that have none; shows them. */
  async _onFromRumors() {
    const { Rumors } = await import("../rumors/rumors.mjs");
    const made = fromRumorsDrafted(await Rumors.draftQuests());
    if (!made) return;
    const first = made.length ? made[0] : firstHiddenRumorQuest(Quests.list());
    // Say only what is true: the Hidden-tab sentence needs somewhere to go.
    const key = made.length ? "SDE.quests.notify.fromRumors" : first ? "SDE.quests.notify.fromRumorsHidden" : "SDE.quests.notify.fromRumorsNone";
    ui.notifications.info(t(key, { n: made.length }));
    if (!first) return;
    this.show(first);
    this.render();
  }

  async _onConfirmPayout() {
    const quest = Quests.get(this.payoutId), root = this.root?.querySelector(".sde-ql-payout");
    if (!quest || !root) return;
    const payoutAnswer = {
      recipients: [...root.querySelectorAll('input[name="recipients"]:checked')].map(el => el.value),
      itemTo: Object.fromEntries(quest.rewards.items.map((_item, i) => [i, root.querySelector(`[name="item${i}"]`)?.value ?? ""])),
      trainingFor: root.querySelector('[name="trainingFor"]')?.value ?? "",
    };
    const moved = await Quests.setStatus(quest.id, "completed", { payoutAnswer, openTraining: false });
    if (moved) { this.payoutId = null; this.tab = moved.status; }
    this.render();
  }

  /** Only an Actor can give a quest; the name and portrait are copied now, so players need no access to it. */
  async _onDropGiver(ev, drop) {
    ev.preventDefault();
    drop.classList.remove("sde-drag-over");
    let data = null;
    try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev); } catch { /* not ours */ }
    const actor = data?.type === "Actor" && data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (!actor) { ui.notifications?.warn(t("SDE.quests.notify.dropActor")); return; }
    await this._edit((q) => ({ ...q, giver: { uuid: actor.uuid, name: actor.name, img: actor.img } }));
  }

  async _onDropItem(ev, drop) {
    ev.preventDefault();
    drop.classList.remove("sde-drag-over");
    let data = null;
    try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev); } catch { /* not ours */ }
    const item = data?.type === "Item" && data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (!item) { ui.notifications?.warn(t("SDE.quests.notify.dropItem")); return; }
    await this._edit((q) => ({ ...q, rewards: { ...q.rewards, items: [...q.rewards.items, { uuid: item.uuid, name: item.name, img: item.img }] } }));
  }
}
