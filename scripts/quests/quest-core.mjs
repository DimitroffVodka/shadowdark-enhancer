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
 *   objectives   [{ id, text, done, parent, secret }] — parent is a top-level
 *                step's id or null (one level only); secret hides the step
 *                (and a parent's sub-steps) from players
 *   reveal       "all" (default) or "next": players see the done top-level
 *                steps and the first undone one
 *   giver        { uuid, name, img } snapshot of the NPC who gave it, or null
 *   startsAt     worldTime of the first second of the day a Hidden quest appears,
 *                or null. GM only: never in a player's view
 *   deadline     worldTime of the first second of the last day to finish it, or null
 *   autoFail     true: the clock fails the quest once the deadline day is over.
 *                False without a deadline, and switched off once it has fired
 *   rewards      { xp, coins, renown, items: [{ uuid, name, img }], training,
 *                notes: typed lines the log does not pay }
 *   hex          a published hex number whose map pin the quest jumps to
 *   hexScene     the scene uuid that number belongs to (a number repeats between
 *                books), or null for "any scene"; null whenever hex is null
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

/** The Accept quest link: a non-GM looking at an Available quest. */
export const canRequestAccept = (quest, { isGM = false } = {}) => !isGM && quest?.status === "available";

const SKIP_KEYS = new Set(["id", "uuid", "name", "created", "__proto__", "constructor", "prototype"]);

/** Keys this build does not know, copied safely: no entry-level fields, and a value that cannot be cloned is skipped. */
function carryUnknown(raw, known) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (known.has(k) || SKIP_KEYS.has(k)) continue;
    try { out[k] = structuredClone(v); } catch { /* not copyable: leave it out */ }
  }
  return out;
}

const OBJECTIVE_KEYS = new Set(["id", "text", "done", "parent", "secret"]);
const REWARD_KEYS = new Set(["xp", "coins", "renown", "items", "training", "notes"]);

export const MAX_NOTES = 10;
export const MAX_NOTE_LENGTH = 200;

/** Typed reward lines: trimmed, empties dropped, each clamped, at most MAX_NOTES. */
function normalizeNotes(v) {
  return list(v).filter((n) => typeof n === "string" || Number.isFinite(n)).map((n) => str(n).slice(0, MAX_NOTE_LENGTH).trim()).filter(Boolean).slice(0, MAX_NOTES);
}

/** A giver needs a uuid; without one it is no giver. */
function normalizeGiver(v) {
  const uuid = str(v?.uuid);
  return uuid ? { uuid, name: str(v.name), img: str(v.img) } : null;
}

function normalizeObjective(raw, newId) {
  if (typeof raw === "string") return { id: newId(), text: str(raw), done: false, parent: null, secret: false };
  return {
    ...carryUnknown(raw, OBJECTIVE_KEYS),
    id: str(raw?.id) || newId(), text: str(raw?.text), done: raw?.done === true,
    parent: str(raw?.parent) || null, secret: raw?.secret === true,
  };
}

/** Normalize, drop empty steps, then keep a parent only if it is an earlier top-level step. */
function normalizeObjectives(rawList, newId) {
  // A repeated id gets a fresh one, so a copied step cannot make its children multiply on every save.
  const seen = new Set();
  const all = list(rawList).map((o) => normalizeObjective(o, newId)).filter((o) => o.text).map((o) => {
    while (seen.has(o.id)) o = { ...o, id: newId() };
    seen.add(o.id);
    return o;
  });
  const secretIds = new Set(all.filter((o) => o.secret).map((o) => o.id));
  const top = new Set();
  const flat = all.map((o) => {
    if (o.parent && top.has(o.parent)) return o;
    top.add(o.id);
    // A promoted sub-step stays secret when its named parent is secret, wherever that parent sits.
    return { ...o, parent: null, secret: o.secret || (!!o.parent && secretIds.has(o.parent)) };
  });
  // A sub-step sits right after its parent's block, so the window and the page agree.
  return flat.filter((o) => !o.parent).flatMap((o) => [o, ...flat.filter((c) => c.parent === o.id)]);
}

const KNOWN_KEYS = new Set(["status", "source", "characters", "party", "description", "objectives", "rewards", "reveal", "giver", "startsAt", "deadline", "autoFail", "hex", "hexScene", "paid", "payout"]);

function wholeNumber(v, { min = -Infinity } = {}) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : 0;
}

