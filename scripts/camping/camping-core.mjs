/** PC camp rules; no Foundry globals or rest/time executor. */
const TASK_LABELS = {
  battenDown: ["SDE.camping.tasks.battenDown.name", "SDE.camping.tasks.battenDown.description"],
  cook: ["SDE.camping.tasks.cook.name", "SDE.camping.tasks.cook.description"],
  craft: ["SDE.camping.tasks.craft.name", "SDE.camping.tasks.craft.description"],
  entertain: ["SDE.camping.tasks.entertain.name", "SDE.camping.tasks.entertain.description"],
  firewood: ["SDE.camping.tasks.firewood.name", "SDE.camping.tasks.firewood.description"],
  hunt: ["SDE.camping.tasks.hunt.name", "SDE.camping.tasks.hunt.description"],
  keepWatch: ["SDE.camping.tasks.keepWatch.name", "SDE.camping.tasks.keepWatch.description"],
  predict: ["SDE.camping.tasks.predict.name", "SDE.camping.tasks.predict.description"],
};
export const CAMP_LABELS = {
  gear: { torch: "SDE.camping.gear.torch", arrows: "SDE.camping.gear.arrows", bolts: "SDE.camping.gear.bolts", slingStones: "SDE.camping.gear.slingStones", rations: "SDE.camping.gear.rations", repair: "SDE.camping.gear.repair" },
  fuel: { none: "SDE.camping.fuel.none", wood: "SDE.camping.fuel.wood", torches: "SDE.camping.fuel.torches" },
  half: { first: "SDE.camping.first", second: "SDE.camping.second" },
  phase: { setup: "SDE.camping.phases.setup", firewood: "SDE.camping.phases.firewood", fuel: "SDE.camping.phases.fuel", tasks: "SDE.camping.phases.tasks", awaitingRest: "SDE.camping.phases.awaitingRest", complete: "SDE.camping.phases.complete" },
  effect: { pending: "SDE.camping.effects.pending", saved: "SDE.camping.effects.saved", failed: "SDE.camping.effects.failed", afterRest: "SDE.camping.effects.afterRest" },
};
const task = (key, abilities, campfire) => ({ key, abilities, campfire, dc: 12, label: TASK_LABELS[key][0], descriptionKey: TASK_LABELS[key][1] });
export const TASKS = [task("battenDown", ["wis", "con"], true), task("cook", ["int", "wis"], true), task("craft", ["dex"], true), task("entertain", ["cha"], true), task("firewood", ["str", "con"], false), task("hunt", ["str", "dex"], false), task("keepWatch", ["wis"], true), task("predict", ["int", "wis"], false)];
export function taskDefinitions(custom = []) {
  const tasks = TASKS.map(t => ({ ...t, abilities: [...t.abilities] }));
  for (const t of Array.isArray(custom) ? custom : []) {
    if (!t?.key || !Array.isArray(t.abilities)) continue;
    const abilities = t.abilities.map(a => String(a).toLowerCase()).filter(a => ["str", "dex", "con", "int", "wis", "cha"].includes(a));
    if (!abilities.length) continue;
    const base = tasks.find(v => v.key === t.key);
    const definition = { ...base, ...t, abilities, dc: Number.isFinite(t.dc) ? t.dc : 12 };
    if (t.description) delete definition.descriptionKey;
    if (base) tasks[tasks.indexOf(base)] = definition; else tasks.push(definition);
  }
  return tasks;
}
const invalid = () => { throw new Error("SDE.camping.invalid"); };
export function selectTask(camp, uuid, patch) {
  if (camp.phase !== "setup") invalid();
  const index = camp.participants.findIndex(p => p.uuid === uuid); if (index < 0) invalid();
  const p = { ...camp.participants[index], ...patch, uuid, confirmed: true };
  const t = camp.tasks.find(t => t.key === p.task);
  if (p.task && !t) invalid();
  if (t) {
    p.ability ??= t.abilities[0];
    if (!t.abilities.includes(p.ability)) invalid();
    if (p.task === "entertain" && p.recipientUuid && (p.recipientUuid === uuid || !camp.participants.some(v => v.uuid === p.recipientUuid))) invalid();
    if (p.task === "craft" && !["torch", "arrows", "bolts", "slingStones", "repair"].includes(p.craft ?? "torch")) invalid();
    if (p.task === "keepWatch" && !["first", "second"].includes(p.watchHalf ?? "first")) invalid();
  }
  return { ...camp, participants: camp.participants.map((v, i) => i === index ? p : v) };
}
export function lockCamp(camp) {
  if (camp.phase !== "setup") return camp;
  if (camp.participants.some(p => !p.confirmed)) invalid();
  for (const p of camp.participants.filter(p => p.task)) {
    if (p.task === "entertain" && !p.recipientUuid) invalid();
    if (p.task === "craft" && p.craft === "repair" && !p.repairItemId) invalid();
  }
  return { ...camp, phase: "firewood", results: {}, effects: {} };
}
export function torchPlan(stacks, partyUuid, participants) {
  const order = [partyUuid, ...participants.filter(p => p.torchConsent).map(p => p.uuid)];
  const eligible = order.flatMap(uuid => stacks.filter(s => s.actorUuid === uuid && s.quantity > 0));
  const available = eligible.reduce((n, s) => n + s.quantity, 0);
  if (available < 3) return { ok: false, available, deductions: [] };
  let remaining = 3; const deductions = [];
  for (const s of eligible) { const quantity = Math.min(remaining, s.quantity); if (quantity) deductions.push({ actorUuid: s.actorUuid, id: s.id, quantity }); remaining -= quantity; }
  return { ok: true, available, deductions };
}
export function fireDecision(camp, results) {
  if (results.some(r => r.task === "firewood" && r.success)) return "wood";
  return camp.fuel !== "none" || camp.participants.some(p => p.task === "firewood") ? "fuel" : "none";
}
export const fireAlive = (fire, time, near) => !!fire?.lit && near && time < fire.started + 28800;
export function cookGrant(hp, previous, campId, time, eligible) {
  if (!eligible || previous?.campId === campId || (previous?.expires > time && !previous.expired)) return null;
  return { value: hp.value + 2, benefit: { campId, remaining: 2, expires: time + 86400, expired: false } };
}
export function cookHp(hp, benefit, amount) {
  const value = amount >= 0 ? Math.max(0, hp.value - amount) : Math.min(Math.max(hp.max, hp.value), hp.value - amount);
  return { value, benefit: { ...benefit, remaining: Math.min(benefit.remaining, Math.max(0, value - hp.max)) } };
}
export function cookExpiry(hp, benefit, time) {
  if (!benefit || benefit.expired || time < benefit.expires) return null;
  return { value: hp.value - Math.min(benefit.remaining, Math.max(0, hp.value - hp.max)), benefit: { ...benefit, remaining: 0, expired: true } };
}
/** A whole meal or nothing. Own rations are used first, then the party's; short overall means no deductions. */
export function mealPlan(stacks, actorUuid, partyUuid, each) {
  const personal = stacks.filter(s => s.actorUuid === actorUuid && s.quantity > 0);
  const own = personal.reduce((n, s) => n + s.quantity, 0);
  const shortfall = Math.max(0, each - own);
  const eligible = [...personal, ...stacks.filter(s => s.actorUuid === partyUuid && s.quantity > 0)];
  if (eligible.reduce((n, s) => n + s.quantity, 0) < each) return { fed: false, own, shortfall, deductions: [] };
  let remaining = each; const deductions = [];
  for (const s of eligible) {
    const quantity = Math.min(remaining, s.quantity);
    if (quantity) deductions.push({ actorUuid: s.actorUuid, id: s.id, quantity });
    remaining -= quantity;
  }
  return { fed: true, own, shortfall, deductions };
}
export const restEligible = (fed, interrupted, bedDown, conPassed) => !!fed && (!interrupted || !!bedDown || !!conPassed);
