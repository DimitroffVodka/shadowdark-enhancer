import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { queryActiveGM, registerQuery, refuseQuery, isActiveGM } from "../shared/gm-relay.mjs";
import { tokenSourceFor } from "../shared/token-placement.mjs";
import { Party, isParty } from "./party.mjs";
import { normalizeParty } from "./party-core.mjs";
import { fillFormation, deploymentOrder, followOrder, planPlacement, headingTurns, routeToward, safeTrail, turnSlot } from "./party-movement-core.mjs";

export const MOVEMENT_QUERY = `${MODULE_ID}.partyMovement`;
export const MOVEMENT_CHANGED = `${MODULE_ID}.partyMovementChanged`;
const FLAG = "partyMovement";
const queues = new Map();
export const MOVEMENT_LABELS = {
  noToken: "SDE.party.movement.noToken",
  combat: "SDE.party.movement.combat", blocked: "SDE.party.movement.blocked",
  blockedMembers: "SDE.party.movement.blockedMembers", unknown: "SDE.party.movement.unknown",
};
const t = (key, data = {}) => game.i18n.format(MOVEMENT_LABELS[key], data);
const state = token => token?.flags?.[MODULE_ID]?.[FLAG] ?? {};
export const isPartyDeployed = token => isParty(token?.actor) && state(token).deployed === true;
export const inPartyCombat = scene => (game.combats?.contents ?? []).some(c => c.started && (!c.scene || c.scene.id === scene?.id));
const roster = actor => Party.rows(actor).filter(r => r.actor && ["characters", "hirelings", "mounts"].includes(r.group));
const linked = (scene, uuid, partyUuid) => scene.tokens.contents.filter(d => d.actorLink && d.actor?.uuid === uuid && (!state(d).partyUuid || state(d).partyUuid === partyUuid));
const serial = (key, work) => { const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work); queues.set(key, next); return next; };
function partyToken(ref, scene = globalThis.canvas?.scene) {
  const actor = Party.get(ref);
  return scene?.tokens?.contents?.find(d => d.actorLink && d.actor?.uuid === actor?.uuid) ?? null;
}
export function movementStatus(ref) {
  const token = partyToken(ref), actor = Party.get(ref);
  if (!token) return { reason: "noToken", deployed: false };
  const data = Party.data(actor);
  return { deployed: isPartyDeployed(token), reason: !data.followLeader ? "free" : inPartyCombat(token.parent) ? "combat" : "", token };
}
async function saveState(token, value) {
  await replaceModuleFlag(token, FLAG, value);
  Hooks.callAll(MOVEMENT_CHANGED);
}
export async function configureMovement(ref, changes) {
  const actor = Party.get(ref);
  if (!Party.canManage(actor)) throw new Error("SDE.party.noPermission");
  await Party.adopt(actor);
  const data = Party.data(actor), rows = roster(actor);
  const next = normalizeParty({ ...data, formation: fillFormation(data, rows), ...changes });
  if (!rows.some(r => r.uuid === next.leaderUuid && r.group !== "mounts")) next.leaderUuid = rows.find(r => r.group !== "mounts")?.uuid ?? null;
  await replaceModuleFlag(actor, "partyData", next);
  return next;
}
export async function requestMovement(ref, action, extra = {}) {
  const actor = Party.get(ref), token = partyToken(actor);
  if (!token) { const reply = { ok: false, error: t("noToken") }; ui.notifications?.warn(reply.error); return reply; }
  return requestTokenMovement(actor, token, action, extra);
}
async function requestTokenMovement(actor, token, action, extra = {}) {
  // The requester's client id rides to whoever executes: a relayed deploy is driven by the tab that clicked.
  const payload = { ...extra, partyId: actor.id, sceneId: token.parent.id, tokenId: token.id, action };
  const reply = isActiveGM() ? await executeMovement(payload, game.user) : await queryActiveGM(MOVEMENT_QUERY, payload);
  if (!reply.ok && reply.error) ui.notifications?.warn(reply.error);
  return reply;
}
function context(payload, user) {
  const actor = game.actors.get(payload.partyId), scene = game.scenes.get(payload.sceneId), token = scene?.tokens.get(payload.tokenId);
  if (!isParty(actor) || !user || !actor.testUserPermission(user, "OWNER") || !token?.actorLink || token.actor?.uuid !== actor.uuid) throw new Error("SDE.party.noPermission");
  return { actor, scene, token, user };
}
// V14 polygons derive their scene from the level; never use the relay GM's canvas.
const collisionFor = (scene, token) => (a, b) => CONFIG.Canvas.polygonBackends.move.testCollision(
  { ...a, elevation: token.elevation }, { ...b, elevation: token.elevation },
  { type: "move", mode: "any", level: scene.levels.get(token._source.level) ?? scene.initialLevel });
