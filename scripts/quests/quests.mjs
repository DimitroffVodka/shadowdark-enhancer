/**
 * Shadowdark Enhancer — the Quest Log's data: world journals, one per quest.
 *
 * Each quest is a JournalEntry in a "Quests" folder of the Journal sidebar,
 * with a player page and a GM notes page, so everything is readable without
 * the window. The state is one flag on the entry (quest-core.mjs); the player
 * page is rewritten from it on every change, and the GM notes page is the
 * GM's own and never touched after it is made.
 *
 * World journals, not the module's `--journals` pack: a compendium has one
 * ownership for the whole pack, and a quest's visibility is per quest (Hidden
 * is the GM's, anything else the players may read).
 *
 * Every write is the GM's. Players read; nothing here takes a write from a
 * player, so there is no relay.
 *
 * Shadowdark Extras is optional. With it installed a quest can be assigned to
 * one of its party actors, read the way Extras' own party sheet reads them: an
 * NPC flagged `shadowdark-extras.isParty`, its members the ids or UUIDs in
 * `shadowdark-extras.members`. Without it the log works the same, minus the
 * party picker.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { esc } from "../shared/esc.mjs";
import { PartyXP } from "../party-xp/party-xp.mjs";
import { Renown } from "../renown/renown.mjs";
import { trainerByKey } from "../training/training-core.mjs";
import {
  FOLDER_FLAG, OWNERSHIP, PAGE_FLAG, QUEST_FLAG,
  canSee, defaultRecipients, makeQueue, matchesFilter, mergeQuest, normalizeQuest, ownershipFor, payoutPlan,
  pickPin, planStatusChange, playerPageHtml, rewardLines, summarize, trainerLabel, trainerTaskQuests,
} from "./quest-core.mjs";

/** Fires on every client after any quest is created, changed or deleted. */
export const QUESTS_CHANGED = `${MODULE_ID}.questsChanged`;

const EXTRAS = "shadowdark-extras";

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

const newId = () => foundry.utils.randomID();

// ── Reading ─────────────────────────────────────────────────────────────────

const flagOf = (entry) => entry?.flags?.[MODULE_ID]?.[QUEST_FLAG];

function questEntries() {
  return (game.journal?.contents ?? []).filter((e) => flagOf(e));
}

/** A quest entry by id or by `JournalEntry.<id>` uuid; null for anything else. */
function entryFor(idOrUuid) {
  const id = String(idOrUuid ?? "").replace(/^JournalEntry\./, "");
  const entry = game.journal?.get(id);
  return flagOf(entry) ? entry : null;
}

function mayRead(entry) {
  return canSee(flagOf(entry), {
    isGM: !!game.user?.isGM,
    observer: !!entry.testUserPermission?.(game.user, "OBSERVER"),
  });
}

function toSummary(entry) {
  return summarize({ id: entry.id, uuid: entry.uuid, name: entry.name, created: entry._stats?.createdTime ?? 0 }, flagOf(entry));
}

/** An actor, a uuid or a world actor id, as a uuid. */
function actorUuid(ref) {
  if (!ref) return null;
  if (typeof ref === "object") return ref.uuid ?? null;
  return game.actors?.get(ref)?.uuid ?? String(ref);
}

export function actorName(uuid) {
  try { return fromUuidSync(uuid)?.name ?? t("SDE.quests.unknownActor"); }
  catch { return t("SDE.quests.unknownActor"); }
}

// ── Shadowdark Extras parties (optional) ────────────────────────────────────

export function partiesAvailable() {
  return !!game.modules?.get(EXTRAS)?.active;
}

export function partyActors() {
  if (!partiesAvailable()) return [];
  return (game.actors?.contents ?? []).filter((a) => a.type === "NPC" && a.flags?.[EXTRAS]?.isParty === true);
}

export function partyMembers(partyUuid) {
  const party = partyActors().find((p) => p.uuid === partyUuid);
  return (party?.flags?.[EXTRAS]?.members ?? [])
    .map((id) => game.actors?.get(id)?.uuid ?? (String(id).includes(".") ? String(id) : null))
    .filter(Boolean);
}

