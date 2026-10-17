/**
 * Shadowdark Enhancer — what a round of the death roll looks like (pure): the lines of the chat card and the numbers the
 * window draws. `loc` is the translator the caller passes in (the real one or a test's).
 */
import { formatPrice, fromCopper } from "../shared/coins.mjs";
import { GAME_ICONS, GAME_KEYS, RESULT_KEYS } from "./games-core.mjs";
import { legalDeath, loseChance, takeCost } from "./death-core.mjs";
import { settleHand } from "./hand-core.mjs";

const L = {
  roll: "SDE.town.death.line.roll", double: "SDE.town.death.line.double", take: "SDE.town.death.line.take", pass: "SDE.town.death.line.pass",
  walk: "SDE.town.hand.line.walk",
};
const money = (copper) => formatPrice(fromCopper(copper));
const percent = (chance) => Math.round(chance * 100);

/** The round as one run of sentences (every roll, double, take and pass in order), then the walk-away if there was one. */
export function deathLines(round, names, loc) {
  const said = round.log.map((e) => (e.t === "roll" ? loc(L.roll, { who: names[e.by], n: e.n, max: e.max }) : loc(L[e.t], { who: names[e.by] })));
  return [said.join(" "), ...(round.result.by === "walk" ? [loc(L.walk, { who: names.you })] : [])].filter(Boolean);
}

/**
 * The window's model of a table `{ round, settled }`: the stake, who holds the right to double, the rolls so far, the die
 * coming and how likely whoever rolls it is to lose, the controls the player has, and how a finished round came out.
 * `ctx` is `{ name, purse (copper), edge (%), loc }`.
 */
export function deathView(table, { name, purse, edge = 0, loc }) {
  const { round } = table, over = !!round.result;
  const names = { you: name, house: loc("SDE.town.hand.house") };
  const move = legalDeath(round, "you");
  const chance = percent(loseChance(round.max));
  const rollerName = names[round.turn];
  const canPay = takeCost(round) <= purse;
  const controls = {
    roll: move.kind === "roll" ? { label: loc("SDE.town.death.btn.roll", { max: round.max }) } : null,
    skip: move.kind === "pre" ? { label: loc("SDE.town.death.btn.skip", { max: round.max }) } : null,
    double: (move.kind === "roll" || move.kind === "pre") && move.double ? { label: loc("SDE.town.death.btn.double", { stake: money(takeCost(round) * 2), cost: money(takeCost(round)) }), disabled: !canPay } : null,
    take: move.kind === "respond" ? { label: loc("SDE.town.death.btn.take", { cost: money(takeCost(round)) }), disabled: !canPay } : null,
    pass: move.kind === "respond" ? { label: loc("SDE.town.death.btn.pass", { lose: money(round.put.you) }) } : null,
    collect: over && !table.settled,
    over: over && table.settled,
  };
  const prompt = over ? loc("SDE.town.death.prompt.over")
    : move.kind === "respond" ? loc("SDE.town.death.prompt.respond", { stake: money(takeCost(round) * 2), cost: money(takeCost(round)), lose: money(round.put.you) })
      : move.kind === "pre" ? loc("SDE.town.death.prompt.pre", { who: rollerName, max: round.max, chance })
        : loc("SDE.town.death.prompt.roll", { max: round.max, chance });
  let result = null;
  if (over) {
    const { net, result: kind } = settleHand({ put: round.put, result: round.result }, edge);
    result = { tone: kind === "win" ? "good" : kind === "lose" ? "bad" : "info", lines: [...deathLines(round, names, loc), loc(RESULT_KEYS[kind], { who: name, price: money(Math.abs(net)) })] };
  }
  return {
    game: "death", icon: GAME_ICONS.death, name: loc(GAME_KEYS.death.name), over,
    stake: money(round.put.you), put: money(round.put.you), mult: round.mult,
    cube: round.cube === null ? loc("SDE.town.death.cubeMiddle") : names[round.cube],
    die: round.max, chance, rollerName,
    rolls: round.log.filter((e) => e.t === "roll").map((e) => ({ who: names[e.by], n: e.n, max: e.max, mine: e.by === "you", one: e.n === 1 })),
    prompt, controls, result,
  };
}