/** A worldTime is a finite number from 0 up, floored; anything else is no date. */
function worldTime(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
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
  const hex = hexNumber(raw?.hex);
  const deadline = worldTime(raw?.deadline);
  // Keys this build does not know ride through, so a newer build's fields survive an older GM tab.
  const unknown = carryUnknown(raw, KNOWN_KEYS);
  return {
    ...unknown,
    status: isStatus(raw?.status) ? raw.status : "hidden",
    source,
    characters: uniq(list(raw?.characters).map(str).filter(Boolean)),
    party: str(raw?.party) || null,
    description: String(raw?.description ?? ""),
    objectives: normalizeObjectives(raw?.objectives, newId),
    reveal: raw?.reveal === "next" ? "next" : "all",
    giver: normalizeGiver(raw?.giver),
    startsAt: worldTime(raw?.startsAt),
    deadline,
    autoFail: deadline !== null && raw?.autoFail === true,
    rewards: {
      ...carryUnknown(r, REWARD_KEYS),
      xp: wholeNumber(r.xp, { min: 0 }),
      ...(r.coins ? { coins: Object.fromEntries(["gp", "sp", "cp"].map(k => [k, wholeNumber(r.coins[k], { min: 0 })])) } : {}),
      renown: wholeNumber(r.renown),
      items: list(r.items).filter((i) => str(i?.uuid))
        .map((i) => ({ uuid: str(i.uuid), name: str(i.name), img: str(i.img) })),
      training: trainerByKey(str(r.training)) ? str(r.training) : null,
      notes: normalizeNotes(r.notes),
    },
    hex,
    hexScene: hex === null ? null : str(raw?.hexScene) || null,
    paid: raw?.paid === true,
    ...(raw?.payout ? { payout: structuredClone(raw.payout) } : {}),
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
    payout: base.payout,
  }, opts);
}

export function hasRewards(rewards) {
  return !!rewards && (rewards.xp > 0 || Object.values(rewards.coins ?? {}).some(n => n > 0) || !!rewards.renown || rewards.items?.length > 0 || !!rewards.training);
}

/** Typed rewards the log does not pay; shown to players, never paid, so separate from hasRewards. */
export function hasNotes(rewards) {
  return list(rewards?.notes).length > 0;
}

/**
 * Should moving to `to` hand out the rewards? Only on the way into Completed,
 * only if something is on offer, and only if nothing was paid before — so
 * Completed → Active → Completed pays once.
 */
export function shouldPay(quest, to) {
  return to === "completed" && (Object.values(quest.payout?.reports ?? {}).some(r => !r.done)
    || (!quest.paid && (!!quest.payout || (quest.status !== "completed" && hasRewards(quest.rewards)))));
}

/**
 * What a status change does.
 * @returns {{ok:false, error:string} | {ok:true, changed:boolean, quest:object, pay:boolean, ownership:number}}
 */
