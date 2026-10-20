/**
 * Shadowdark Enhancer — a Liar's Dice table: who sits where, and what each person may see (pure).
 *
 * One person HOSTS a table. Their client holds the whole `table` (every seat's dice) and runs the match; every other person
 * gets only `viewFor(table, theirId)`: the public state plus their own dice. A table is opened with a number of seats for
 * the house's players (`aiCount`) and a number for other people (`humanSlots`); a seat for a person that nobody takes is
 * played by the house when the host starts. Seats are 2 to 6 in all.
 *
 *   lobby      people join (until the host starts or cancels)
 *   playing    the match is on (liars-dice-core.mjs)
 *   over       one seat has dice left: `result` names it
 *   cancelled  the host left, or called it off: every person's wager goes back
 *
 * Every function takes a table and returns a new one (or `{ table }` / `{ error }`), never changing the one it was given.
 * Money is not here: a person's wager is taken and paid by their own client (town-liars-dice.mjs).
 */
import { MAX_SEATS, STYLES, aiStep, forfeitSeat, move, newMatch } from "./liars-dice-core.mjs";

/** The house's player names are looked up by key, so a table is told them already localized (`aiNames`). */
export const AI_NAME_KEYS = [
  "SDE.town.games.liars.ai.brannoch", "SDE.town.games.liars.ai.mags", "SDE.town.games.liars.ai.quill",
  "SDE.town.games.liars.ai.tolliver", "SDE.town.games.liars.ai.sedge",
];

export const seatTotal = (t) => 1 + t.aiCount + t.humanSlots;
/** Seats for people that nobody has taken yet. */
export const freeSlots = (t) => t.humanSlots - (t.players.length - 1);
/** The user ids of the people at the table, host first. */
export const peopleIn = (t) => t.players.map((p) => p.userId);

/**
 * A new table in its lobby, or null when the seats are not two to six. `host` is `{ userId, charId, name }`; `ante` is the
 * wager each person puts in, in copper; `town` is `{ name, sceneId, edge }` as the host's landing page has it.
 */
export function openTable({ id, host, ante, aiCount, humanSlots, town }) {
  const whole = (n) => Number.isInteger(n) && n >= 0;
  if (!whole(aiCount) || !whole(humanSlots) || 1 + aiCount + humanSlots < 2 || 1 + aiCount + humanSlots > MAX_SEATS) return null;
  return { id, hostId: host.userId, ante, town, aiCount, humanSlots, phase: "lobby", players: [{ userId: host.userId, charId: host.charId, name: host.name }], game: null, result: null };
}

/** A person takes a seat. `{ table }`, or `{ error }`: "closed" (not in its lobby), "already" (they are in it) or "full". */
export function join(t, user) {
  if (t.phase !== "lobby") return { error: "closed" };
  if (t.players.some((p) => p.userId === user.userId)) return { error: "already" };
  if (freeSlots(t) <= 0) return { error: "full" };
  return { table: { ...t, players: [...t.players, { userId: user.userId, charId: user.charId, name: user.name }] } };
}

/** A person (not the host) leaves the lobby. */
export const leaveLobby = (t, userId) => (t.phase === "lobby" && userId !== t.hostId ? { ...t, players: t.players.filter((p) => p.userId !== userId) } : t);

/** `items` in a random order. */
function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The match is over when the game has a winner: the table is `over` and says who won. */
function settled(t, game) {
  if (!game.winner) return { ...t, game };
  return { ...t, game, phase: "over", result: { winner: game.winner, name: game.seats.find((x) => x.id === game.winner).name, ai: game.seats.find((x) => x.id === game.winner).ai, total: seatTotal(t), pot: t.ante * seatTotal(t) } };
}

/**
 * The host starts the match: the people who joined and the house's players (the ones asked for, and one for every seat a
 * person did not take) sit in a random order, and the first seat opens. `aiNames` has at least as many names as the house
 * has seats, already localized.
 */
export function start(t, rng, aiNames) {
  if (t.phase !== "lobby") return t;
  const houseSeats = t.aiCount + Math.max(0, freeSlots(t));
  const people = t.players.map((p) => ({ id: p.userId, name: p.name }));
  const house = Array.from({ length: houseSeats }, (_, i) => ({ id: `ai${i + 1}`, name: aiNames[i], ai: true, style: i % STYLES.length }));
  const seats = shuffled([...people, ...house], rng);
  return settled({ ...t, phase: "playing" }, newMatch(seats, rng));
}

/** A person moves (`{ call: true }` or `{ qty, face }`). `{ table }`, or `{ error }`: "notPlaying", "seat", "turn" or "illegal". */
export function applyMove(t, userId, mv, rng) {
  if (t.phase !== "playing") return { error: "notPlaying" };
  if (!t.game.seats.some((x) => x.id === userId && !x.ai)) return { error: "seat" };
  if (t.game.turn !== userId) return { error: "turn" };
  const next = move(t.game, userId, mv, rng);
  return next ? { table: settled(t, next) } : { error: "illegal" };
}

/** The house's seat whose turn it is moves once. `acted` is false when it is a person's turn or the match is not on. */
export function stepAI(t, rng) {
  const next = t.phase === "playing" ? aiStep(t.game, rng) : null;
  return next ? { table: settled(t, next), acted: true } : { table: t, acted: false };
}

/** Whether the next move is the house's. */
export const aiToMove = (t) => t.phase === "playing" && !!t.game.seats.find((x) => x.id === t.game.turn)?.ai;

/** A person leaves a match in play (their seat's dice go). In the lobby they just leave it. */
export function forfeit(t, userId, rng) {
  if (t.phase === "lobby") return leaveLobby(t, userId);
  if (t.phase !== "playing") return t;
  const next = forfeitSeat(t.game, userId, rng);
  return next ? settled(t, next) : t;
}

/** The table is called off: the host left (or cancelled it), and every person's wager goes back. */
export const cancel = (t) => (t.phase === "lobby" || t.phase === "playing" ? { ...t, phase: "cancelled" } : t);

/** What a table shows to the open-tables list: enough to decide to sit down. */
export const summary = (t) => ({ id: t.id, hostName: t.players[0].name, ante: t.ante, town: { name: t.town.name, sceneId: t.town.sceneId }, free: freeSlots(t), total: seatTotal(t) });

/**
 * What `userId` may see. The public state, and their own dice; never another seat's. A round's dice are shown to everyone
 * only by the call that ends it (it is in `log`).
 */
export function viewFor(t, userId) {
  const base = { id: t.id, hostId: t.hostId, phase: t.phase, ante: t.ante, town: t.town, total: seatTotal(t), pot: t.ante * seatTotal(t), me: userId, isHost: userId === t.hostId };
  if (t.phase === "lobby") {
    const people = t.players.map((p) => ({ kind: "human", id: p.userId, name: p.name, host: p.userId === t.hostId, you: p.userId === userId }));
    return { ...base, free: freeSlots(t), slots: [...people, ...Array.from({ length: Math.max(0, freeSlots(t)) }, () => ({ kind: "open" })), ...Array.from({ length: t.aiCount }, () => ({ kind: "ai" }))] };
  }
  const g = t.game;
  if (!g) return base;
  const mine = g.seats.find((x) => x.id === userId);
  return {
    ...base, round: g.round, bid: g.bid, turn: g.winner ? null : g.turn, winner: g.winner, result: t.result, log: g.log,
    seats: g.seats.map((x) => ({ id: x.id, name: x.name, ai: x.ai, dice: x.dice, out: x.dice === 0, you: x.id === userId })),
    hand: mine && !mine.ai && mine.dice > 0 ? mine.hand : null,
  };
}
