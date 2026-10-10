/**
 * Shadowdark Enhancer — riding a mount on the map (#326), the Foundry half.
 *
 * Mount and Dismount are one Token HUD button on the rider (left column, a
 * horse; lit while riding). A mount is a Mount actor's token, grown to 2x2
 * when it is mounted if it is smaller. The pair is the rider's `mountedOn` flag, nothing
 * on the mount. Moving the mount carries the rider along in its corner on the
 * client that moved the mount; a player who cannot update the rider asks the
 * active GM to. The carried move ignores walls (the mount's own move already
 * met them) and the movement tracker charges and locks nothing for it
 * (isCarryMovement). A player rides only a Mount they own; a GM any. The rider moving any other way, Dismount, or the mount
 * being deleted ends the pair. Overland's `occupants` (who rides what while
 * travelling) is a different thing and is not touched.
 *
 * None of the module's own writes (carry, reconcile, grow, Mount, Dismount) go
 * into the token undo history, so Ctrl+Z reverts the mount in one press and
 * the rider follows it like any other mount move.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM, refuseQuery, registerQuery, relayToGM } from "../shared/gm-relay.mjs";
import { isMount } from "../actors/mount-scores.mjs";
import { carryInFlight, carryMovementId, followPath, grownSize, isCarryMovement, pickMount, snapPoint } from "./mounted-core.mjs";

export const MOUNTED_QUERY = `${MODULE_ID}.mounted`;
const FLAG = "mountedOn";
// Core records a client's own token updates for Ctrl+Z unless they are isUndo writes
// (Scene#_preUpdateDescendantDocuments), as its own revertRecordedMovement is. A move with it is
// method "undo": applied whole, never paused by a Region, never rotated, no ruler, walls not checked.
const UNRECORDED = { isUndo: true };
// Growing a mount to 2x2 is a size change, not a move: the movement tracker lets it through out of turn.
const GROW = { ...UNRECORDED, [MODULE_ID]: { mountGrow: true } };

const gridSize = (doc) => doc.parent?.grid?.size ?? 100;
/** Riding works on square-grid scenes only: the rider's corner and the 2x2 mount are square-grid shapes. */
const squareGrid = (scene) => !!scene?.grid?.isSquare;
const flagOf = (doc) => doc?.flags?.[MODULE_ID]?.[FLAG] ?? null;

/** The token this rider is on, or null (none, or it is gone). */
export const mountOf = (rider) => (flagOf(rider) ? rider.parent?.tokens?.get(flagOf(rider)) ?? null : null);

/** The token riding this mount, or null. */
export const riderOf = (mount) => mount?.parent?.tokens?.find((t) => flagOf(t) === mount.id) ?? null;

/** Move options for a carry: its movement id marks it, so the movement tracker charges and locks nothing for it. */
const carryOptions = () => ({ ...UNRECORDED, id: carryMovementId(foundry.utils.randomID(8)) });

/** The last carry this client started per rider id, so each waits for the one before. */
const carries = new Map();
/** How long a carry waits for the one before it (a behaviour may pause that one indefinitely). */
const CARRY_WAIT_MS = 3000;

/**
 * Walk the rider through the mount's waypoints, shifted to its corner.
 *
 * One carry at a time, each built after the one before has landed: core
 * resumes a carry a Region paused, and a carry sent while that resumed update
 * is in flight can be silently dropped. After the last carry, the rider is put
 * in its corner if it still isn't there (reconcile).
 */
function walk(rider, mountWaypoints) {
  const before = carries.get(rider.id);
  const next = (async () => {
    if (before) await Promise.race([before, new Promise((resolve) => setTimeout(resolve, CARRY_WAIT_MS))]);
    if (carryInFlight(rider.movement) && rider.movement.user?.isSelf) rider.stopMovement();
    await rider.move(followPath(mountWaypoints, rider._source, gridSize(rider)), carryOptions());
    if (carries.get(rider.id) !== next) return;   // a later carry follows; it reconciles
    carries.delete(rider.id);
    await reconcile(rider);
  })().catch((err) => console.warn(`${MODULE_ID} | carrying a rider failed`, err));
  carries.set(rider.id, next);
}

/**
 * Once its mount has stopped moving, put a rider that is not in its corner
 * there: a displace tagged as a carry, so not charged, not locked, and not
 * read as the rider's own move. Idempotent; it starts no further carry.
 */
async function reconcile(rider) {
  const mount = mountOf(rider);
  const to = snapPoint({
    mount: mount?._source, rider: rider._source, gridSize: gridSize(rider),
    mountMoving: mount?.movement?.state === "pending",
  });
  if (to) await rider.move(followPath([{ ...mount._source, action: "displace" }], rider._source, gridSize(rider))[0], carryOptions());
}

/** Carry the rider along the path the mount just moved (this update's part of it). */
function carry(mount, rider) {
  const passed = (mount.movement?.passed?.waypoints ?? []).filter((w) => !w.intermediate);
  walk(rider, passed.length ? passed : [mount._source]);
}

