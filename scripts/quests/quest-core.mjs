/**
 * Shadowdark Enhancer — the Quest Log's rules, with no Foundry in sight.
 *
 * A quest is a world JournalEntry. Its state is one flag on the entry,
 * `flags.shadowdark-enhancer.quest`, and identity is that flag, never the
 * entry's name. Everything here works on the flag's plain value, so the
 * decisions that matter (who may see a quest, when rewards are paid, what a
 * player's page says) are unit-tested in node.
 *
 * Shape of the flag, after `normalizeQuest`:
 *   status       one of STATUSES
 *   source       { kind, uuid } — kind is one of SOURCE_KINDS. A trainer task
 *                also carries { trainer, task }: the trainer's key and the
 *                task's index on its spread.
 *   characters   actor UUIDs. A quest with characters is personal to them.
 *   party        a Shadowdark Extras party actor's UUID, or null
 *   description  the player-facing text, typed by the GM
 *   objectives   [{ id, text, done }]
 *   rewards      { xp, renown, items: [{ uuid, name, img }], training }
 *   hex          a published hex number whose map pin the quest jumps to
 *   paid         true once the rewards were handed out; they never are twice
 */
import { esc } from "../shared/esc.mjs";
import { trainerByKey } from "../training/training-core.mjs";

/** Flag keys. No dots, ever: a dot in a flag key is a path. */
export const QUEST_FLAG = "quest";
export const PAGE_FLAG = "questPage";
export const FOLDER_FLAG = "questFolder";

export const STATUSES = ["hidden", "available", "active", "completed", "failed"];
export const SOURCE_KINDS = ["gm", "rumor", "trouble", "trainer"];

/** Label keys, spelled out so the i18n test can see every one of them. */
export const STATUS_LABELS = {
  hidden: "SDE.quests.status.hidden",
  available: "SDE.quests.status.available",
  active: "SDE.quests.status.active",
  completed: "SDE.quests.status.completed",
  failed: "SDE.quests.status.failed",
};
export const SOURCE_LABELS = {
  gm: "SDE.quests.source.gm",
  rumor: "SDE.quests.source.rumor",
  trouble: "SDE.quests.source.trouble",
  trainer: "SDE.quests.source.trainer",
};

/** Foundry's DOCUMENT_OWNERSHIP_LEVELS, restated so this file stays node-testable. */
export const OWNERSHIP = { INHERIT: -1, NONE: 0, OBSERVER: 2 };

const str = (v) => String(v ?? "").trim();
const list = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)];
const defaultId = () => Math.random().toString(36).slice(2, 10);

export function isStatus(status) {
  return STATUSES.includes(status);
}

/**
 * The entry's default ownership for a status. Hidden is the GM's alone; any
 * other status is readable by every player and editable by none.
 */
export function ownershipFor(status) {
  return status === "hidden" ? OWNERSHIP.NONE : OWNERSHIP.OBSERVER;
}

/** The status tabs a user gets. Players never get Hidden. */
export function visibleStatuses(isGM) {
  return isGM ? [...STATUSES] : STATUSES.filter((s) => s !== "hidden");
}

/**
 * May this user see this quest? `observer` is the entry's own permission test
 * for the user. Both have to agree for a player: the status alone would show a
 * quest whose ownership was narrowed by hand, and the ownership alone would
 * show a Hidden quest in the moment between its status and ownership writes.
 */
export function canSee(quest, { isGM = false, observer = false } = {}) {
  if (isGM) return !!quest;
  return !!quest && quest.status !== "hidden" && !!observer;
}

function normalizeObjective(raw, newId) {
  if (typeof raw === "string") return { id: newId(), text: str(raw), done: false };
  return { id: str(raw?.id) || newId(), text: str(raw?.text), done: raw?.done === true };
}

function wholeNumber(v, { min = -Infinity } = {}) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : 0;
}