// ── Writing (GM only) ───────────────────────────────────────────────────────

// ponytail: one queue per client for every quest write (create, edit, status),
// so rapid edits never read a stale flag and a double click never files twice.
// Two GMs writing the same quest at the same moment can still race.
const serialize = makeQueue();

function gmOnly() {
  if (game.user?.isGM) return false;
  ui.notifications?.warn(t("SDE.quests.notify.gmOnly"));
  return true;
}

function playerPageData(quest) {
  return {
    name: t("SDE.quests.page.player"),
    type: "text",
    text: { content: playerPageHtml(quest, t), format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    ownership: { default: OWNERSHIP.INHERIT },
    flags: { [MODULE_ID]: { [PAGE_FLAG]: "player" } },
  };
}

/** The "Quests" folder, found by its flag so a GM may rename it. */
async function questFolder() {
  const flagged = game.folders?.find((f) => f.type === "JournalEntry" && f.flags?.[MODULE_ID]?.[FOLDER_FLAG]);
  if (flagged) return flagged;
  return Folder.create({ name: t("SDE.quests.folder"), type: "JournalEntry", flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } } });
}

/**
 * Write a quest's flag, then everything that follows from it: the entry's
 * name, its ownership, and the player page. The status is in the flag before
 * the ownership opens, and list() checks both, so a Hidden quest never shows.
 */
async function writeQuest(entry, quest, { name } = {}) {
  await replaceModuleFlag(entry, QUEST_FLAG, quest);
  const extra = {};
  if (name && name !== entry.name) extra.name = name;
  const level = ownershipFor(quest.status);
  if (entry.ownership?.default !== level) extra["ownership.default"] = level;
  if (Object.keys(extra).length) await entry.update(extra);
  const page = entry.pages.find((p) => p.flags?.[MODULE_ID]?.[PAGE_FLAG] === "player");
  if (page) await page.update({ "text.content": playerPageHtml(quest, t) });
  else await entry.createEmbeddedDocuments("JournalEntryPage", [playerPageData(quest)]);
}

/**
 * Make the entry. Unqueued: callers run it inside `serialize`, and it must
 * never call the queued `Quests.create` itself.
 */
async function createNow(data) {
  const quest = normalizeQuest(withActorUuids(data), { newId });
  const name = String(data.name ?? "").trim() || t("SDE.quests.newName");
  const folder = await questFolder();
  const entry = await JournalEntry.create({
    name,
    folder: folder?.id ?? null,
    ownership: { default: ownershipFor(quest.status) },
    flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } },
    pages: [
      playerPageData(quest),
      {
        name: t("SDE.quests.page.gmNotes"),
        type: "text",
        text: { content: `<p><em>${esc(t("SDE.quests.page.gmHint"))}</em></p>`, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
        ownership: { default: OWNERSHIP.NONE },
        flags: { [MODULE_ID]: { [PAGE_FLAG]: "gm" } },
      },
    ],
  });
  return entry ? toSummary(entry) : null;
}

/** Resolve the actor references a caller may pass (Actor, uuid, id) to uuids. */
function withActorUuids(data) {
  const out = { ...data };
  if ("characters" in out) out.characters = (out.characters ?? []).map(actorUuid).filter(Boolean);
  if ("party" in out) out.party = actorUuid(out.party);
  return out;
}

// ── Rewards ─────────────────────────────────────────────────────────────────