async function follow(mount, rider) {
  if (rider.canUserModify(game.user, "update")) return carry(mount, rider);
  await relayToGM(MOUNTED_QUERY, { action: "carry", sceneId: mount.parent.id, mountId: mount.id },
    { label: game.i18n.localize("SDE.mounted.relay") });
}

/** The mount this token would climb onto now, or null. Mounts are Mount actors' tokens; a mount rides nothing. */
function findMount(rider) {
  const tokens = rider.parent?.tokens;
  if (!tokens || !squareGrid(rider.parent) || isMount(rider.actor)) return null;
  const busy = new Set();
  for (const t of tokens) if (flagOf(t) && tokens.get(flagOf(t))) busy.add(t.id).add(flagOf(t));
  const shape = (t) => ({ id: t.id, x: t._source.x, y: t._source.y, width: t._source.width, height: t._source.height, busy: busy.has(t.id) });
  // A player rides only a Mount they own; a GM any (isOwner is true for a GM).
  const candidates = tokens.filter((t) => t !== rider && isMount(t.actor) && t.isOwner).map(shape);
  const id = pickMount(shape(rider), candidates, { targets: [...(game.user.targets ?? [])].map((t) => t.id), gridSize: gridSize(rider) });
  return id ? tokens.get(id) : null;
}

async function mountUp(rider) {
  const mount = findMount(rider);
  if (!mount) return ui.notifications.warn(game.i18n.localize("SDE.mounted.noMount"));
  // A mount's token is 2x2: grow a smaller one first (top-left kept). The user owns the mount, so may.
  const size = grownSize(mount._source);
  if (size) await mount.update(size, GROW);
  await replaceModuleFlag(rider, FLAG, mount.id, rider.sort > mount.sort ? {} : { sort: mount.sort + 1 }, UNRECORDED);
  walk(rider, [mount._source]);
}

const dismount = (rider) => replaceModuleFlag(rider, FLAG, null, {}, UNRECORDED)
  .catch((err) => console.warn(`${MODULE_ID} | dismounting failed`, err));

/**
 * The GM side of a carry a player could not make: the mount's mover owns the
 * mount but may not own its rider (a GM seated another player's character on
 * it). The requester must own the mount. Positions come from this client's
 * documents, never the payload.
 */
export async function handleMountedQuery(data, user) {
  const refusal = refuseQuery(user, game.i18n.localize("SDE.mounted.relay"));
  if (refusal) return refusal;
  const scene = game.scenes?.get(data?.sceneId);
  if (!squareGrid(scene)) return { ok: false, error: game.i18n.localize("SDE.mounted.squareOnly") };
  const mount = scene.tokens.get(data?.mountId);
  const rider = data?.action === "carry" ? riderOf(mount) : null;
  if (!rider) return { ok: false, error: game.i18n.localize("SDE.mounted.gone") };
  if (!isMount(mount.actor) || !mount.testUserPermission(user, "OWNER")) return { ok: false, error: game.i18n.localize("SDE.mounted.notYours") };
  carry(mount, rider);
  return { ok: true };
}

export function registerMountedTokens() {
  registerQuery(MOUNTED_QUERY, (data, { user } = {}) => handleMountedQuery(data, user));

  Hooks.on("renderTokenHUD", (hud, html) => {
    const rider = hud.object?.document;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!rider?.isOwner || !root) return;
    const riding = !!mountOf(rider);
    if (!riding && !findMount(rider)) return;   // findMount finds none off a square grid: no Mount button there
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon sde-hud-btn";
    btn.classList.toggle("active", riding);
    const tip = game.i18n.localize(riding ? "SDE.mounted.dismount" : "SDE.mounted.mount");
    btn.dataset.tooltip = tip;
    btn.setAttribute("aria-label", tip);
    btn.innerHTML = `<i class="fa-solid fa-horse" inert></i>`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hud.close();
      void (riding ? dismount(rider) : mountUp(rider));
    });
    root.querySelector(".col.left")?.append(btn);
  });

  // Only the tab that made a move reacts to it (preMoveToken runs there alone), not that user's other tabs.
  const started = new Set();
  Hooks.on("preMoveToken", (_doc, move) => { started.add(move.id); });
  Hooks.on("updateToken", (doc, changes) => {
    if (!started.delete(doc.movement?.id)) return;
    const moved = changes.x !== undefined || changes.y !== undefined || changes.elevation !== undefined;
    if (moved && flagOf(doc) && !isCarryMovement(doc.movement)) void dismount(doc);
    // A mount that moved, Ctrl+Z included, or changed size takes its rider to its (new) corner.
    const rider = (moved || changes.width !== undefined || changes.height !== undefined) ? riderOf(doc) : null;
    if (rider) void follow(doc, rider);
  });

  // A pasted copy of a rider rides nothing.
  Hooks.on("preCreateToken", (doc) => {
    if (flagOf(doc)) doc.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: _del });
  });

  Hooks.on("deleteToken", (doc) => {
    const rider = isActiveGM() ? riderOf(doc) : null;
    if (rider) void dismount(rider);
  });
}