function hexNumber(v) {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A quest flag in its one shape, from whatever a caller handed over. Unknown
 * statuses become Hidden and unknown sources become GM, so a bad call can only
 * ever produce a quest the players cannot see.
 *
 * @param {object} raw
 * @param {object} [opts]
 * @param {Function} [opts.newId] id generator for new objectives
 */
export function normalizeQuest(raw = {}, { newId = defaultId } = {}) {
  const src = raw?.source ?? {};
  const kind = SOURCE_KINDS.includes(src.kind) ? src.kind : "gm";
  const source = { kind, uuid: str(src.uuid) || null };
  if (kind === "trainer") {
    source.trainer = str(src.trainer) || null;
    source.task = Number.isInteger(src.task) ? src.task : null;
  }
  const r = raw?.rewards ?? {};
  return {
    status: isStatus(raw?.status) ? raw.status : "hidden",
    source,
    characters: uniq(list(raw?.characters).map(str).filter(Boolean)),
    party: str(raw?.party) || null,
    description: String(raw?.description ?? ""),
    objectives: list(raw?.objectives).map((o) => normalizeObjective(o, newId)).filter((o) => o.text),
    rewards: {
      xp: wholeNumber(r.xp, { min: 0 }),
      renown: wholeNumber(r.renown),
      items: list(r.items).filter((i) => str(i?.uuid))
        .map((i) => ({ uuid: str(i.uuid), name: str(i.name), img: str(i.img) })),
      training: trainerByKey(str(r.training)) ? str(r.training) : null,
    },
    hex: hexNumber(raw?.hex),
    paid: raw?.paid === true,
  };
}

/**
 * Apply an edit. The status moves only through `planStatusChange` (it can pay
 * out), and the source and the paid mark never move at all: the source is
 * where the quest came from, and paid is what stops a second payout.
 */
export function mergeQuest(current, patch = {}, opts) {
  const base = normalizeQuest(current, opts);
  return normalizeQuest({
    ...base,
    ...patch,
    rewards: { ...base.rewards, ...(patch.rewards ?? {}) },
    status: base.status,
    source: base.source,
    paid: base.paid,
  }, opts);
}

export function hasRewards(rewards) {
  return !!rewards && (rewards.xp > 0 || !!rewards.renown || rewards.items?.length > 0 || !!rewards.training);
}

/**
 * Should moving to `to` hand out the rewards? Only on the way into Completed,
 * only if something is on offer, and only if nothing was paid before — so
 * Completed → Active → Completed pays once.
 */
export function shouldPay(quest, to) {
  return to === "completed" && quest.status !== "completed" && !quest.paid && hasRewards(quest.rewards);
}

/**
 * What a status change does.
 * @returns {{ok:false, error:string} | {ok:true, changed:boolean, quest:object, pay:boolean, ownership:number}}
 */
export function planStatusChange(quest, to) {
  if (!isStatus(to)) return { ok: false, error: "badStatus" };
  const q = normalizeQuest(quest);
  if (q.status === to) return { ok: true, changed: false, quest: q, pay: false, ownership: ownershipFor(to) };
  return { ok: true, changed: true, quest: { ...q, status: to }, pay: shouldPay(q, to), ownership: ownershipFor(to) };
}

/**
 * A one-at-a-time queue: each job starts when the one before it has settled,
 * whether it succeeded or threw. A check-then-write inside one job therefore
 * cannot interleave with another, which is what stops a double-clicked "Take
 * this task" from filing two quests. A job must never wait on the queue that
 * runs it: that job would wait for itself.
 */
export function makeQueue() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };
}

// ── Objectives ──────────────────────────────────────────────────────────────

export function addObjective(quest, text, newId = defaultId) {
  const clean = str(text);
  if (!clean) return quest;
  return { ...quest, objectives: [...quest.objectives, { id: newId(), text: clean, done: false }] };
}

export function setObjectiveDone(quest, id, done) {
  return { ...quest, objectives: quest.objectives.map((o) => (o.id === id ? { ...o, done: !!done } : o)) };
}

export function setObjectiveText(quest, id, text) {
  const clean = str(text);
  if (!clean) return removeObjective(quest, id);
  return { ...quest, objectives: quest.objectives.map((o) => (o.id === id ? { ...o, text: clean } : o)) };
}

export function removeObjective(quest, id) {
  return { ...quest, objectives: quest.objectives.filter((o) => o.id !== id) };
}

/** Ticked out of total. A quest with no objectives is never "complete" by them. */
export function objectiveProgress(quest) {
  const all = quest?.objectives ?? [];
  const done = all.filter((o) => o.done).length;
  return { done, total: all.length, complete: all.length > 0 && done === all.length };
}

// ── Rewards ─────────────────────────────────────────────────────────────────

/**
 * Who a completed quest pays by default: its own characters, else its party's
 * members, else everyone in the party roster.
 */
export function defaultRecipients({ characters = [], partyMembers = [], everyone = [] } = {}) {
  if (characters.length) return [...characters];
  if (partyMembers.length) return [...partyMembers];
  return [...everyone];
}

/**
 * The payout, from the quest and the GM's answers in the confirmation.
 *
 * XP and renown go in full to every recipient (Shadowdark does not split quest
 * XP). Each item goes to the one character the GM picked for it, or to nobody.
 * Nobody ticked means nothing is paid, which is how the GM completes a quest
 * whose rewards were handed out by hand.
 *
 * @param {object} quest normalized
 * @param {{recipients?:string[], itemTo?:object, trainingFor?:string}} answer
 */
export function payoutPlan(quest, { recipients = [], itemTo = {}, trainingFor = "" } = {}) {
  const to = uniq(list(recipients).filter(Boolean));
  const r = quest.rewards;
  return {
    xp: r.xp > 0 && to.length ? { amount: r.xp, to } : null,
    renown: r.renown && to.length ? { delta: r.renown, to } : null,
    items: r.items.map((item, i) => ({ ...item, to: itemTo[i] || null })).filter((x) => x.to),
    training: r.training && trainingFor ? { trainer: r.training, actor: trainingFor } : null,
  };
}