/** Ask the GM who gets what. Returns the answer, or null to leave the quest as it was. */
async function askPayout(quest, name) {
  const everyone = PartyXP.party().map((a) => a.uuid);
  const members = quest.party ? partyMembers(quest.party) : [];
  const defaults = defaultRecipients({ characters: quest.characters, partyMembers: members, everyone });
  const candidates = [...new Set([...quest.characters, ...members, ...everyone])];
  const first = defaults[0] ?? "";
  const options = (selected) => [`<option value="">${esc(t("SDE.quests.payout.nobody"))}</option>`,
    ...candidates.map((u) => `<option value="${esc(u)}" ${u === selected ? "selected" : ""}>${esc(actorName(u))}</option>`)].join("");

  const r = quest.rewards;
  // A div, not a form: DialogV2 wraps its content in its own form already.
  const content = `<div class="sde-ql-payout">
    <p>${esc(t("SDE.quests.payout.intro", { name }))}</p>
    <ul>${rewardLines(r, t).map((l) => `<li>${esc(l.text)}</li>`).join("")}</ul>
    ${(r.xp > 0 || r.renown) ? `<fieldset><legend>${esc(t("SDE.quests.payout.recipients"))}</legend>
      ${candidates.map((u) => `<label class="checkbox"><input type="checkbox" name="recipients" value="${esc(u)}" ${defaults.includes(u) ? "checked" : ""}> ${esc(actorName(u))}</label>`).join("")}
    </fieldset>` : ""}
    ${r.items.map((item, i) => `<div class="form-group"><label>${esc(t("SDE.quests.payout.itemTo", { item: item.name || item.uuid }))}</label>
      <select name="item${i}">${options(first)}</select></div>`).join("")}
    ${r.training ? `<div class="form-group"><label>${esc(t("SDE.quests.payout.openTraining", { trainer: trainerLabel(r.training) }))}</label>
      <select name="trainingFor">${options(first)}</select></div>` : ""}
  </div>`;

  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: t("SDE.quests.payout.title"), icon: "fa-solid fa-trophy" },
    content,
    buttons: [
      {
        action: "pay", label: t("SDE.quests.payout.confirm"), icon: "fa-solid fa-check", default: true,
        callback: (_event, button) => {
          const form = button.form;
          const itemTo = {};
          r.items.forEach((_item, i) => { itemTo[i] = form.elements[`item${i}`]?.value ?? ""; });
          return {
            recipients: [...form.querySelectorAll('input[name="recipients"]:checked')].map((el) => el.value),
            itemTo,
            trainingFor: form.elements.trainingFor?.value ?? "",
          };
        },
      },
      { action: "cancel", label: t("SDE.quests.payout.cancel"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  return answer && typeof answer === "object" ? answer : null;
}

/** Hand the rewards out. The quest is already marked paid when this runs. */
async function pay(plan, name) {
  const actorOf = (uuid) => { try { return fromUuidSync(uuid); } catch { return null; } };
  if (plan.xp) {
    const ids = plan.xp.to.map((u) => actorOf(u)?.id).filter(Boolean);
    if (ids.length) await PartyXP.award(plan.xp.amount, { actorIds: ids, label: name });
  }
  if (plan.renown) {
    for (const u of plan.renown.to) {
      const actor = actorOf(u);
      if (!actor) continue;
      const res = await Renown.award({ actor, delta: plan.renown.delta, reason: name, source: "quest" });
      if (res && !res.ok && res.error) ui.notifications?.warn(res.error);
    }
  }
  for (const item of plan.items) {
    const actor = actorOf(item.to);
    const source = await fromUuid(item.uuid).catch(() => null);
    if (!actor || !source) { ui.notifications?.warn(t("SDE.quests.notify.itemMissing", { item: item.name || item.uuid })); continue; }
    const data = source.toObject();
    delete data._id;
    await actor.createEmbeddedDocuments("Item", [data]);
  }
  ui.notifications?.info(t("SDE.quests.notify.paid", { name }));
}

// ── Pins ────────────────────────────────────────────────────────────────────

/** A note placed for the quest itself, else the Hex Tagger's pin for its hex. */
function findPin(quest) {
  const candidates = [];
  for (const scene of game.scenes?.contents ?? []) {
    for (const note of scene.notes?.contents ?? []) {
      const own = note.entryId === quest.id;
      const hexPin = quest.hex !== null && note.flags?.[MODULE_ID]?.hexPin?.num === quest.hex;
      if (own || hexPin) candidates.push({ sceneId: scene.id, noteId: note.id, own });
    }
  }
  return pickPin(candidates, globalThis.canvas?.scene?.id ?? null);
}

// ── The API ─────────────────────────────────────────────────────────────────

export const Quests = {
  /**
   * The quests this user may see, newest first.
   * @param {{status?:string|string[], party?:*, character?:*, sourceKind?:string, sourceUuid?:string}} [filter]
   */
  list(filter = {}) {
    const f = { ...filter, party: actorUuid(filter.party), character: actorUuid(filter.character) };
    return questEntries().filter(mayRead).map(toSummary)
      .filter((q) => matchesFilter(q, f))
      .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
  },

  /** One quest by id or uuid, or null when it does not exist or this user may not see it. */
  get(idOrUuid) {
    const entry = entryFor(idOrUuid);
    return entry && mayRead(entry) ? toSummary(entry) : null;
  },

  /**
   * Make a quest (GM). Every field is optional: a bare call makes a Hidden
   * "New quest" from the GM. Sources outside this module pass `source`:
   * `{ kind: "rumor"|"trouble"|"trainer"|"gm", uuid }`.
   */
  async create(data = {}) {
    if (gmOnly()) return null;
    return serialize(() => createNow(data));
  },

  /**
   * Edit a quest (GM). `patch` is a partial quest, or a function from the
   * current quest to the next — the window uses the function form, so an edit
   * always applies to what is stored and never to what the window last drew.
   * The status moves only through setStatus.
   */
  async update(idOrUuid, patch) {
    if (gmOnly()) return null;
    return serialize(async () => {
      const entry = entryFor(idOrUuid);
      if (!entry) { ui.notifications?.warn(t("SDE.quests.notify.notFound")); return null; }
      const current = normalizeQuest(flagOf(entry), { newId });
      const next = typeof patch === "function"
        ? mergeQuest(current, patch(current), { newId })
        : mergeQuest(current, withActorUuids(patch ?? {}), { newId });
      const name = typeof patch === "function" ? null : String(patch?.name ?? "").trim() || null;
      await writeQuest(entry, next, { name });
      return toSummary(entry);
    });
  },

  /**
   * Move a quest to a status (GM). Into Completed, with rewards not yet paid,
   * the GM confirms the payout first; cancelling leaves the quest where it was.
   * @returns {Promise<object|null>} the quest after the change, or null
   */
  async setStatus(idOrUuid, status) {
    if (gmOnly()) return null;
    let training = null;
    const result = await serialize(async () => {
      const entry = entryFor(idOrUuid);
      if (!entry) { ui.notifications?.warn(t("SDE.quests.notify.notFound")); return null; }
      const plan = planStatusChange(flagOf(entry), status);
      if (!plan.ok) { ui.notifications?.warn(t("SDE.quests.notify.badStatus")); return null; }
      if (!plan.changed) return toSummary(entry);
      if (!plan.pay) { await writeQuest(entry, plan.quest); return toSummary(entry); }

      const answer = await askPayout(plan.quest, entry.name);
      if (!answer) return null;
      // Paid is written with the status, before anything is handed out: a
      // failure halfway through can leave a reward short, never paid twice.
      await writeQuest(entry, { ...plan.quest, paid: true });
      const payout = payoutPlan(plan.quest, answer);
      await pay(payout, entry.name);
      training = payout.training;
      return toSummary(entry);
    });
    // Outside the queue: the Training window is the GM's next step, not part of the write.
    if (training) {
      const actor = (() => { try { return fromUuidSync(training.actor); } catch { return null; } })();
      if (actor) (await import("../training/training-app.mjs")).TrainingApp.open({ actor, trainer: training.trainer });
    }
    return result;
  },

  /**
   * Take one of a trainer's four tasks for a character (GM): a personal,
   * Available quest whose one objective is the task and whose reward is the
   * trainer's benefit roll. Taking a task twice returns the quest it made.
   */
  async takeTrainerTask({ actor, trainer, task, text, journalUuid = null }) {
    if (gmOnly()) return null;
    const tr = trainerByKey(trainer);
    if (!tr || !actor || !Number.isInteger(task)) return null;
    // The check and the create are one job, so a second click waits for the
    // first quest to exist and then finds it.
    return serialize(() => {
      const taken = trainerTaskQuests(this.list({ sourceKind: "trainer" }), { actorUuid: actor.uuid, trainer }).get(task);
      if (taken) return taken;
      return createNow({
        name: t("SDE.quests.trainerQuestName", { topic: tr.topic, trainer: tr.trainer, n: task + 1 }),
        status: "available",
        source: { kind: "trainer", uuid: journalUuid, trainer, task },
        characters: [actor.uuid],
        objectives: [text],
        rewards: { training: trainer },
      });
    });
  },

  /** Is there a pin to jump to? */
  hasPin(quest) {
    return !!findPin(quest);
  },

  /**
   * Show the quest's map pin. The GM is taken to its scene; a player on
   * another scene is told where it is instead.
   */
  async jumpToPin(idOrUuid) {
    const quest = this.get(idOrUuid);
    const pin = quest ? findPin(quest) : null;
    if (!pin) { ui.notifications?.warn(t("SDE.quests.notify.noPin")); return false; }
    const scene = game.scenes.get(pin.sceneId);
    if (scene.id !== canvas?.scene?.id) {
      if (!game.user.isGM) { ui.notifications?.warn(t("SDE.quests.notify.pinElsewhere")); return false; }
      await scene.view();
    }
    const note = scene.notes.get(pin.noteId);
    // Pan only. canvas.ping broadcasts to every client, which would show the
    // players where a Hidden quest leads.
    await canvas.animatePan({ x: note.x, y: note.y, scale: Math.max(canvas.stage?.scale?.x ?? 1, 1) });
    return true;
  },
};

// ── Wiring ──────────────────────────────────────────────────────────────────

export async function openQuestLog() {
  return (await import("./quest-log-app.mjs")).QuestLogApp.open();
}

/** "Quest Log" at the foot of the Journal sidebar, for everyone. */
function addDirectoryButton(_app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sde-quest-log-launch")) return;
  let footer = root.querySelector(".directory-footer");
  if (!footer) {
    footer = document.createElement("footer");
    footer.className = "directory-footer action-buttons flexcol";
    root.append(footer);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sde-quest-log-launch";
  btn.innerHTML = `<i class="fa-solid fa-list-check" inert></i> <span>${esc(t("SDE.quests.title"))}</span>`;
  btn.addEventListener("click", () => openQuestLog());
  footer.append(btn);
}

/** Keybinding, sidebar button and the change hook. Must run in `init`. */
export function registerQuests() {
  game.keybindings.register(MODULE_ID, "openQuestLog", {
    name: "SDE.quests.keybinding.name",
    hint: "SDE.quests.keybinding.hint",
    editable: [{ key: "KeyQ", modifiers: ["Control"] }],
    onDown: () => { openQuestLog(); return true; },
  });
  Hooks.on("renderJournalDirectory", addDirectoryButton);

  // One hook per burst: a quest write is several document updates (the flag's
  // delete-then-set, ownership, the page), and a listener should redraw once.
  const changed = new Set();
  const flush = foundry.utils.debounce(() => {
    const ids = [...changed];
    changed.clear();
    Hooks.callAll(QUESTS_CHANGED, { ids });
  }, 100);
  const note = (entry) => { changed.add(entry.id); flush(); };
  Hooks.on("createJournalEntry", (entry) => { if (flagOf(entry)) note(entry); });
  Hooks.on("deleteJournalEntry", (entry) => { if (flagOf(entry)) note(entry); });
  // Only while the entry still carries the flag. replaceModuleFlag deletes it
  // and then sets it; reporting the delete step would show listeners a quest
  // that has vanished, and the set step reports the change anyway.
  Hooks.on("updateJournalEntry", (entry) => { if (flagOf(entry)) note(entry); });
}
