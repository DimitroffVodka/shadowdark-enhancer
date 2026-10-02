/**
 * Shadowdark Enhancer — Bastions: writing a bastion, and paying into it.
 *
 * What the sheet and the panel both do to a bastion actor: write a rules state
 * back as one update, and move gold between a character's purse and the
 * treasury. The GM's alone.
 */

import { esc } from "../shared/esc.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf, updateOf } from "./bastion-core.mjs";
import { fundingActors, planDeposit, planWithdraw, purseUpdate, purseOf } from "./bastion-funding.mjs";
import { bastionArt } from "./bastion-art.mjs";
import { t, format, WHY, logText } from "./bastion-text.mjs";

const samePurse = (a, b) => a.gp === b.gp && a.sp === b.sp && a.cp === b.cp;

/** Write a state back, and say so when Foundry vetoed it after the fact. */
export async function writeState(actor, next) {
  if (!game.user.isGM) return false;
  const update = updateOf(next), was = actor.system.type;
  // A bastion still wearing its old type's art takes the new type's.
  if (next.type !== was) {
    if (actor.img === bastionArt(was)) update.img = bastionArt(next.type);
    if (actor.prototypeToken.texture.src === bastionArt(was)) update["prototypeToken.texture.src"] = bastionArt(next.type);
  }
  const saved = await actor.update(update);
  if (!saved) ui.notifications?.warn(t("SDE.bastion.notify.notSaved"));
  return !!saved;
}

/** Ask who and how much, then move that gold between a character's purse and the treasury. */
export async function fundBastion(actor, direction) {
  if (!game.user.isGM) return false;
  const link = actor.system.party;
  const party = link ? await fromUuid(link).catch(() => null) : null;
  const people = fundingActors({
    party,
    resolve: (id) => game.actors.get(id) ?? fromUuidSync(id, { strict: false }),
    players: game.actors.filter((a) => a.type === "Player"),
  });
  if (!people.length) {
    ui.notifications?.warn(t("SDE.bastion.fund.nobody"));
    return false;
  }
  const pick = await promptFunding(direction, people);
  const person = pick && people.find((a) => a.uuid === pick.who);
  const gp = Number(pick?.gp);   // not rounded: a part of a coin is refused by the plan, not quietly paid as less
  if (!person) return false;
  return direction === "deposit" ? deposit(actor, person, gp) : withdraw(actor, person, gp);
}

function promptFunding(direction, people) {
  const options = people.map((a) => `<option value="${esc(a.uuid)}">${esc(a.name)} (${esc(format("SDE.bastion.fund.purse", { gp: a.system.coins.gp ?? 0 }))})</option>`).join("");
  const paying = direction === "deposit";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: paying ? "SDE.bastion.fund.depositTitle" : "SDE.bastion.fund.withdrawTitle" },
    content: `<div class="form-group"><label>${esc(t("SDE.bastion.fund.who"))}</label><div class="form-fields"><select name="who">${options}</select></div></div>
      <div class="form-group"><label>${esc(t("SDE.bastion.fund.amount"))}</label><div class="form-fields"><input type="number" name="gp" min="1" step="1" value="10" autofocus></div></div>`,
    ok: {
      label: paying ? "SDE.bastion.fund.deposit" : "SDE.bastion.fund.withdraw",
      callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
    },
    rejectClose: false,
  });
}

/**
 * A character pays in: their purse first, then the treasury. Each write is read back, and if the
 * treasury refuses the purse is put back as it was.
 */
async function deposit(actor, person, gp) {
  const before = stateOf(actor), was = purseOf(person), plan = planDeposit(was, gp);
  if (!plan.ok) {
    ui.notifications?.warn(plan.error === "broke" ? format("SDE.bastion.fund.noPurse", { name: person.name, gp }) : t(WHY[plan.error]));
    return false;
  }
  const { state: next, error } = core.deposit(before, gp, person.name);
  if (error) { ui.notifications?.warn(t(WHY[error] ?? WHY.unknown)); return false; }
  const paid = await person.update(purseUpdate(plan.coins));
  if (!paid || !samePurse(purseOf(person), plan.coins)) { ui.notifications?.warn(t("SDE.bastion.notify.notSaved")); return false; }
  if (await writeState(actor, next)) {
    ui.notifications?.info(logText(next.log.at(-1)));
    return true;
  }
  await person.update(purseUpdate(was));
  ui.notifications?.warn(t("SDE.bastion.fund.undone"));
  return false;
}

/** The treasury pays out: it first, then the character's purse; if the purse refuses, the treasury is put back. */
async function withdraw(actor, person, gp) {
  const before = stateOf(actor), was = purseOf(person), plan = planWithdraw(was, gp);
  if (!plan.ok) { ui.notifications?.warn(t(WHY[plan.error])); return false; }
  const { state: next, error } = core.withdraw(before, gp, person.name);
  if (error) { ui.notifications?.warn(t(WHY[error] ?? WHY.unknown)); return false; }
  if (!(await writeState(actor, next))) return false;
  const paid = await person.update(purseUpdate(plan.coins));
  if (paid && samePurse(purseOf(person), plan.coins)) {
    ui.notifications?.info(logText(next.log.at(-1)));
    return true;
  }
  await writeState(actor, before);
  ui.notifications?.warn(t("SDE.bastion.fund.undone"));
  return false;
}
