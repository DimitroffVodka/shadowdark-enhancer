import { ABILITY_LABELS } from "./constants.mjs";
import { loadActorSnapshot, hydrateState } from "./hydrate.mjs";
import { planCommit, planIsEmpty } from "./commit-plan.mjs";
import { applyPlan, IncompleteError, ApplyInProgressError } from "./commit-apply.mjs";
import { takeBeforeImage } from "./before-image.mjs";

/**
 * The Character Builder on an EXISTING character (#168 P4b): opening it (read the
 * actor into a state with a frozen baseline) and Finish (show the diff, take a
 * before-image, apply only what changed, start over from the live actor).
 * No Foundry class is loaded here, so the whole flow runs in Node tests; the
 * app calls `hydrateActor` and `finishExisting` and owns the window.
 *
 * ONE FINISH PER BASELINE: after a save, complete or partial, the builder is
 * reset to a state hydrated from the live actor. The old baseline is never reused.
 */

const L = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);
const esc = (s) => foundry.utils.escapeHTML(String(s));
const K = "SDE.charBuilder.existing.";

/** The builder state for `actor`, or null for a blank actor (a fresh build). */
export async function hydrateActor(actor) {
  const { snapshot, resolved } = await loadActorSnapshot(actor);
  return hydrateState(snapshot, resolved);
}

/** Copper as "1 gp 2 sp 3 cp" (zero parts left out). */
function coinsText(cp) {
  const parts = [[Math.floor(cp / 100), "gp"], [Math.floor((cp % 100) / 10), "sp"], [cp % 10, "cp"]]
    .filter(([n]) => n > 0).map(([n, u]) => `${n} ${u}`);
  return parts.join(" ") || "0 cp";
}

/** A stored UUID as a name; the last segment when it no longer resolves. */
async function nameOfUuid(uuid) {
  if (!uuid) return L(`${K}none`);
  const doc = await Promise.resolve(globalThis.fromUuid(uuid)).catch(() => null);
  return doc?.name ?? String(uuid).split(".").pop();
}

/** `[label, from, to]` for a "set" line, in words. */
async function setRow({ key, from, to }) {
  if (key.startsWith("abilities.")) return [ABILITY_LABELS[key.split(".")[1]], from, to];
  if (key === "coins") return [L("SDE.charBuilder.step.gold"), coinsText(from), coinsText(to)];
  if (key === "alignment") {
    const name = (a) => L(globalThis.CONFIG?.SHADOWDARK?.ALIGNMENTS?.[a] ?? a);
    return [L("SDE.charBuilder.step.alignment"), name(from), name(to)];
  }
  if (key === "background" || key === "deity") {
    return [L(`SDE.charBuilder.step.${key}`), await nameOfUuid(from), await nameOfUuid(to)];
  }
  return [L(`${K}name`), from, to];
}

/**
 * The diff as plain words: what the character has now and what it will have, no
 * ids. Returns the dialog HTML. `plan` is from planCommit.
 */
export async function describePlan(plan, name) {
  const row = (label, val) => `<li><span>${esc(label)}</span><b>${esc(val)}</b></li>`;
  const rows = [];
  for (const l of plan.summary.lines) {
    if (l.kind === "set") {
      const [label, from, to] = await setRow(l);
      rows.push(row(label, `${from} → ${to}`));
    } else if (l.kind === "art") {
      rows.push(row(L(`SDE.charBuilder.art.${l.slot}`), L(`${K}artChanged`)));
    } else if (l.kind === "languages") {
      rows.push(row(L("SDE.charBuilder.step.languages"), F(`${K}languagesChanged`, { added: l.add.length, removed: l.remove.length })));
    } else if (l.kind === "quantity") {
      rows.push(row(l.name, `${l.from} → ${l.to}`));
    } else if (l.kind === "create") {
      rows.push(row(L(`${K}added`), l.qty > 1 ? `${l.name} x${l.qty}` : l.name));
    } else if (l.kind === "delete") {
      rows.push(row(L(`${K}removed`), l.name));
    }
  }
  const { kept, drift } = plan.summary.counts;
  return `<div class="sde-cb-confirm"><p class="name">${esc(name)}</p><ul>${rows.join("")}</ul>`
    + `<p class="notice">${esc(F(`${K}kept`, { count: kept }))}</p>`
    + (drift ? `<p class="warn">${esc(F(`${K}drift`, { count: drift }))}</p>` : "")
    + "</div>";
}

