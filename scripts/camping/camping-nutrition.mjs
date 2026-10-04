import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { mealPlan, restEligible } from "./camping-core.mjs";
import { statDamageEffect, damagedAbility } from "../stat-damage/stat-damage-core.mjs";
import { StatDamage } from "../stat-damage/stat-damage.mjs";
import { applyCookAfterRest } from "./camping-cook.mjs";
import { isMount, scoresOf, adoptMountScores } from "../actors/mount-scores.mjs";
import { damageMountScores, effectiveMountScores } from "../actors/mount-scores-core.mjs";
const flag = (a, key) => a?.flags?.[MODULE_ID]?.[key];
const actorOf = uuid => game.actors.contents.find(a => a.uuid === uuid);
const ration = i => i.type === "Basic" && /^rations?$/i.test(i.name);
const invalid = () => { throw new Error("SDE.camping.invalid"); };
export const nutritionDay = (actor, day) => structuredClone(flag(actor, "campNutrition")?.days?.[day]);
async function saveDay(actor, day, record, extra = {}) {
  const previous = flag(actor, "campNutrition") ?? {};
  await replaceModuleFlag(actor, "campNutrition", { ...previous, days: { ...previous.days, [day]: record } }, extra);
}
const stacksOf = actors => actors.filter(Boolean).flatMap(a => a.items.filter(ration).map(i => ({ actorUuid: a.uuid, id: i.id, quantity: Math.max(0, Number(i.system.quantity) || 0) })));
export const campEaters = camp => [...camp.participants, ...(camp.mounts ?? [])];
const needs = (actor, each) => isMount(actor) && flag(actor, "mount")?.properties?.grazing ? 1 : each;
export function foodPreview(party, camp, each = camp.each ?? 1, day = camp.day) {
  // Allocate shared food in the frozen participant order, not separately to every preview row.
  const stacks = stacksOf([party, ...campEaters(camp).map(p => actorOf(p.uuid))]);
  return campEaters(camp).map(p => {
    const actor = actorOf(p.uuid), saved = nutritionDay(actor, day);
    const plan = saved?.foodDone ? { fed: saved.fed, own: 0, shortfall: 0, deductions: [] } : mealPlan(stacks, p.uuid, party.uuid, needs(actor, each));
    for (const d of plan.deductions) stacks.find(s => s.id === d.id && s.actorUuid === d.actorUuid).quantity -= d.quantity;
    return { actorId: p.actorId, ...plan, saved: !!saved?.foodDone, con: isMount(actor) ? effectiveMountScores(scoresOf(actor)).con : Number(actor?.system.abilities.con.value ?? 0), rest: saved?.rest?.done ? saved.rest.eligible : null };
  });
}
// Shared across parties: an Actor/day is authoritative even when two camps share a PC.
let nutritionQueue = Promise.resolve();
const serial = fn => (nutritionQueue = nutritionQueue.then(fn, fn));
export function feedCamp(party, camp) {
  return serial(async () => {
    for (const p of campEaters(camp)) {
      const actor = actorOf(p.uuid); if (!actor || (actor.type !== "Player" && !isMount(actor))) invalid();
      if (isMount(actor)) await adoptMountScores(actor);
      let record = nutritionDay(actor, camp.day);
      if (record?.foodDone) continue;
      if (!record) {
        const plan = mealPlan(stacksOf([actor, party]), actor.uuid, party.uuid, needs(actor, camp.each));
        record = { partyUuid: party.uuid, campId: camp.id, fed: plan.fed, deductions: plan.deductions, foodDone: false, starvationId: plan.fed ? null : foundry.utils.randomID() };
        await saveDay(actor, camp.day, record);
      }
      const mealKey = `${camp.day}_${actor.id}`;
      for (const d of record.deductions) {
        const item = actorOf(d.actorUuid)?.items.get(d.id);
        if (!item || (!flag(item, "campMeals")?.[mealKey] && item.system.quantity < d.quantity)) invalid();
      }
      for (const d of record.deductions) {
        const item = actorOf(d.actorUuid)?.items.get(d.id), receipts = flag(item, "campMeals") ?? {};
        if (!receipts[mealKey]) await replaceModuleFlag(item, "campMeals", { ...receipts, [mealKey]: true }, { "system.quantity": item.system.quantity - d.quantity });
      }
      if (!record.fed && isMount(actor)) {
        // Damage and this day's receipt land in ONE actor write; no effect or replay gap.
        if (!record.starvationDone) {
          record.starvationDone = true;
          await replaceModuleFlag(actor, "mountScores", damageMountScores(scoresOf(actor), "con", 1), {
            [`flags.${MODULE_ID}.campNutrition`]: _replace({ ...flag(actor, "campNutrition"), days: { ...flag(actor, "campNutrition")?.days, [camp.day]: record } }),
          });
        }
        await StatDamage.checkMountCon(actor);
      } else if (!record.fed) {
        if (!actor.effects.has(record.starvationId)) {
          const data = statDamageEffect("con", 1, game.i18n.localize("SDE.camping.starvation"));
          data._id = record.starvationId;
          data.flags[MODULE_ID].campStarvation = { day: camp.day };
          await actor.createEmbeddedDocuments("ActiveEffect", [data], { keepId: true });
        }
        await StatDamage._checkCon(actor.effects.get(record.starvationId));
      }
      record.foodDone = true; await saveDay(actor, camp.day, record);
    }
  });
}
/** Native normal rest: only rest-owned resources. Every effect records progress with its affected write. */
export function restCamp(party, camp, interrupted) {
  return serial(async () => {
    const cook = Object.values(camp.results).some(r => r.task === "cook" && r.success);
    for (const p of camp.participants) {
      const actor = actorOf(p.uuid), record = nutritionDay(actor, camp.day); if (!actor || !record?.foodDone) invalid();
      if (!record.rest) {
        const bed = camp.results[p.actorId]?.task === "battenDown" && camp.results[p.actorId].success;
        let passed = !interrupted || bed;
        if (record.fed && interrupted && !bed) {
          camp.interruptionChecks ??= {};
          if (!Object.hasOwn(camp.interruptionChecks, p.actorId)) {
            const roll = await new Roll("1d20 + @mod", { mod: actor.system.abilities.con.mod }).evaluate();
            camp.interruptionChecks[p.actorId] = { total: roll.total, passed: roll.total >= 12 };
            await replaceModuleFlag(party, "camping", camp);
            try { await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: game.i18n.localize("SDE.camping.interruptedCheck") }); } catch (error) { console.warn(`${MODULE_ID} | Camp CON report`, error); }
          }
          passed = camp.interruptionChecks[p.actorId].passed;
        }
        const eligible = restEligible(record.fed, interrupted, bed, passed) && !actor.statuses.has("dead");
        record.rest = { eligible, done: false, hpDone: false, effects: eligible ? actor.effects.filter(e => damagedAbility(e)).map(e => e.id) : [], resources: eligible ? actor.items.filter(i => ["Spell", "Class Ability", "Wand"].includes(i.type)).map(i => i.id) : [] };
        await saveDay(actor, camp.day, record);
      }
      if (record.rest.done) continue;
      if (record.rest.eligible) {
        if (!record.rest.hpDone) {
          record.rest.hpDone = true;
          await saveDay(actor, camp.day, record, { "system.attributes.hp.value": Math.max(actor.system.attributes.hp.value, actor.system.attributes.hp.max) });
        }
        for (const id of record.rest.effects) if (actor.effects.has(id)) await actor.effects.get(id).delete();
        for (const id of record.rest.resources) {
          const item = actor.items.get(id); if (!item || flag(item, "campRestDay") === camp.day) continue;
          const extra = {};
          if (["Spell", "Class Ability"].includes(item.type) && item.system.lost) extra["system.lost"] = false;
          if (item.type === "Class Ability" && item.system.limitedUses) extra["system.uses.available"] = item.system.uses.max;
          if (item.type === "Wand" && Array.isArray(item.system.spells)) extra["system.spells"] = item.system.spells.map(s => ({ ...s.toObject?.() ?? s, lost: false }));
          await replaceModuleFlag(item, "campRestDay", camp.day, extra);
        }
        if (cook) await applyCookAfterRest(actor, camp.id, true);
      }
      record.rest.done = true; await saveDay(actor, camp.day, record);
    }
  });
}
