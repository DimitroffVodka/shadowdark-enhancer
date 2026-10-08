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
import { TRAINERS } from "../training/training-core.mjs";
import {
  SOURCE_KINDS, SOURCE_LABELS, STATUSES, STATUS_LABELS,
  addObjective, hasRewards, matchesFilter, objectiveProgress, planStatusChange, removeObjective, setObjectiveDone, setObjectiveText,
  textToParagraphs, trainerLabel, visibleStatuses,
} from "./quest-core.mjs";
import { QUESTS_CHANGED, Quests, actorName, partiesAvailable, partyActors, partyMembers, questPayoutContent } from "./quests.mjs";
import { L as t } from "../shared/i18n.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fields a GM types into; a redraw waits while one of them has focus. */
const TEXT_FIELDS = "textarea, input:not([type]), input[type='text'], input[type='number']";


export class QuestLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-quest-log",
    classes: ["shadowdark", "sde-quest-log", "sde-ui"],
    window: { title: "SDE.quests.title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 780, height: 620 },
    actions: {
      qlTab: function (_ev, el) { this.tab = el.dataset.status; this.selectedId = null; this.render(); },
      qlSelect: function (_ev, el) { this.selectedId = el.dataset.id; this.render(); },
      qlNew: function () { return this._onNew(); },
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
      qlAddObjective: function () { return this._onAddObjective(); },
      qlRemoveObjective: function (_ev, el) { return this._edit((q) => removeObjective(q, el.dataset.objective)); },
      qlRemoveItem: function (_ev, el) {
        const i = Number(el.dataset.index);
        return this._edit((q) => ({ ...q, rewards: { ...q.rewards, items: q.rewards.items.filter((_x, n) => n !== i) } }));
      },
      qlRemoveCharacter: function (_ev, el) { return this._edit((q) => ({ ...q, characters: q.characters.filter((c) => c !== el.dataset.uuid) })); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/quest-log.hbs`, scrollable: [".ql-list", ".ql-detail"] },
  };

  constructor(options = {}, host = null) { super(options); this.host = host; }
  render(...args) { return this.host ? this.host.render() : super.render(...args); }

  static open() {
    const existing = foundry.applications.instances?.get?.("sde-quest-log");
    if (existing) { existing.render(true); existing.bringToFront?.(); return existing; }
    const app = new QuestLogApp();
    app.render(true);
    return app;
  }

  tab = "active";
  selectedId = null;
  payoutId = null;
  filters = { character: "", party: "", source: "" };

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._hook = Hooks.on(QUESTS_CHANGED, () => this._onQuestsChanged());
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
        sourceLabel: t(SOURCE_LABELS[q.source.kind]), progress: objectiveProgress(q),
      })),
      quest: quest ? await this._detail(quest, { isGM, players, parties }) : null,
    };
  }

  /** The right-hand pane for one quest. */
  async _detail(q, { isGM, players, parties }) {
    const r = q.rewards;
    return {
      ...q,
      sourceLabel: t(SOURCE_LABELS[q.source.kind]),
      statusLabel: t(STATUS_LABELS[q.status]),
      statusOptions: STATUSES.map((s) => ({ value: s, label: t(STATUS_LABELS[s]), selected: s === q.status })),
      characterList: q.characters.map((uuid) => ({ uuid, name: actorName(uuid) })),
      addableCharacters: players.filter((a) => !q.characters.includes(a.uuid)).map((a) => ({ uuid: a.uuid, name: a.name })),
      partyName: q.party ? actorName(q.party) : "",
      partyOptions: parties.map((p) => ({ uuid: p.uuid, name: p.name, selected: p.uuid === q.party })),
      descriptionHtml: isGM ? "" : await foundry.applications.ux.TextEditor.implementation.enrichHTML(textToParagraphs(q.description)),
      progress: objectiveProgress(q),
      trainerName: r.training ? trainerLabel(r.training) : "",
      trainerOptions: TRAINERS.map((x) => ({ key: x.key, label: trainerLabel(x.key), selected: x.key === r.training })),
      renownSigned: r.renown > 0 ? `+${r.renown}` : r.renown,
      hasRewards: hasRewards(r),
      coinRewards: Object.entries(r.coins ?? {}).filter(([,n]) => n > 0).map(([coin,n]) => t("SDE.quests.reward.coins", { coin, n })),
      hasPin: Quests.hasPin(q),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindControls(this.element, context);
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
    root.querySelector("[data-ql-new-objective]")?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this._onAddObjective(); }
    });
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
      case "renown": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, renown: value } }));
      case "training": return this._edit((q) => ({ ...q, rewards: { ...q.rewards, training: value || null } }));
      case "hex": return this._edit((q) => ({ ...q, hex: value }));
      case "objectiveDone": return this._edit((q) => setObjectiveDone(q, el.dataset.objective, value));
      case "objectiveText": return this._edit((q) => setObjectiveText(q, el.dataset.objective, value));
    }
  }

  async _onAddObjective() {
    const input = (this.root ?? this.element).querySelector("[data-ql-new-objective]");
    const text = input?.value ?? "";
    if (!text.trim()) return;
    input.value = "";
    await this._edit((q) => addObjective(q, text, () => foundry.utils.randomID()));
    // Show it now: the box is empty again, so this redraw loses nothing, and
    // its name puts the cursor back for the next objective.
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
