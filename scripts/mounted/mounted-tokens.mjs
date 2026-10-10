/**
 * Shadowdark Enhancer — riding a mount on the map (#326), the Foundry half.
 *
 * Mount and Dismount are one Token HUD button on the rider (left column, a
 * horse; lit while riding). The pair is the rider's `mountedOn` flag, nothing
 * on the mount. Moving the mount carries the rider along in its corner on the
 * client that moved the mount; a player who cannot update the rider asks the
 * active GM to. The carried move ignores walls (the mount's own move already
 * met them) and the movement tracker charges and locks nothing for it
 * (isCarriedMove). The rider moving any other way, Dismount, or the mount
 * being deleted ends the pair. Overland's `occupants` (who rides what while
 * travelling) is a different thing and is not touched.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM, refuseQuery, registerQuery, relayToGM } from "../shared/gm-relay.mjs";
import { followPath, isCarried, pickMount } from "./mounted-core.mjs";

export const MOUNTED_QUERY = `${MODULE_ID}.mounted`;
const FLAG = "mountedOn";
const CARRY = { constrainOptions: { ignoreWalls: true, ignoreCost: true }, autoRotate: false, showRuler: false };

const gridSize = (doc) => doc.parent?.grid?.size ?? 100;
const flagOf = (doc) => doc?.flags?.[MODULE_ID]?.[FLAG] ?? null;

/** The token this rider is on, or null (none, or it is gone). */
export const mountOf = (rider) => (flagOf(rider) ? rider.parent?.tokens?.get(flagOf(rider)) ?? null : null);

/** The token riding this mount, or null. */
export const riderOf = (mount) => mount?.parent?.tokens?.find((t) => flagOf(t) === mount.id) ?? null;

/** Is this rider movement its mount carrying it? The movement tracker spends and locks nothing for one. */
export function isCarriedMove(rider, move) {
  const mount = mountOf(rider);
  return isCarried(move, mount?._source, rider?._source, gridSize(rider));
}

/** Walk the rider through the mount's waypoints, shifted to its corner. */
function walk(rider, mountWaypoints) {
  rider.move(followPath(mountWaypoints, rider._source, gridSize(rider)), CARRY)
    .catch((err) => console.warn(`${MODULE_ID} | carrying a rider failed`, err));
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

/** The mount this token would climb onto now, or null. */
function findMount(rider) {
  const tokens = rider.parent?.tokens;
  if (!tokens) return null;
  const busy = new Set();
  for (const t of tokens) if (flagOf(t) && tokens.get(flagOf(t))) busy.add(t.id).add(flagOf(t));
  const shape = (t) => ({ id: t.id, x: t._source.x, y: t._source.y, width: t._source.width, height: t._source.height, busy: busy.has(t.id) });
  const candidates = tokens.filter((t) => t !== rider && (game.user.isGM || !t.hidden)).map(shape);
  const id = pickMount(shape(rider), candidates, { targets: [...(game.user.targets ?? [])].map((t) => t.id), gridSize: gridSize(rider) });
  return id ? tokens.get(id) : null;
}

async function mountUp(rider) {
  const mount = findMount(rider);
  if (!mount) return ui.notifications.warn(game.i18n.localize("SDE.mounted.noMount"));
  await replaceModuleFlag(rider, FLAG, mount.id, rider.sort > mount.sort ? {} : { sort: mount.sort + 1 });
  walk(rider, [mount._source]);
}

const dismount = (rider) => rider.unsetFlag(MODULE_ID, FLAG)
  .catch((err) => console.warn(`${MODULE_ID} | dismounting failed`, err));

/**
 * The GM side of a carry a player could not make: the mount's mover may not
 * own the rider. Positions come from this client's documents, never the payload.
 */
export async function handleMountedQuery(data, user) {
  const refusal = refuseQuery(user, game.i18n.localize("SDE.mounted.relay"));
  if (refusal) return refusal;
  const mount = game.scenes?.get(data?.sceneId)?.tokens.get(data?.mountId);
  const rider = data?.action === "carry" ? riderOf(mount) : null;
  if (!rider) return { ok: false, error: game.i18n.localize("SDE.mounted.gone") };
  if (!mount.testUserPermission(user, "OWNER")) return { ok: false, error: game.i18n.localize("SDE.mounted.notYours") };
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
    if (!riding && !findMount(rider)) return;
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

  // Runs on the client that moved the token, which may update it.
  Hooks.on("updateToken", (doc, changes, _options, userId) => {
    if (userId !== game.userId) return;
    if (changes.x === undefined && changes.y === undefined && changes.elevation === undefined) return;
    if (flagOf(doc) && !isCarriedMove(doc, doc.movement)) void dismount(doc);
    const rider = riderOf(doc);
    if (rider) void follow(doc, rider);
  });

  Hooks.on("deleteToken", (doc) => {
    const rider = isActiveGM() ? riderOf(doc) : null;
    if (rider) void dismount(rider);
  });
}
