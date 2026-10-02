import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { queryActiveGM, registerQuery, refuseQuery, isActiveGM } from "../shared/gm-relay.mjs";
import { tokenSourceFor } from "../shared/token-placement.mjs";
import { Party, isParty } from "./party.mjs";
import { normalizeParty } from "./party-core.mjs";
import { fillFormation, deploymentOrder, followOrder, planPlacement, safeFootprint } from "./party-movement-core.mjs";

export const MOVEMENT_QUERY = `${MODULE_ID}.partyMovement`;
export const MOVEMENT_CHANGED = `${MODULE_ID}.partyMovementChanged`;
const FLAG = "partyMovement";
const queues = new Map(), armed = new Set();
export const MOVEMENT_LABELS = {
  noToken: "SDE.party.movement.noToken", free: "SDE.party.movement.free",
  combat: "SDE.party.movement.combat", scene: "SDE.party.movement.scene",
  reload: "SDE.party.movement.reload", gathered: "SDE.party.movement.gathered",
  leader: "SDE.party.movement.leader", teleport: "SDE.party.movement.teleport",
  missing: "SDE.party.movement.missing", blocked: "SDE.party.movement.blocked",
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
  return { deployed: isPartyDeployed(token), reason: !data.followLeader ? "free" : inPartyCombat(token.parent) ? "combat" : state(token).pause ?? "reload", pausedMemberUuid: state(token).pausedMemberUuid, token };
}
async function saveState(token, value) {
  await replaceModuleFlag(token, FLAG, value);
  Hooks.callAll(MOVEMENT_CHANGED);
}
async function pause(token, reason, pausedMemberUuid = null) {
  armed.delete(token.uuid);
  await saveState(token, { ...state(token), pause: reason, pausedMemberUuid });
}
export async function configureMovement(ref, changes) {
  const actor = Party.get(ref);
  if (!Party.canManage(actor)) throw new Error("SDE.party.noPermission");
  await Party.adopt(actor);
  const data = Party.data(actor), rows = roster(actor);
  const next = normalizeParty({ ...data, formation: fillFormation(data, rows), ...changes });
  if (!rows.some(r => r.uuid === next.leaderUuid && r.group !== "mounts")) next.leaderUuid = rows.find(r => r.group !== "mounts")?.uuid ?? null;
  await replaceModuleFlag(actor, "partyData", next);
  if (changes.leaderUuid !== undefined && changes.leaderUuid !== data.leaderUuid) {
    const token = partyToken(actor); if (token) await requestMovement(actor, "pause", { reason: "leader" });
  }
  return next;
}
export async function requestMovement(ref, action, extra = {}) {
  const actor = Party.get(ref), token = partyToken(actor);
  if (!token) { const reply = { ok: false, error: t("noToken") }; ui.notifications?.warn(reply.error); return reply; }
  return requestTokenMovement(actor, token, action, extra);
}
async function requestTokenMovement(actor, token, action, extra = {}) {
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
function wallFootprint(scene, level, point, width, height) {
  const e = 0.1, rect = new PIXI.Rectangle(point.x + e, point.y + e, width - 2 * e, height - 2 * e);
  const corners = [{ x: rect.x, y: rect.y }, { x: rect.right, y: rect.y }, { x: rect.right, y: rect.bottom }, { x: rect.x, y: rect.bottom }];
  return scene.walls.contents.some(wall => {
    if (!wall.move || wall.ds === CONST.WALL_DOOR_STATES.OPEN || (wall.levels.size && !wall.levels.has(level))) return false;
    const [ax, ay, bx, by] = wall.c, a = { x: ax, y: ay }, b = { x: bx, y: by };
    return rect.contains(ax, ay) || rect.contains(bx, by) || corners.some((c, i) => foundry.utils.lineSegmentIntersects(a, b, c, corners[(i + 1) % 4]));
  });
}
const dimensions = (scene, token) => ({ grid: scene.grid, sizeX: scene.grid.sizeX, sizeY: scene.grid.sizeY, bounds: scene.dimensions.sceneRect, blocked: collisionFor(scene, token),
  footprintBlocked: (p, w, h) => wallFootprint(scene, token._source.level, p, w, h) });
async function gather({ actor, scene, token }) {
  const eligible = roster(actor);
  const tokens = eligible.flatMap(r => linked(scene, r.uuid, actor.uuid));
  const saved = new Map((state(token).packed ?? []).map(s => [s.actorId, s]));
  // Keep the actual scene configuration and id, not a snapshot of Actor HP/items.
  for (const d of tokens) if (!saved.has(d.actorId) || state(d).partyUuid === actor.uuid) saved.set(d.actorId, d.toObject());
  await saveState(token, { ...state(token), packed: [...saved.values()], pause: "gathered" });
  if (inPartyCombat(scene)) throw new Error("SDE.party.movement.combat");
  if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(d => d.id));
  await saveState(token, { ...state(token), deployed: false });
  armed.delete(token.uuid);
  return { ok: true, gathered: tokens.map(d => d.id) };
}
async function deploy({ actor, scene, token, user }) {
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
  await saveState(token, { ...state(token), deployed: any, driverUserId: user.id, pause: failed.length ? "blocked" : "" });
  if (any && !failed.length) armed.add(token.uuid);
  return { ok: !failed.length, failed, error: failed.length ? t("blockedMembers", { names: failed.join(", ") }) : undefined };
}
export function executeMovement(payload, user) {
  return serial(`Scene.${payload.sceneId}.Token.${payload.tokenId}`, async () => {
    try {
      const ctx = context(payload, user);
      if (["gather", "deploy", "toggle", "resume"].includes(payload.action) && inPartyCombat(ctx.scene)) throw new Error("SDE.party.movement.combat");
      switch (payload.action) {
        case "toggle": return isPartyDeployed(ctx.token) ? gather(ctx) : deploy(ctx);
        case "gather": return gather(ctx);
        case "deploy": return deploy(ctx);
        case "resume": armed.add(ctx.token.uuid); await saveState(ctx.token, { ...state(ctx.token), driverUserId: user.id, pause: "" }); return { ok: true };
        case "pause": await pause(ctx.token, ["leader", "reload", "scene"].includes(payload.reason) ? payload.reason : "leader"); return { ok: true };
        default: return { ok: false, error: t("unknown") };
      }
    } catch (error) { console.error(`${MODULE_ID} | Party movement`, error); return { ok: false, error: game.i18n.localize(error.message.startsWith("SDE.") ? error.message : "SDE.party.movement.blocked") }; }
  });
}
async function follow(token, leader, movement, user) {
  const actor = token.actor, data = Party.data(actor);
  if (!data.followLeader || !isPartyDeployed(token) || !armed.has(token.uuid) || !actor.testUserPermission(user, "OWNER")) return;
  const waypoints = movement.passed.waypoints;
  if (waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport)) { await pause(token, "teleport"); return; }
  let preceding = { origin: movement.origin, path: waypoints };
  for (const uuid of followOrder(data, roster(actor)).filter(u => u !== data.leaderUuid)) {
    if (!armed.has(token.uuid) || inPartyCombat(token.parent)) { await pause(token, "combat"); return; }
    const doc = linked(token.parent, uuid, actor.uuid)[0];
    if (!doc) { await pause(token, "missing", uuid); return; }
    const path = [preceding.origin, ...preceding.path.slice(0, -1)].map(w => ({ x: w.x, y: w.y, elevation: w.elevation, action: "walk", checkpoint: true }));
    const start = { x: doc.x, y: doc.y, elevation: doc.elevation };
    let at = start;
    for (const point of path) {
      if (!safeFootprint(at, point, doc.width * token.parent.grid.sizeX, doc.height * token.parent.grid.sizeY, token.parent.dimensions.sceneRect, collisionFor(token.parent, doc),
        (p, w, h) => wallFootprint(token.parent, doc._source.level, p, w, h))) { await pause(token, "blocked", uuid); return; }
      at = point;
    }
    const completed = await doc.move(path, { [MODULE_ID]: { partyFollow: true }, constrainOptions: { ignoreWalls: false, ignoreCost: false } });
    if (!completed) { await pause(token, "blocked", uuid); return; }
    preceding = { origin: start, path };
  }
}
export function registerPartyMovement() {
  registerQuery(MOVEMENT_QUERY, (payload, { user }) => refuseQuery(user) ?? executeMovement(payload, user));
  Hooks.once("ready", () => {
    for (const scene of game.scenes.contents) for (const token of scene.tokens.contents) {
      if (!isPartyDeployed(token)) continue;
      if (isActiveGM()) void pause(token, "reload");
      else if (state(token).driverUserId === game.user.id && Party.canManage(token.actor)) void requestTokenMovement(token.actor, token, "pause", { reason: "reload" });
    }
  });
  Hooks.on("moveToken", (doc, movement, options, user) => {
    if (!isActiveGM() || options?.[MODULE_ID]?.partyFollow) return;
    for (const token of doc.parent.tokens.contents.filter(d => isPartyDeployed(d))) {
      const data = Party.data(token.actor);
      if (doc.actorLink && doc.actor?.uuid === data.leaderUuid) void serial(token.uuid, () => follow(token, doc, movement, user)).catch(error => { console.error(error); return pause(token, "blocked"); });
    }
  });
  Hooks.on("deleteToken", doc => {
    if (!isActiveGM()) return;
    for (const token of doc.parent.tokens.contents.filter(d => isPartyDeployed(d))) if (doc.actor?.uuid === Party.data(token.actor).leaderUuid) void pause(token, "missing");
  });
  Hooks.on("updateCombat", combat => {
    if (!isActiveGM() || !combat.started) return;
    for (const scene of game.scenes.contents) for (const token of scene.tokens.contents) if (isPartyDeployed(token) && inPartyCombat(scene)) void pause(token, "combat");
  });
  Hooks.on("canvasTearDown", () => {
    // Deploy/Resume records its authenticated driver, not the relay authority.
    for (const token of canvas.scene?.tokens.contents ?? []) if (isPartyDeployed(token) && Party.canManage(token.actor) && state(token).driverUserId === game.user.id) void requestMovement(token.actor, "pause", { reason: "scene" });
  });
  Hooks.on("canvasReady", () => {
    for (const token of canvas.scene?.tokens.contents ?? []) {
      if (!isPartyDeployed(token) || !Party.canManage(token.actor)) continue;
      if (state(token).driverUserId === game.user.id && !state(token).pause) void requestMovement(token.actor, "pause", { reason: "reload" });
    }
  });
  Hooks.on("updateToken", () => Hooks.callAll(MOVEMENT_CHANGED));
}