export function planStatusChange(quest, to) {
  if (!isStatus(to)) return { ok: false, error: "badStatus" };
  const q = normalizeQuest(quest);
  if (q.status === to) return { ok: true, changed: !!shouldPay(q, to), quest: q, pay: !!shouldPay(q, to), ownership: ownershipFor(to) };
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

export function addObjective(quest, text, { secret = false, newId = defaultId } = {}) {
  const clean = str(text);
  if (!clean) return quest;
  return { ...quest, objectives: [...quest.objectives, { id: newId(), text: clean, done: false, parent: null, secret: !!secret }] };
}

/** A sub-step goes after its parent's last child. A sub-step cannot be a parent, so that is a no-op. */
export function addSubStep(quest, parentId, text, { secret = false, newId = defaultId } = {}) {
  const clean = str(text);
  const at = quest.objectives.findIndex((o) => o.id === parentId && !o.parent);
  if (!clean || at < 0) return quest;
  let end = at;
  quest.objectives.forEach((o, i) => { if (o.parent === parentId) end = i; });
  const objectives = [...quest.objectives];
  objectives.splice(end + 1, 0, { id: newId(), text: clean, done: false, parent: parentId, secret: !!secret });
  return { ...quest, objectives };
}

export function setObjectiveDone(quest, id, done) {
  return { ...quest, objectives: quest.objectives.map((o) => (o.id === id ? { ...o, done: !!done } : o)) };
}

export function setObjectiveSecret(quest, id, secret) {
  return { ...quest, objectives: quest.objectives.map((o) => (o.id === id ? { ...o, secret: !!secret } : o)) };
}

export function setObjectiveText(quest, id, text) {
  const clean = str(text);
  if (!clean) return removeObjective(quest, id);
  return { ...quest, objectives: quest.objectives.map((o) => (o.id === id ? { ...o, text: clean } : o)) };
}

/** A parent takes its sub-steps with it. */
export function removeObjective(quest, id) {
  return { ...quest, objectives: quest.objectives.filter((o) => o.id !== id && o.parent !== id) };
}

/**
 * What a player may see of a quest: secret steps gone (with the sub-steps of a
 * secret parent), and on a "next" quest the done top-level steps plus the first
 * undone one. `quest` is normalized.
 */
export function playerView(full) {
  const { startsAt: _gmOnly, ...quest } = full;
  const secretParents = new Set(quest.objectives.filter((o) => o.secret && !o.parent).map((o) => o.id));
  let objectives = quest.objectives.filter((o) => !o.secret && !secretParents.has(o.parent));
  if (quest.reveal === "next") {
    const next = objectives.find((o) => !o.parent && !o.done);
    const shown = new Set(objectives.filter((o) => !o.parent && (o.done || o === next)).map((o) => o.id));
    objectives = objectives.filter((o) => shown.has(o.parent ?? o.id));
  }
  return { ...quest, objectives };
}

/**
 * Ticked out of total, over the steps the viewer can see (the GM's list is whole,
 * a player's is `playerView`'d). A quest with no steps is never "complete" by
 * them. A player gets no count on a "next" quest: it would give the chain's length away.
 */
export function objectiveProgress(quest, { isGM = true } = {}) {
  const all = quest?.objectives ?? [];
  if (!isGM && quest?.reveal === "next") return { done: 0, total: 0, complete: false };
  const done = all.filter((o) => o.done).length;
  return { done, total: all.length, complete: all.length > 0 && done === all.length };
}

// ── Time ────────────────────────────────────────────────────────────────────

/** "none" without a deadline, "overdue" once the deadline's day is over, else "open". `spd` is seconds per day. */
export function deadlineState(quest, now, spd) {
  if (quest?.deadline == null) return "none";
  return now >= quest.deadline + spd ? "overdue" : "open";
}

/**
 * The status moves the world clock calls for, as `{id, status, clear}`: `clear`
 * names the fields to reset once the status has moved. A Hidden quest whose
 * date has come appears, unless its deadline is already over (it stays Hidden
 * and keeps its date). An Available or Active quest that asked to fail at its
 * deadline fails once the deadline's day is over. Hidden, Completed and Failed
 * quests never fail. A Failed or Completed quest
 * with `autoFail` still set (its clearing write failed) yields a change with
 * no `status`, which only clears the flag.
 */
export function dueChanges(quests, now, spd) {
  const out = [];
  for (const q of quests) {
    const overdue = deadlineState(q, now, spd) === "overdue";
    if (q.status === "hidden" && q.startsAt != null && now >= q.startsAt && !overdue) {
      out.push({ id: q.id, status: "available", clear: ["startsAt"] });
    } else if ((q.status === "available" || q.status === "active") && q.autoFail && overdue) {
      out.push({ id: q.id, status: "failed", clear: ["autoFail"] });
    } else if ((q.status === "failed" || q.status === "completed") && q.autoFail) {
      out.push({ id: q.id, clear: ["autoFail"] });   // a failed clearing write left it set; do not let a reopen fail it again
    }
  }
  return out;
}

/** Did the world clock move into another day? (A window redraws only then.) */
export function dayChanged(prev, now, spd) {
  return Math.floor(prev / spd) !== Math.floor(now / spd);
}

/**
 * What a player should be told, from two snapshots of what they may see (keyed
 * by quest id, each `{name, status, steps: [{id, text, done}]}`). One event
 * per quest, by priority: failed or completed, active, new, a step done, a
 * step newly visible. A quest that vanished, an un-tick and a move to any
 * other status tell nothing.
 */
export function questEvents(prev = {}, next = {}) {
  const out = [];
  for (const [id, q] of Object.entries(next)) {
    const old = prev[id];
    const ev = (kind, text) => out.push({ id, kind, name: q.name, ...(text === undefined ? {} : { text }) });
    if (q.status === "completed" || q.status === "failed") {
      if (!old || old.status !== q.status) ev(q.status);
      continue;
    }
    if (!old) { if (q.status !== "hidden") ev("new"); continue; }
    if (old.status !== q.status && q.status === "active") { ev("active"); continue; }
    const before = new Map(old.steps.map((s) => [s.id, s]));
    const ticked = q.steps.find((s) => s.done && before.get(s.id) && !before.get(s.id).done);
    if (ticked) { ev("step", ticked.text); continue; }
    const added = q.steps.find((s) => !before.has(s.id));
    if (added) ev("newStep", added.text);
  }
  return out;
}

/** A worldTime as the calendar's day, month (from 1) and year as it prints it. */
export function timeToDate(cal, t) {
  const c = cal.timeToComponents(t);
  return { day: c.dayOfMonth + 1, month: c.month + 1, year: c.year + (cal.years?.yearZero ?? 0) };
}

/**
 * A leap year's first day is printed twice by core's calendar; a deadline typed
 * as that date must be the last of them, or it goes Overdue while the clock still reads it.
 */
export function lastDayPrinted(cal, time, spd) {
  const same = (a, b) => { const x = timeToDate(cal, a), y = timeToDate(cal, b); return x.day === y.day && x.month === y.month && x.year === y.year; };
  while (same(time, time + spd)) time += spd;
  return time;
}

/** A worldTime as "14 March 1348", the month named by the calendar (a localisation key, run through `t`). */
export function dateLabel(cal, time, t) {
  const d = timeToDate(cal, time);
  return t("SDE.quests.dateFormat", { day: d.day, month: t(cal.months?.values?.[d.month - 1]?.name ?? ""), year: d.year });
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
    ...(r.coins ? { coins: to.length ? { amount: r.coins, to } : null } : {}),
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

/** The typed reward lines, as strings. */
export function noteLines(rewards) {
  return list(rewards?.notes).map(str).filter(Boolean);
}

/** One line per reward, for the page and the confirmation. Items carry their uuid. */
export function rewardLines(rewards, t) {
  const out = [];
  if (rewards.xp > 0) out.push({ text: t("SDE.quests.reward.xp", { n: rewards.xp }) });
  for (const [coin, n] of Object.entries(rewards.coins ?? {})) if (n > 0) out.push({ text: t("SDE.quests.reward.coins", { n, coin }) });
  if (rewards.renown) out.push({ text: t("SDE.quests.reward.renown", { n: rewards.renown > 0 ? `+${rewards.renown}` : rewards.renown }) });
  for (const item of rewards.items) out.push({ text: item.name || item.uuid, uuid: item.uuid });
  if (rewards.training) out.push({ text: t("SDE.quests.reward.training", { trainer: trainerLabel(rewards.training) }) });
  return out;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** The API's view of one quest: the entry's id, uuid and name, and the flag. */
export function summarize({ id, uuid, name, created = 0 }, flag) {
  return { ...normalizeQuest(flag), id, uuid, name, created };
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
 * The quests tied to one hex of one scene. A quest with no scene of its own
 * (typed in the Quest Log) matches that number on any scene, as its pin does.
 */
export function questsAtHex(quests, { num, sceneUuid }) {
  if (!Number.isInteger(num)) return [];
  return quests.filter((q) => q.hex === num && (!q.hexScene || q.hexScene === sceneUuid));
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
 * @param {object} [cal] the world calendar, for the Due line
 */
export function playerPageHtml(full, t, cal = null) {
  const quest = playerView(full);
  const parts = [
    `<p><em>${esc(t("SDE.quests.page.statusLine", {
      status: t(STATUS_LABELS[quest.status]), source: t(SOURCE_LABELS[quest.source.kind]),
    }))}</em></p>`,
    ...(quest.deadline != null && cal ? [`<p>${esc(t("SDE.quests.page.due", { date: dateLabel(cal, quest.deadline, t) }))}</p>`] : []),
    ...(quest.giver?.name ? [`<p>${esc(t("SDE.quests.page.givenBy", { name: quest.giver.name }))}</p>`] : []),
    textToParagraphs(quest.description),
  ];
  if (quest.objectives.length) {
    const line = (o) => (o.done ? `☑ <s>${esc(o.text)}</s>` : `☐ ${esc(o.text)}`);
    const rows = quest.objectives.filter((o) => !o.parent).map((o) => {
      const kids = quest.objectives.filter((c) => c.parent === o.id);
      return `<li>${line(o)}${kids.length ? `<ul>${kids.map((c) => `<li>${line(c)}</li>`).join("")}</ul>` : ""}</li>`;
    });
    parts.push(`<h3>${esc(t("SDE.quests.objectives"))}</h3><ul>${rows.join("")}</ul>`);
  }
  if (hasRewards(quest.rewards) || hasNotes(quest.rewards)) {
    // Items as links, so a player can open what they are being promised.
    const rows = [...rewardLines(quest.rewards, t)
      .map((l) => `<li>${l.uuid ? `@UUID[${l.uuid}]{${esc(l.text)}}` : esc(l.text)}</li>`),
    ...noteLines(quest.rewards).map((n) => `<li>${esc(n)}</li>`)];
    parts.push(`<h3>${esc(t("SDE.quests.rewards"))}</h3><ul>${rows.join("")}</ul>`);
  }
  return parts.join("");
}