/** "Topic — Trainer", or null for a key that names no trainer. */
export function trainerLabel(key) {
  const tr = trainerByKey(key);
  return tr ? `${tr.topic} — ${tr.trainer}` : null;
}

/** One line per reward, for the page and the confirmation. Items carry their uuid. */
export function rewardLines(rewards, t) {
  const out = [];
  if (rewards.xp > 0) out.push({ text: t("SDE.quests.reward.xp", { n: rewards.xp }) });
  if (rewards.renown) out.push({ text: t("SDE.quests.reward.renown", { n: rewards.renown > 0 ? `+${rewards.renown}` : rewards.renown }) });
  for (const item of rewards.items) out.push({ text: item.name || item.uuid, uuid: item.uuid });
  if (rewards.training) out.push({ text: t("SDE.quests.reward.training", { trainer: trainerLabel(rewards.training) }) });
  return out;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** The API's view of one quest: the entry's id, uuid and name, and the flag. */
export function summarize({ id, uuid, name, created = 0 }, flag) {
  return { id, uuid, name, created, ...normalizeQuest(flag) };
}

/**
 * Does a quest match a list() filter?
 *
 * `party` matches quests assigned to that party. The Quest Log also passes the
 * party's `partyMembers`, so the personal quests of its members show under it
 * too; the API does not, and a caller wanting both asks for each member.
 */
export function matchesFilter(q, { status, party, character, sourceKind, sourceUuid } = {}, { partyMembers = [] } = {}) {
  if (status) {
    const want = Array.isArray(status) ? status : [status];
    if (!want.includes(q.status)) return false;
  }
  if (character && !q.characters.includes(character)) return false;
  if (party && q.party !== party && !q.characters.some((c) => partyMembers.includes(c))) return false;
  if (sourceKind && q.source.kind !== sourceKind) return false;
  if (sourceUuid && q.source.uuid !== sourceUuid) return false;
  return true;
}

/**
 * Which of a trainer's tasks one character has taken: task index → quest. A
 * failed quest frees its task to be taken again.
 */
export function trainerTaskQuests(quests, { actorUuid, trainer }) {
  const out = new Map();
  for (const q of quests) {
    if (q.source.kind !== "trainer" || q.source.trainer !== trainer) continue;
    if (!q.characters.includes(actorUuid) || q.status === "failed") continue;
    if (Number.isInteger(q.source.task) && !out.has(q.source.task)) out.set(q.source.task, q);
  }
  return out;
}

/**
 * The pin a quest jumps to. A note the GM placed for the quest itself beats
 * the pin of its hex, and a pin on the scene in view beats one elsewhere.
 * @param {Array<{sceneId:string, noteId:string, own:boolean}>} candidates
 */
export function pickPin(candidates, currentSceneId) {
  const rank = (c) => (c.own ? 0 : 2) + (c.sceneId === currentSceneId ? 0 : 1);
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// ── The player page ─────────────────────────────────────────────────────────

/** Plain text to paragraphs, escaped. `@UUID[…]{…}` links survive to be enriched. */
export function textToParagraphs(text) {
  return String(text ?? "").split(/\n\s*\n|\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`).join("");
}

/**
 * The player page, rewritten from the flag on every change: the status and
 * where the quest came from, the description, the objectives, the rewards.
 * Nothing from the GM notes page is ever in it.
 *
 * @param {object} quest normalized
 * @param {Function} t (key, data?) → string
 */
export function playerPageHtml(quest, t) {
  const parts = [
    `<p><em>${esc(t("SDE.quests.page.statusLine", {
      status: t(STATUS_LABELS[quest.status]), source: t(SOURCE_LABELS[quest.source.kind]),
    }))}</em></p>`,
    textToParagraphs(quest.description),
  ];
  if (quest.objectives.length) {
    const rows = quest.objectives.map((o) => (o.done ? `<li>☑ <s>${esc(o.text)}</s></li>` : `<li>☐ ${esc(o.text)}</li>`));
    parts.push(`<h3>${esc(t("SDE.quests.objectives"))}</h3><ul>${rows.join("")}</ul>`);
  }
  if (hasRewards(quest.rewards)) {
    // Items as links, so a player can open what they are being promised.
    const rows = rewardLines(quest.rewards, t)
      .map((l) => `<li>${l.uuid ? `@UUID[${l.uuid}]{${esc(l.text)}}` : esc(l.text)}</li>`);
    parts.push(`<h3>${esc(t("SDE.quests.rewards"))}</h3><ul>${rows.join("")}</ul>`);
  }
  return parts.join("");
}
