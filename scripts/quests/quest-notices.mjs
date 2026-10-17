/**
 * Shadowdark Enhancer — the Quest Log's pop-ups for players.
 *
 * A player's client keeps a snapshot of the quests this user may see and diffs
 * it on every `questsChanged` (the pure `questEvents`). `questsChanged` carries
 * ids only, so a GM's own changes cannot be told apart: GMs get no pop-ups.
 * Events wait a second, merge to one per quest, and become a single line when
 * more than three quests changed at once.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { questEvents } from "./quest-core.mjs";
import { QUESTS_CHANGED, Quests } from "./quests.mjs";

const RANK = { newStep: 1, step: 2, new: 3, active: 4, completed: 5, failed: 5 };
const MAX_SHOWN = 3;

let snapshot = {};
const pending = new Map();

export function takeSnapshot() {
  return Object.fromEntries(Quests.list().map((q) => [q.id, {
    name: q.name, status: q.status, steps: q.objectives.map((o) => ({ id: o.id, text: o.text, done: o.done })),
  }]));
}

/** Show what is queued: one line per quest, or one summary line past three quests. */
export function flushNotices() {
  const events = [...pending.values()];
  pending.clear();
  if (!events.length) return;
  if (events.length > MAX_SHOWN) { ui.notifications.info(t("SDE.quests.toast.many")); return; }
  for (const e of events) {
    const key = {
      new: "SDE.quests.toast.new", active: "SDE.quests.toast.active", completed: "SDE.quests.toast.completed",
      failed: "SDE.quests.toast.failed", step: "SDE.quests.toast.step", newStep: "SDE.quests.toast.newStep",
    }[e.kind];
    ui.notifications[e.kind === "failed" ? "warn" : "info"](t(key, { name: e.name, step: e.text ?? "" }));
  }
}

const showSoon = foundry.utils.debounce(flushNotices, 1000);

/** Diff against the snapshot, replace it, queue the events (the higher priority wins per quest). */
export function noteChanges() {
  if (game.user?.isGM) return;
  const next = takeSnapshot();
  for (const e of questEvents(snapshot, next)) {
    const old = pending.get(e.id);
    if (!old || RANK[e.kind] >= RANK[old.kind]) pending.set(e.id, e);
  }
  snapshot = next;
  showSoon();
}

/** Call once, at init. */
export function registerQuestNotices() {
  Hooks.once("ready", () => { if (!game.user?.isGM) snapshot = takeSnapshot(); });
  Hooks.on(QUESTS_CHANGED, () => {
    try { noteChanges(); } catch (err) { console.warn(`${MODULE_ID} | quest notices`, err); }
  });
}