const dimensions = (scene, token) => ({ grid: scene.grid, sizeX: scene.grid.sizeX, sizeY: scene.grid.sizeY, bounds: scene.dimensions.sceneRect, blocked: collisionFor(scene, token) });
async function gather({ actor, scene, token }) {
  const eligible = roster(actor);
  const tokens = eligible.flatMap(r => linked(scene, r.uuid, actor.uuid));
  // A roster edit while deployed orphans that member's flagged token; recall it too.
  const members = new Set(eligible.map(r => r.uuid));
  const orphans = scene.tokens.contents.filter(d => state(d).partyUuid === actor.uuid && !members.has(d.actor?.uuid));
  // Fail before the first write: combat that starts mid-save must not be aborted after persisting.
  if (inPartyCombat(scene)) throw new Error("SDE.party.movement.combat");
  const saved = new Map((state(token).packed ?? []).map(s => [s.actorId, s]));
  // Keep the actual scene configuration and id, not a snapshot of Actor HP/items.
  for (const d of tokens) if (!saved.has(d.actorId) || state(d).partyUuid === actor.uuid) saved.set(d.actorId, d.toObject());
  // The recall clears `deployed` BEFORE its own deletes: the leader's token is among them,
  // and a leader move arriving late must read the party as already recalled.
  await saveState(token, { ...state(token), packed: [...saved.values()], deployed: false });
  if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(d => d.id));
  if (orphans.length) await scene.deleteEmbeddedDocuments("Token", orphans.map(d => d.id));
  return { ok: true, gathered: [...tokens, ...orphans].map(d => d.id) };
}
async function deploy({ actor, scene, token }) {
  const data = Party.data(actor), rows = roster(actor), sources = new Map((state(token).packed ?? []).map(s => [s.actorId, s]));
  const entries = [];
  for (const slot of deploymentOrder(data, rows)) {
    const member = rows.find(r => r.uuid === slot.memberUuid)?.actor;
    if (!member) continue;
    const existing = linked(scene, member.uuid, actor.uuid)[0];
    // A repeated Export leaves already deployed members where play put them.
    if (isPartyDeployed(token) && existing) {
      const duplicates = linked(scene, member.uuid, actor.uuid).slice(1).map(d => d.id);
      if (duplicates.length) await scene.deleteEmbeddedDocuments("Token", duplicates);
      continue;
    }
    const source = existing?.toObject() ?? sources.get(member.id) ?? await tokenSourceFor(member);
    entries.push({ ...slot, width: source.width, height: source.height, source, existing, member });
  }
  const moving = new Set(entries.map(e => e.existing?.id));
  const plan = planPlacement({ ...dimensions(scene, token), anchor: { x: token.x, y: token.y }, entries,
    occupied: scene.tokens.contents.filter(d => d.id !== token.id && !moving.has(d.id)).map(d => ({ x: d.x, y: d.y, width: d.width * scene.grid.sizeX, height: d.height * scene.grid.sizeY })) });
  const failed = [];
  for (const p of plan) {
    if (inPartyCombat(scene)) throw new Error("SDE.party.movement.combat");
    if (p.blocked) { failed.push(p.member.name); continue; }
    const marker = { partyUuid: actor.uuid };
    if (p.existing) {
      await replaceModuleFlag(p.existing, FLAG, marker, { x: p.x, y: p.y, actorLink: true, level: token._source.level });
    } else {
      const source = { ...p.source, x: p.x, y: p.y, level: token._source.level, actorId: p.member.id, actorLink: true,
        flags: { ...p.source.flags, [MODULE_ID]: { ...p.source.flags?.[MODULE_ID], [FLAG]: marker } } };
      delete source.delta; delete source._movementHistory;
      if (source._id && scene.tokens.has(source._id)) delete source._id;
      await scene.createEmbeddedDocuments("Token", [source], { keepId: true });
    }
    const duplicates = linked(scene, p.member.uuid, actor.uuid).filter(d => p.existing && d.id !== p.existing.id).map(d => d.id);
    if (duplicates.length) await scene.deleteEmbeddedDocuments("Token", duplicates);
  }
  const any = rows.some(r => linked(scene, r.uuid, actor.uuid).length);
  await saveState(token, { ...state(token), deployed: any });
  return { ok: !failed.length, failed, error: failed.length ? t("blockedMembers", { names: failed.join(", ") }) : undefined };
}
export function executeMovement(payload, user) {
  return serial(`Scene.${payload.sceneId}.Token.${payload.tokenId}`, async () => {
    try {
      const ctx = context(payload, user);
      if (["gather", "deploy", "toggle"].includes(payload.action) && inPartyCombat(ctx.scene)) throw new Error("SDE.party.movement.combat");
      switch (payload.action) {
        case "toggle": return isPartyDeployed(ctx.token) ? gather(ctx) : deploy(ctx);
        case "gather": return gather(ctx);
        case "deploy": return deploy(ctx);
        default: return { ok: false, error: t("unknown") };
      }
    } catch (error) { console.error(`${MODULE_ID} | Party movement`, error); return { ok: false, error: game.i18n.localize(error.message.startsWith("SDE.") ? error.message : "SDE.party.movement.blocked") }; }
  });
}
// Followers keep the formation, turned to face the way the leader is heading: each goes to its slot relative
// to where the leader ended up. Where a wall is in
// the way it walks round it (routeToward) to the nearest square it can reach, so nobody gets stranded off the
// path. One that still cannot move (missing token, combat) stays where it is and the rest carry on; the next
// leader move tries again.
async function follow(token, leader, movement, user) {
  const actor = token.actor, data = Party.data(actor);
  if (!data.followLeader || !isPartyDeployed(token) || inPartyCombat(token.parent) || !actor.testUserPermission(user, "OWNER")) return;
  const waypoints = movement.passed.waypoints;
  if (waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport)) return;
  const scene = token.parent, { grid } = scene, { sizeX, sizeY } = grid, bounds = scene.dimensions.sceneRect;
  const slots = new Map(deploymentOrder(data, roster(actor)).map(s => [s.memberUuid, s]));
  const lead = slots.get(data.leaderUuid) ?? { col: 0, row: 0 }, end = waypoints.at(-1);
  // Facing is the leader's last step; the grid's top row is the front. Hex grids keep it north-up.
  const points = [movement.origin, ...waypoints];
  let turns = null;
  for (let n = points.length - 1; n > 0 && turns === null; n--) turns = headingTurns(points[n].x - points[n - 1].x, points[n].y - points[n - 1].y);
  if (turns === null) return;
  if (grid.isHexagonal || grid.isGridless) turns = 0;
  const cellOf = p => grid.getOffset({ x: p.x + sizeX / 2, y: p.y + sizeY / 2 }), key = o => `${o.i},${o.j}`;
  const leaderCell = cellOf(end), taken = new Set([key(leaderCell)]);
  const step = p => ({ x: p.x, y: p.y, elevation: end.elevation, action: "walk", checkpoint: true });
  for (const uuid of followOrder(data, roster(actor)).filter(u => u !== data.leaderUuid)) {
    if (inPartyCombat(scene)) return;
    const doc = linked(scene, uuid, actor.uuid)[0];
    if (!doc) continue;
    const width = doc.width * sizeX, height = doc.height * sizeY, blocked = collisionFor(scene, doc), start = { x: doc.x, y: doc.y };
    const slot = slots.get(uuid) ?? lead;
    const offset = turnSlot({ col: slot.col - lead.col, row: slot.row - lead.row }, turns);
    const goal = grid.getTopLeftPoint({ i: leaderCell.i + offset.row, j: leaderCell.j + offset.col });
    const direct = !taken.has(key(cellOf(goal))) && safeTrail(start, goal, width, height, bounds, blocked);
    const path = direct ? [goal] : routeToward({ from: start, slot: goal, grid, sizeX: width, sizeY: height, bounds, blocked, avoid: taken });
    const last = path?.length ? path.at(-1) : start;
    taken.add(key(cellOf(last)));
    if (!path?.length || !await doc.move(path.map(step), { [MODULE_ID]: { partyFollow: true }, constrainOptions: { ignoreWalls: false, ignoreCost: false } })) continue;
  }
}
export function registerPartyMovement() {
  registerQuery(MOVEMENT_QUERY, (payload, { user }) => refuseQuery(user) ?? executeMovement(payload, user));
  Hooks.on("moveToken", (doc, movement, options, user) => {
    if (!isActiveGM() || options?.[MODULE_ID]?.partyFollow) return;
    for (const token of doc.parent.tokens.contents.filter(d => isPartyDeployed(d))) {
      const data = Party.data(token.actor);
      // The same key every movement action serialises this token on: a leader drag must
      // queue behind an in-flight recall, never move followers mid-recall.
      if (doc.actorLink && doc.actor?.uuid === data.leaderUuid) void serial(`Scene.${token.parent.id}.Token.${token.id}`, () => follow(token, doc, movement, user)).catch(error => console.error(`${MODULE_ID} | Party follow`, error));
    }
  });
  Hooks.on("updateToken", () => Hooks.callAll(MOVEMENT_CHANGED));
}
