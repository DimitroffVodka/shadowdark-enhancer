import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { Party, isNativeParty } from "../party/party.mjs";
import { CAMP_LABELS, taskDefinitions, selectTask, lockCamp, torchPlan, fireDecision, fireAlive } from "./camping-core.mjs";
import { queryActiveGM, registerQuery, refuseQuery, isActiveGM } from "../shared/gm-relay.mjs";
import { registerCook, expireCook } from "./camping-cook.mjs";
import { foodPreview, feedCamp, restCamp } from "./camping-nutrition.mjs";
import { isMount, adoptMountScores } from "../actors/mount-scores.mjs";
import { secondsPerHour } from "../time/time-core.mjs";
const QUERY = `${MODULE_ID}.camping`, queues = new Map();
const actorOf = uuid => game.actors.contents.find(a => a.uuid === uuid);
const own = (a, u) => !!a?.testUserPermission(u, "OWNER");
const flag = (a, key) => a?.flags?.[MODULE_ID]?.[key];
const invalid = () => { throw new Error("SDE.camping.invalid"); };
export const campOf = party => structuredClone(flag(party, "camping"));
const save = (party, camp) => replaceModuleFlag(party, "camping", camp);
const torch = item => item.type === "Basic" && item.system?.light?.isSource && item.system.light.template === "torch" && !item.system.magicItem && !item.system.light.active && !item.system.light.hasBeenUsed;
export function campTorchPlan(party, camp = campOf(party)) {
  const stacks = [party, ...camp.participants.map(p => actorOf(p.uuid)).filter(Boolean)].flatMap(a => a.items.filter(torch).map(i => ({ actorUuid: a.uuid, id: i.id, quantity: i.system.quantity })));
  return torchPlan(stacks, party.uuid, camp.participants);
}
function definitions(party) {
  let custom = flag(party, "campTasks");
  if (!custom && game.settings.settings.has("shadowdark-extras.travelActivities")) {
    try { custom = game.settings.get("shadowdark-extras", "travelActivities")?.activities; } catch { /* optional saved provider */ }
  }
  return taskDefinitions(custom);
}
function anchor(party, participants) {
  const scene = globalThis.canvas?.scene;
  const token = scene?.tokens.contents.find(t => t.actorId === party.id) ?? scene?.tokens.contents.find(t => participants.some(p => actorOf(p.uuid)?.id === t.actorId));
  // Match nearFire: a camp started during movement belongs at the committed
  // destination, not the transient position rendered by token animation.
  const position = token?._source ?? token;
  return token ? { sceneId: scene.id, x: position.x + token.width * scene.grid.size / 2, y: position.y + token.height * scene.grid.size / 2 } : null;
}
function nearFire(party, camp) {
  const scene = game.scenes.get(camp.anchor?.sceneId); if (!scene) return false;
  const radius = 30 * scene.grid.size / scene.grid.distance;
  return scene.tokens.contents.some(t => {
    const pc = camp.participants.some(p => actorOf(p.uuid)?.id === t.actorId);
    // A recalled party is its token: its members are packed into it and not deployed. A party token that never
    // split out (the hex map) is the whole party too.
    const moved = t.flags?.[MODULE_ID]?.partyMovement;
    const gathered = t.actorId === party.id && moved?.deployed !== true && (!moved || !!moved.packed?.length) && camp.participants.length > 0;
    // TokenDocument x/y may still be the animation's interpolated position in
    // updateToken; proximity follows committed coordinates, not rendered motion.
    const position = t._source ?? t;
    return (pc || gathered) && Math.hypot(position.x + t.width * scene.grid.size / 2 - camp.anchor.x, position.y + t.height * scene.grid.size / 2 - camp.anchor.y) <= radius;
  });
}
async function lightFire(party, camp, source) {
  // No canvas: a fire cannot be placed or watched, so it is declined, not an error.
  if (!camp.anchor) return;
  if (!nearFire(party, camp)) invalid();
  const scene = game.scenes.get(camp.anchor.sceneId);
  camp.fire = { lit: true, source, started: camp.fire?.started ?? game.time.worldTime, lightId: camp.fire?.lightId ?? foundry.utils.randomID() };
  await save(party, camp);
  if (!scene.lights.has(camp.fire.lightId)) await scene.createEmbeddedDocuments("AmbientLight", [{ _id: camp.fire.lightId, x: camp.anchor.x, y: camp.anchor.y, config: { dim: 0, bright: 30, color: "#ffb35c", alpha: 0.3 }, flags: { [MODULE_ID]: { campFire: { partyUuid: party.uuid, campId: camp.id } } } }], { keepId: true });
}
async function rollTask(party, camp, p) {
  if (camp.results[p.actorId] || !p.task) return;
  const actor = actorOf(p.uuid), task = camp.tasks.find(t => t.key === p.task); if (!actor || !task) invalid();
  const disadvantage = task.campfire && !camp.fire?.lit;
  const modifier = Number(actor.system.abilities[p.ability].mod) || 0;
  const roll = await new Roll(`${disadvantage ? "2d20kl" : "1d20"} + @mod`, { mod: modifier }).evaluate();
  const result = { task: p.task, ability: p.ability, dc: task.dc, disadvantage, total: roll.total, success: roll.total >= task.dc };
  if (result.success && (p.task === "hunt" || (p.task === "craft" && p.craft !== "repair" && p.craft !== "torch"))) result.amount = (await new Roll(p.task === "hunt" ? "1d4" : "2d4").evaluate()).total;
  camp.results[p.actorId] = result; await save(party, camp);
  // Reporting is deliberately outside the saved result: failure never makes a roll replayable.
  try { await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: game.i18n.localize(task.label ?? "SDE.camping.customTask") }); } catch (error) { console.warn(`${MODULE_ID} | Camp roll report`, error); }
}
async function reward(actor, camp, p, result) {
  const previous = actor.items.find(i => flag(i, "campReward")?.campId === camp.id && flag(i, "campReward")?.task === p.task);
  if (previous) return;
  const key = p.task === "hunt" ? "rations" : p.craft ?? "torch";
  const data = { name: game.i18n.localize(CAMP_LABELS.gear[key]), type: "Basic", system: { quantity: result.amount ?? 1, isAmmunition: ["arrows", "bolts", "slingStones"].includes(key), slots: { per_slot: key === "rations" ? 3 : key === "torch" ? 1 : 20 }, light: { isSource: key === "torch", template: "torch", active: false, hasBeenUsed: false, longevityMins: 60, remainingSecs: 3600 } }, flags: { [MODULE_ID]: { campReward: { campId: camp.id, task: p.task } } } };
  await actor.createEmbeddedDocuments("Item", [data]);
}
async function effects(party, camp) {
  for (const p of camp.participants) {
    const r = camp.results[p.actorId]; if (!r || camp.effects[p.actorId]) continue;
    const actor = actorOf(p.uuid); if (!actor) invalid();
    if (r.success) {
      if (p.task === "hunt" || (p.task === "craft" && p.craft !== "repair")) await reward(actor, camp, p, r);
      if (p.task === "craft" && p.craft === "repair") {
        const item = actor.items.get(p.repairItemId); if (!item || item.system.magicItem) invalid();
        if (flag(item, "campRepair") !== camp.id) await replaceModuleFlag(item, "campRepair", camp.id, { "system.broken": false });
      }
      if (p.task === "entertain") {
        const target = actorOf(p.recipientUuid); if (!target) invalid();
        const applied = flag(target, "campLuck") ?? {};
        const key = `${camp.id}:${p.actorId}`;
        if (!applied[key]) {
          const pulp = game.settings.get("shadowdark", "usePulpMode");
          const extra = pulp ? { "system.luck.remaining": (target.system.luck.remaining ?? 0) + 1 } : { "system.luck.available": true };
          await replaceModuleFlag(target, "campLuck", { ...applied, [key]: true }, extra);
        }
      }
    }
    camp.effects[p.actorId] = r.success ? (p.task === "cook" ? "afterRest" : "saved") : "failed";
    await save(party, camp);
  }
}
async function resolveTasks(party, camp) {
  if (camp.phase === "firewood") {
    for (const p of camp.participants.filter(p => p.task === "firewood")) await rollTask(party, camp, p);
    const decision = fireDecision(camp, Object.values(camp.results));
    if (decision === "wood") { await lightFire(party, camp, "wood"); camp.phase = "tasks"; }
    else camp.phase = decision === "none" || !camp.anchor ? "tasks" : "fuel";
    await save(party, camp);
  }
  if (camp.phase === "tasks") {
    for (const p of camp.participants) await rollTask(party, camp, p);
    await effects(party, camp); camp.phase = "awaitingRest"; await save(party, camp);
  }
  return camp;
}
function validateChoices(camp) {
  for (const p of camp.participants) {
    const actor = actorOf(p.uuid); if (!actor || actor.type !== "Player") invalid();
    if (p.task === "craft" && p.craft === "repair") { const item = actor.items.get(p.repairItemId); if (!item?.system?.isPhysical || !item.system.broken || item.system.magicItem) invalid(); }
  }
}
async function perform(party, action, data, user) {
  if (!isNativeParty(party)) invalid();
  const manager = own(party, user); let camp = campOf(party);
  if (action === "begin") {
    if (!manager) invalid(); if (camp && camp.phase !== "complete") return camp;
    // IDs, not dotted UUIDs, key saved result/effect maps: Foundry expands dotted object keys.
    const participants = Party.members(party, { charactersOnly: true }).map(uuid => ({ uuid, actorId: actorOf(uuid).id, confirmed: true, participate: true, task: "", ability: null, torchConsent: false, craft: "torch", watchHalf: "first" }));
    const mounts = Party.members(party).filter(uuid => isMount(actorOf(uuid))).map(uuid => ({ uuid, actorId: actorOf(uuid).id }));
    for (const p of mounts) await adoptMountScores(actorOf(p.uuid));
    camp = { id: foundry.utils.randomID(), phase: "setup", participants, mounts, tasks: definitions(party), fuel: "none", anchor: anchor(party, participants), results: {}, effects: {}, day: null }; await save(party, camp); return camp;
  }
  if (!camp) invalid();
  if (action === "select") {
    const actor = actorOf(data.uuid); if (!own(actor, user) || actor.type !== "Player") invalid();
    const patch = {}; for (const k of ["task", "ability", "torchConsent", "craft", "repairItemId", "recipientUuid", "watchHalf"]) if (data.patch?.[k] !== undefined) patch[k] = data.patch[k];
    if (patch.task && patch.task !== camp.participants.find(p => p.uuid === data.uuid)?.task) patch.ability ??= camp.tasks.find(t => t.key === patch.task)?.abilities[0];
    camp = selectTask(camp, data.uuid, patch); await save(party, camp); return camp;
  }
  if (!manager) invalid();
  // A completed night can still owe its summary. Public Resume/Review retries
  // only that report, never tasks, Cook expiry, rest or Overland time.
  if (camp.phase === "complete" && ["resume", "resolve"].includes(action)) { await reportCampNight(party, camp); return camp; }
  if (action === "cancel" && camp.phase === "setup") { await save(party, null); return null; }
  if (action === "fuelChoice" && camp.phase === "setup") { if (!["none", "wood", "torches"].includes(data.fuel)) invalid(); camp.fuel = data.fuel; await save(party, camp); return camp; }
  if (action === "dc" && camp.phase === "setup" && user.isGM) { const t = camp.tasks.find(t => t.key === data.task); if (!t || !Number.isFinite(data.dc)) invalid(); t.dc = data.dc; await save(party, camp); return camp; }
  if (action === "resolve") {
    if (camp.phase === "setup") validateChoices(camp);
    if (camp.phase === "setup") { if ((camp.fuel !== "none" || camp.participants.some(p => p.task === "firewood")) && camp.anchor && !nearFire(party, camp)) invalid(); camp = lockCamp(camp); await save(party, camp); }
    camp = await resolveTasks(party, camp);
    // "Existing torches" was the choice, so the torch step needs no second confirmation: spend them if three can be
    // had, otherwise go on without a fire.
    if (camp.phase === "fuel" && camp.fuel === "torches") {
      const plan = campTorchPlan(party, camp);
      // Going on without a fire is said in the window, not left for the disadvantage on the rolls to show.
      if (!plan.ok) { camp.fuelShort = plan.available; await save(party, camp); }
      return perform(party, "fuel", { accept: plan.ok, deductions: plan.deductions }, user);
    }
    return camp;
  }
  if (action === "fuel" && camp.phase === "fuel") {
    // Without a canvas the fire cannot be placed, so an accepted fallback is
    // declined without charging; an already charged plan simply misses its light.
    if (data.accept && camp.anchor) {
      const plan = campTorchPlan(party, camp); if (!camp.fuelPlan && !plan.ok) return camp;
      if (!camp.fuelPlan && JSON.stringify(data.deductions) !== JSON.stringify(plan.deductions)) invalid();
      if (!camp.anchor || !nearFire(party, camp)) invalid();
      if (!camp.fuelPlan) { camp.fuelPlan = plan.deductions; await save(party, camp); }
      for (const d of camp.fuelPlan) {
        const item = actorOf(d.actorUuid)?.items.get(d.id);
        if (!item || (flag(item, "campFuel") !== camp.id && item.system.quantity < d.quantity)) invalid();
      }
      // Each quantity and its camp marker commit together. Resume skips already charged stacks.
      for (const d of camp.fuelPlan) {
        const item = actorOf(d.actorUuid)?.items.get(d.id); if (!item) invalid();
        if (flag(item, "campFuel") !== camp.id) { if (item.system.quantity < d.quantity) invalid(); await replaceModuleFlag(item, "campFuel", camp.id, { "system.quantity": item.system.quantity - d.quantity }); }
      }
      await lightFire(party, camp, "torches");
    } else if (!data.accept && camp.fuelPlan) invalid();
    camp.phase = "tasks"; await save(party, camp); return resolveTasks(party, camp);
  }
  if (action === "resume") { for (const p of camp.participants) { const a = actorOf(p.uuid); if (a) await expireCook(a); } return resolveTasks(party, camp); }
  invalid();
}
export async function handleCamp(data, user) {
  const refusal = refuseQuery(user); if (refusal) return refusal;
  const party = game.actors.get(data.partyId); if (!party) return { ok: false, error: game.i18n.localize("SDE.camping.invalid") };
  return queued(party, async () => {
    try { return { ok: true, camp: await perform(party, data.action, data, user) }; }
    catch (error) { console.error(`${MODULE_ID} | Camping`, error); return { ok: false, error: game.i18n.localize(error.message.startsWith("SDE.") ? error.message : "SDE.camping.invalid") }; }
  });
}
async function queued(party, work) {
  const previous = queues.get(party.id) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  queues.set(party.id, run); try { return await run; } finally { if (queues.get(party.id) === run) queues.delete(party.id); }
}
export function requestCamp(party, action, data = {}) {
  const payload = { ...data, partyId: party.id, action };
  return isActiveGM() ? handleCamp(payload, game.user) : queryActiveGM(QUERY, payload);
}
/** Overland alone calls these seams; neither tasks nor rest can move the clock. */
export function prepareCampNight(party, context, user, acceptShortages = false) {
  return queued(party, async () => {
    if (!own(party, user)) invalid();
    let camp = campOf(party);
    if (!camp || camp.phase === "complete") { await perform(party, "begin", {}, user); return { ready: false }; }
    if (camp.phase !== "awaitingRest") return { ready: false };
    if (camp.day === null || camp.day === undefined) { camp = { ...camp, ...context }; await save(party, camp); }
    if (camp.day !== context.day) invalid();
    const shortages = foodPreview(party, camp).some(p => !p.fed);
    if (shortages && !acceptShortages && !camp.foodCommitted) { camp.shortageWarning = true; await save(party, camp); return { ready: false }; }
    camp.foodCommitted = true; await save(party, camp);
    await feedCamp(party, camp);
    return { ready: true, camp };
  });
}
async function reportCampNight(party, camp) {
  if (!camp.reportId) { camp.reportId = foundry.utils.randomID(); await save(party, camp); }
  try {
    if (!game.messages.has(camp.reportId)) await ChatMessage.create({ _id: camp.reportId, content: `<p>${game.i18n.localize("SDE.camping.nightComplete")}</p>` }, { keepId: true });
  } catch (error) { console.warn(`${MODULE_ID} | Camp summary`, error); }
}
export function finishCampNight(party, campId, interrupted) {
  return queued(party, async () => {
    const camp = campOf(party); if (!camp || camp.id !== campId) invalid();
    if (camp.phase !== "complete") {
      await restCamp(party, camp, interrupted);
      camp.phase = "complete"; camp.interrupted = interrupted; await save(party, camp);
    }
    await reportCampNight(party, camp);
    return { completed: true };
  });
}
export async function refreshCampFires() {
  if (!isActiveGM()) return;
  for (const party of game.actors.contents.filter(isNativeParty)) {
    await queued(party, async () => {
      const camp = campOf(party); if (!camp?.fire?.lit || fireAlive(camp.fire, game.time.worldTime, nearFire(party, camp), secondsPerHour(game.time.calendar))) return;
      const scene = game.scenes.get(camp.anchor.sceneId), light = scene?.lights.get(camp.fire.lightId);
      if (light?.flags?.[MODULE_ID]?.campFire?.campId === camp.id) await light.delete();
      await save(party, { ...camp, fire: { ...camp.fire, lit: false } });
    });
  }
}
export function registerCamping() {
  registerQuery(QUERY, (data, { user }) => handleCamp(data, user)); registerCook();
  // Embedded-token hooks can run before the Scene collection finishes updating.
  // Read proximity after that document operation, not inside its hook dispatch.
  for (const hook of ["updateWorldTime", "updateToken", "deleteToken"]) Hooks.on(hook, () => { setTimeout(() => { void refreshCampFires().catch(error => console.error(`${MODULE_ID} | Camp fire`, error)); }, 0); });
  Hooks.once("ready", () => { void refreshCampFires(); });
}