/** The result line: only the parts that happened. */
function resultLine(plan, name) {
  const n = (kind) => plan.summary.lines.filter((l) => l.kind === kind).length;
  const fields = n("set") + n("art") + n("languages");
  const parts = [
    [fields, "fields"], [n("create"), "added"], [n("delete"), "removed"], [n("quantity"), "quantities"],
  ].filter(([c]) => c).map(([c, k]) => F(`${K}count.${k}`, { count: c }));
  return F(`${K}saved`, { name, what: parts.join(", ") });
}

/** What an IncompleteError left undone, in words (item names, never ids). */
function undoneText(err, existing) {
  if (err.step === "actor") return L(`${K}undone.actor`);
  const names = new Map([...existing.gearRows, ...existing.spellRows].map((r) => [r.itemId, r.name]));
  const what = err.step === "creates" ? err.missing : err.missing.map((id) => names.get(id) ?? id);
  return F(`${K}undone.${err.step}`, { names: what.join(", ") });
}

/**
 * Finish on an existing character.
 * @param {{actor: Actor, builderState: object, rebase: Function, close: Function}} app
 * @param {{confirm?: Function}} [deps]  the confirm dialog (a test seam)
 * @returns {Promise<"empty"|"cancelled"|"busy"|"failed"|"saved"|"partial">}
 */
export async function finishExisting(app, { confirm = defaultConfirm } = {}) {
  const actor = app.actor;
  const st = app.builderState;
  const notify = ui.notifications;
  let plan;
  try {
    // The live actor at Finish, not the one the builder opened on.
    const { snapshot } = await loadActorSnapshot(actor);
    plan = planCommit(st.existing, st, { source: { name: snapshot.name, system: snapshot.system }, items: snapshot.items });
    if (planIsEmpty(plan)) { notify.info(L(`${K}nothing`)); return "empty"; }
    const ok = await confirm({
      title: F(`${K}confirmTitle`, { name: actor.name }),
      content: await describePlan(plan, actor.name),
      yes: L(`${K}confirmYes`),
      no: L("SDE.charBuilder.commit.back"),
    });
    if (!ok) return "cancelled";
    // No backup, no write: a failure here leaves the character and the builder as they are.
    await takeBeforeImage(actor, { sessionId: st.existing.sessionId });
  } catch (err) {
    console.error("shadowdark-enhancer | char-builder finish failed:", err);
    notify.error(L(`${K}failed`));
    return "failed";
  }

  let outcome = "saved";
  try {
    await applyPlan(actor, plan, { commitId: st.existing.sessionId });
    notify.info(resultLine(plan, actor.name));
  } catch (err) {
    if (err instanceof ApplyInProgressError) { notify.warn(L(`${K}busy`)); return "busy"; }
    outcome = err instanceof IncompleteError ? "partial" : "failed";
    console.error("shadowdark-enhancer | char-builder apply failed:", err);
    notify.error(err instanceof IncompleteError
      ? F(`${K}incomplete`, { name: actor.name, undone: undoneText(err, st.existing) })
      : L(`${K}failed`));
  }

  // Whatever landed, start over from the live actor: a fresh baseline.
  try {
    const fresh = await hydrateActor(actor);
    if (fresh) await app.rebase(fresh); else await app.close();
  } catch (err) {
    console.error("shadowdark-enhancer | char-builder could not reload the character:", err);
    await app.close();
  }
  return outcome;
}

function defaultConfirm({ title, content, yes, no }) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title, icon: "fa-solid fa-floppy-disk" },
    content,
    yes: { label: yes, icon: "fa-solid fa-check" },
    no: { label: no },
  });
}
