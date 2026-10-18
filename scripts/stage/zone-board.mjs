/**
 * Shadowdark Enhancer — Stage zone fight: the board. A body-level layer of three
 * bands (Far, Near, Close) with a chip per combatant, drawn from the Combat and
 * Combatant documents alone so a reload or a late joiner sees the same thing.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { normalizeStage } from "./stage-core.mjs";
import { boardContext } from "./zone-board-core.mjs";
import { addFoe, applyZoneDamage, confirmEndZoneFight, findZoneFight, moveZone, toggleDefeated } from "./zone-fight.mjs";

export { boardContext };

const TEMPLATE = `modules/${MODULE_ID}/templates/stage/zone-board.hbs`;
const LAYER = "sde-zone-board";
const L = (key) => game.i18n.localize(key);

let queued = false, running = false, again = false;

/** Redraw once per tick however many hooks fire. */
export function scheduleBoard() {
  if (queued) return;
  queued = true;
  queueMicrotask(async () => {
    queued = false;
    if (running) { again = true; return; }
    running = true;
    try { await drawBoard(); } catch (err) { console.error(`${MODULE_ID} | zone board draw failed`, err); }
    running = false;
    if (again) { again = false; scheduleBoard(); }
  });
}

async function onClick(ev) {
  const btn = ev.target?.closest?.("[data-action]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === "end") {
    const fight = findZoneFight();
    if (fight) await confirmEndZoneFight(fight).catch((err) => console.error(`${MODULE_ID} | zone fight end failed`, err));
    return;
  }
  const chip = btn.closest("[data-combatant-id]");
  const combatant = findZoneFight()?.combatants?.get?.(chip?.dataset?.combatantId);
  if (!combatant) return;
  try {
    switch (btn.dataset.action) {
      case "closer": await moveZone(combatant, "closer"); break;
      case "farther": await moveZone(combatant, "farther"); break;
      case "defeated": await toggleDefeated(combatant); break;
      case "damage":
      case "heal": {
        const input = chip.querySelector(".zb-amount");
        const n = Math.floor(Number(input?.value));
        if (!(n >= 1)) { input?.focus?.(); return; }
        await applyZoneDamage(combatant, btn.dataset.action === "heal" ? -n : n);
        if (input) input.value = "";
        const pop = chip.querySelector("details");
        if (pop) pop.open = false;
        break;
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | zone board action failed`, err);
    ui.notifications?.warn(L("SDE.stage.zone.boardFailed"));
  }
}

const bandOf = (ev) => ev.target?.closest?.(".zb-band[data-zone]");

// Foundry's drag payload is JSON in text/plain, unreadable until the drop, so a dragover can only see the type is there.
function onDragOver(ev) {
  const band = bandOf(ev);
  if (!game.user?.isGM || !band || !Array.from(ev.dataTransfer?.types ?? []).includes("text/plain")) return;
  ev.preventDefault();
  band.classList.add("drop");
}

const clearDrops = (el) => el.querySelectorAll?.(".zb-band.drop")?.forEach?.((b) => b.classList.remove("drop"));

async function onDrop(ev) {
  const band = bandOf(ev);
  clearDrops(ev.currentTarget ?? document.querySelector(`#${LAYER}`) ?? {});
  if (!game.user?.isGM || !band) return;
  ev.preventDefault();
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
  if (data?.type !== "Actor" || !data.uuid) { ui.notifications?.warn(L("SDE.stage.zone.dropNotActor")); return; }
  const combat = findZoneFight();
  if (!combat) return;
  try {
    await addFoe(combat, { uuid: data.uuid, count: 1, zone: band.dataset.zone });
  } catch (err) {
    console.error(`${MODULE_ID} | zone board drop failed`, err);
    ui.notifications?.warn(L("SDE.stage.zone.boardFailed"));
  }
}

/** What the viewer has half done, so a redraw does not close their popover or eat their typing. */
function snapshot(el) {
  const open = el.querySelector?.("details[open]");
  const active = document.activeElement;
  return {
    openId: open?.closest?.("[data-combatant-id]")?.dataset?.combatantId ?? null,
    amount: open?.querySelector?.(".zb-amount")?.value ?? "",
    focus: el.contains?.(active) && active?.closest?.("[data-combatant-id]")
      ? { id: active.closest("[data-combatant-id]").dataset.combatantId, action: active.dataset?.action ?? null, amount: active.matches?.(".zb-amount") }
      : null,
  };
}

function restore(el, snap) {
  if (snap.openId) {
    const chip = el.querySelector?.(`[data-combatant-id="${snap.openId}"]`);
    const pop = chip?.querySelector?.("details");
    if (pop) {
      pop.open = true;
      const input = pop.querySelector(".zb-amount");
      if (input) input.value = snap.amount;
    }
  }
  const f = snap.focus;
  if (!f) return;
  const chip = el.querySelector?.(`[data-combatant-id="${f.id}"]`);
  chip?.querySelector?.(f.amount ? ".zb-amount" : f.action ? `[data-action="${f.action}"]` : "summary")?.focus?.();
}

async function drawBoard() {
  const combat = findZoneFight();
  if (!combat) { document.querySelector(`#${LAYER}`)?.remove(); return; }
  const stage = normalizeStage(game.settings.get(MODULE_ID, "stage"));
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, boardContext({ combat, user: game.user, stage }));
  if (!findZoneFight()) { document.querySelector(`#${LAYER}`)?.remove(); return; } // the fight ended while rendering
  let el = document.querySelector(`#${LAYER}`);
  if (!el) {
    el = document.createElement("div");
    el.id = LAYER;
    el.className = "sde-ui"; // the kit tokens; the stylesheet clears its page background
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", L("SDE.stage.zone.boardLabel"));
    el.addEventListener("click", onClick);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", (ev) => bandOf(ev)?.classList.remove("drop"));
    el.addEventListener("drop", onDrop);
    document.body.append(el);
  }
  // Same z-index as the picture, so document order decides: the board goes after it.
  const picture = document.querySelector("#sde-stage");
  if (picture && picture.nextElementSibling !== el) picture.after(el);
  const backed = !(stage.shown && stage.place && stage.image);
  el.classList.toggle("zb-backed", backed);
  const snap = snapshot(el);
  el.innerHTML = html;
  restore(el, snap);
}

const HOOKS = ["createCombat", "deleteCombat", "updateCombat", "createCombatant", "updateCombatant", "deleteCombatant"];

/** Does this actor stand in the running fight? */
const inFight = (actor) => !!actor?.id && Array.from(findZoneFight()?.combatants ?? []).some((c) => c.actorId === actor.id);

export function registerZoneBoard() {
  Hooks.once("ready", scheduleBoard);
  for (const name of HOOKS) Hooks.on(name, () => scheduleBoard());
  // The toolbar tool's lit state follows whether a fight exists.
  for (const name of ["createCombat", "deleteCombat"]) Hooks.on(name, () => { if (game.user?.isGM) ui.controls?.render({ reset: true }); });
  Hooks.on("updateActor", (actor) => { if (inFight(actor)) scheduleBoard(); });
  for (const name of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(name, (effect) => { if (inFight(effect?.parent)) scheduleBoard(); });
  }
  // The picture behind the board decides its backing.
  Hooks.on("updateSetting", (setting) => { if (setting?.key === `${MODULE_ID}.stage`) scheduleBoard(); });
}
