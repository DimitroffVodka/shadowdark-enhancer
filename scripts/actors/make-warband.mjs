/**
 * Shadowdark Enhancer — Make a warband (#202, PGWR p.248).
 *
 * A GM header button on a level 1–5 NPC's sheet turns a copy of it into a
 * warband unit: double its level, HP 8 per level plus CON, one attack a
 * round, the attack bonus up by the levels gained, damage dice tripled, its
 * talents kept. A preview shows before and after; the original is untouched.
 * The rules are warband-core.mjs.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { canMakeWarband, warbandStats, warbandAttack } from "./warband-core.mjs";

const ATTACK_TYPES = ["NPC Attack", "NPC Special Attack"];

const levelOf = (actor) => Number(actor?.system?.level?.value ?? 0);

/** The warband a creature becomes, as creation data, plus its before/after rows for the preview. */
function planWarband(source, type) {
  const data = source.toObject();
  const level = levelOf(source);
  const stats = warbandStats({ level, conMod: data.system.abilities?.con?.mod ?? 0 });
  const rows = [
    { label: game.i18n.localize("SDE.warband.make.level"), before: level, after: stats.level },
    { label: game.i18n.localize("SDE.warband.make.hp"), before: data.system.attributes?.hp?.max ?? 0, after: stats.hp },
  ];
  data.items = data.items.map((item) => {
    if (!ATTACK_TYPES.includes(item.type)) return item;
    const hasDamage = item.type === "NPC Attack";
    const before = { attackBonus: item.system.bonuses?.attackBonus ?? 0, damage: hasDamage ? item.system.damage?.value ?? "" : null };
    const after = warbandAttack(before, stats.gained);
    const show = (a, num) => game.i18n.format(hasDamage ? "SDE.warband.make.attackLine" : "SDE.warband.make.specialLine", {
      num, bonus: `${a.attackBonus >= 0 ? "+" : ""}${a.attackBonus}`, damage: a.damage ?? "",
    });
    rows.push({ label: item.name, before: show(before, item.system.attack?.num ?? 1), after: show(after, after.num) });
    const system = foundry.utils.deepClone(item.system);
    system.attack = { ...system.attack, num: after.num };
    system.bonuses = { ...system.bonuses, attackBonus: after.attackBonus };
    if (hasDamage) system.damage = { ...system.damage, value: after.damage };
    return { ...item, system };
  });
  delete data._id;
  delete data.flags?.[MODULE_ID]?.quickAdjustBackup;   // the creature's own stats, not the warband's
  data.type = type;
  data.name = game.i18n.format("SDE.warband.make.name", { name: source.name });
  // Its tokens carry its name, unless the creature's had a name of its own.
  if (!data.prototypeToken?.name || data.prototypeToken.name === source.name) data.prototypeToken.name = data.name;
  data.system.level.value = stats.level;
  data.system.attributes.hp.max = stats.hp;
  data.system.attributes.hp.value = stats.hp;
  data.folder = source.pack ? null : (source.folder?.id ?? null);
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], warband: { commander: null, upgrades: [] } };
  return { data, rows };
}

/** Preview, then create the warband from a copy of `source` (GM). */
export async function makeWarband(source, type) {
  if (!game.user.isGM || source?.type !== "NPC") return null;
  if (!canMakeWarband(levelOf(source))) {
    ui.notifications?.warn(game.i18n.format("SDE.warband.notify.makeLevel", { name: source.name }));
    return null;
  }
  const { data, rows } = planWarband(source, type);
  const table = rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.before)}</td><td>${esc(r.after)}</td></tr>`).join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "SDE.warband.make.title" },
    content: `<p>${esc(game.i18n.format("SDE.warband.make.question", { name: source.name, warband: data.name }))}</p>
      <table class="sde-warband-preview"><thead><tr><th></th><th>${esc(game.i18n.localize("SDE.warband.make.before"))}</th><th>${esc(game.i18n.localize("SDE.warband.make.after"))}</th></tr></thead><tbody>${table}</tbody></table>
      <p class="hint">${esc(game.i18n.localize("SDE.warband.make.hint"))}</p>`,
    rejectClose: false,
  });
  if (!ok) return null;
  const actor = await Actor.implementation.create(data);
  if (!actor) return null;
  // The printed stat block in the notes, rebuilt for the warband's numbers, as Quick Adjust does.
  try {
    const { actorToDraft } = await import("../monster-creator/encounter-creator.mjs");
    const { buildNpcNotes } = await import("../monster-creator/npc-statblock.mjs");
    const draft = await actorToDraft(actor);
    // One attack a round, whichever it chooses; and the creature's AC note, which the draft doesn't read back.
    for (const a of draft.actions ?? []) a.join = "or";
    draft.acNote ||= /<strong>AC<\/strong>\s*\d+\s*\(([^)]*)\)/.exec(source.system.notes ?? "")?.[1] ?? "";
    await actor.update({ "system.notes": buildNpcNotes(draft) });
  } catch (err) {
    console.warn(`${MODULE_ID} | make a warband: the stat block wasn't rebuilt`, err);
  }
  ui.notifications?.info(game.i18n.format("SDE.warband.notify.made", { name: actor.name }));
  actor.sheet?.render(true);
  return actor;
}

/** The GM's "Make a warband" header button on a level 1–5 NPC's sheet (not a warband's or a mount's). */
export function registerMakeWarband(type) {
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet.actor;
    if (!game.user.isGM || actor?.type !== "NPC" || !canMakeWarband(levelOf(actor))) return;
    if (buttons.some((b) => b.class === "sde-make-warband")) return;
    buttons.unshift({
      class: "sde-make-warband",
      icon: "fas fa-people-group",
      label: "SDE.warband.make.button",
      // The level is checked again on the click: the header is built once, on first render.
      onclick: () => makeWarband(actor, type),
    });
  });
}
