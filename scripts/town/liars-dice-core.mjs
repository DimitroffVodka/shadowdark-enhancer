/**
 * Shadowdark Enhancer — Liar's Dice for two to six seats (pure).
 *
 * Every seat starts with five dice, rolled under a cup the others cannot see. The seats take turns round the table:
 * bid how many dice of one face lie under ALL the cups, or call the last bidder a liar. Ones are wild, so a one counts as
 * any face; nobody bids on ones. A bid beats the last with a higher count, or the same count on a higher face. A call
 * shows every die: when the bid's count or more is there the bid held and the caller loses a die, otherwise the bidder
 * does. The loser of a round opens the next (the seat after, if that was their last die), and the last seat with dice wins.
 *
 * A seat is a person or the house's player (`ai`). Everything here is a plain function of a state object (JSON-safe) and a
 * random source `rng` (0 up to 1, like `CONFIG.Dice.randomUniform`), so the rules and the house's play are pinned by tests.
 * The house's seats decide from what a player at the table could see: their own dice, how many dice are hidden, and the
 * bids. Their choice never reads another seat's dice.
 */
export const DICE = 5;
export const WILD = 1;
/** The faces that can be bid. */
export const FACES = [2, 3, 4, 5, 6];
export const MAX_SEATS = 6;

/** How the house's seats differ: when one calls a bid it doubts, and how often it bids one higher than it believes. */
export const STYLES = [{ call: 0.35, bluff: 0.12 }, { call: 0.45, bluff: 0.05 }, { call: 0.28, bluff: 0.22 }];
/** The house's seat raises to the lowest bid it finds at least this likely. */
const RAISE_AT = 0.5;

export const totalDice = (s) => s.seats.reduce((n, x) => n + x.dice, 0);
export const seatOf = (s, id) => s.seats.find((x) => x.id === id);

/** The seat after `id` round the table that still has dice (`id` itself when it is the only one). */
export function nextSeat(seats, id) {
  const at = seats.findIndex((x) => x.id === id);
  for (let k = 1; k <= seats.length; k++) {
    const seat = seats[(at + k) % seats.length];
    if (seat.dice > 0) return seat.id;
  }
  return id;
}

/** Dice showing `face` or a one, among all the hands given. */
export const countFace = (hands, face) => hands.flat().filter((d) => d === face || d === WILD).length;

/** Whether `qty` of `face` beats `bid` (null opens the round). */
export const isRaise = (bid, qty, face) => !bid || qty > bid.qty || (qty === bid.qty && face > bid.face);

/** Every bid that beats `bid`, lowest first, up to a count of all the dice in play. */
export function raisesFrom(bid, total) {
  const out = [];
  for (let qty = 1; qty <= total; qty++) for (const face of FACES) if (isRaise(bid, qty, face)) out.push({ qty, face });
  return out;
}
export const canBid = (s, qty, face) => Number.isInteger(qty) && FACES.includes(face) && qty >= 1 && qty <= totalDice(s) && isRaise(s.bid, qty, face);
/** The smallest legal bid, or null when the bid on the table is the highest there is. */
export const minRaise = (s) => raisesFrom(s.bid, totalDice(s))[0] ?? null;

/** `n` dice, sorted so the hand reads at a glance. */
export const rollHand = (n, rng) => Array.from({ length: n }, () => 1 + Math.floor(rng() * 6)).sort();

/**
 * A fresh match: five dice each, rolled, `opener` (the first seat unless named) to bid. `defs` are the seats in table
 * order: `{ id, name, ai?, style? }`.
 */
export function newMatch(defs, rng, opener = defs[0].id) {
  const seats = defs.map((d) => ({ id: d.id, name: d.name, ai: !!d.ai, style: d.style ?? 0, dice: DICE, hand: rollHand(DICE, rng) }));
  return { seats, bid: null, turn: opener, round: 1, log: [], winner: null };
}

/**
 * The round is over with `loser` out `dice`, a die down (or `loser` left): the last seat with dice wins, or every seat with
 * dice rolls again and the loser opens (the seat after them when they are out). A seat out of dice keeps no hand.
 */
function conclude(s, loser, dice, rng) {
  const seats = s.seats.map((x) => ({ ...x, dice: dice[x.id] }));
  const left = seats.filter((x) => x.dice > 0);
  if (left.length === 1) return { ...s, seats, winner: left[0].id };
  const opener = dice[loser] > 0 ? loser : nextSeat(seats, loser);
  return { ...s, seats: seats.map((x) => ({ ...x, hand: x.dice > 0 ? rollHand(x.dice, rng) : [] })), bid: null, turn: opener, round: s.round + 1 };
}

/** `who` bids. Returns the new state, or null when it is not their turn, the match is over, or the bid does not beat the last. */
export function placeBid(s, who, qty, face) {
  if (s.winner || s.turn !== who || !canBid(s, qty, face)) return null;
  return { ...s, bid: { qty, face, by: who }, turn: nextSeat(s.seats, who), log: [...s.log, { t: "bid", who, qty, face, round: s.round }] };
}

/** The seat to move calls the bid a lie. Returns the new state, or null when there is no bid of another seat's to call. */
export function callLiar(s, rng) {
  const caller = s.turn;
  if (s.winner || !s.bid || s.bid.by === caller) return null;
  const count = countFace(s.seats.map((x) => x.hand), s.bid.face);
  const held = count >= s.bid.qty;
  const loser = held ? caller : s.bid.by;
  const dice = Object.fromEntries(s.seats.map((x) => [x.id, x.id === loser ? x.dice - 1 : x.dice]));
  const hands = Object.fromEntries(s.seats.map((x) => [x.id, x.hand]));
  const call = { t: "call", round: s.round, caller, bid: s.bid, count, held, loser, hands, dice };
  return conclude({ ...s, log: [...s.log, call] }, loser, dice, rng);
}

/** A seat leaves the match: its dice go, the round is void, and every seat with dice rolls again, the seat after the leaver opening. */
export function forfeitSeat(s, id, rng) {
  const seat = seatOf(s, id);
  if (s.winner || !seat || seat.dice === 0) return null;
  const dice = Object.fromEntries(s.seats.map((x) => [x.id, x.id === id ? 0 : x.dice]));
  return conclude({ ...s, log: [...s.log, { t: "forfeit", seat: id, round: s.round }] }, id, dice, rng);
}

/** The seat `who` makes `move` (`{ call: true }` or `{ qty, face }`). Null when it is not legal. */
export const move = (s, who, mv, rng) => (s.turn !== who ? null : mv.call ? callLiar(s, rng) : placeBid(s, who, mv.qty, mv.face));

const choose = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c; };
/** The chance that `need` or more of `unseen` hidden dice show a face (each does, ones counted, one time in three). */
export function chanceAtLeast(need, unseen) {
  if (need <= 0) return 1;
  if (need > unseen) return 0;
  let sum = 0;
  for (let k = need; k <= unseen; k++) sum += choose(unseen, k) * (1 / 3) ** k * (2 / 3) ** (unseen - k);
  return sum;
}

/**
 * What a seat holding `hand`, facing `unseen` hidden dice and the table's `bid`, does: `{ call: true }` or the bid to make.
 * The house's seats play through this and nothing else, so they can only know what a player at the table knows.
 */
export function decide({ hand, unseen, bid, style = 0 }, rng) {
  const { call: callBelow, bluff } = STYLES[style % STYLES.length];
  const total = hand.length + unseen;
  const own = (face) => countFace([hand], face);
  const chance = (b) => chanceAtLeast(b.qty - own(b.face), unseen);
  const raises = raisesFrom(bid, total);
  if (bid && (!raises.length || chance(bid) < callBelow + (rng() - 0.5) * 0.2)) return { call: true };
  const lift = (b) => (rng() < bluff && b.qty < total ? { ...b, qty: b.qty + 1 } : b);
  if (!bid) {
    // Open on the face held most, for what is held plus the third of the hidden dice that usually matches.
    const face = [...FACES].sort((a, b) => own(b) - own(a) || b - a)[0];
    return lift({ qty: Math.min(total, Math.max(1, own(face) + Math.floor(unseen / 3))), face });
  }
  // Raise as little as it believes, or, when it believes none, on the likeliest bid left.
  const sure = raises.find((b) => chance(b) >= RAISE_AT);
  return lift(sure ?? raises.reduce((best, b) => (chance(b) > chance(best) ? b : best)));
}

/** One move by the house's seat whose turn it is, or null when it is a person's turn (or the match is over). */
export function aiStep(s, rng) {
  const seat = seatOf(s, s.turn);
  if (s.winner || !seat?.ai) return null;
  const d = decide({ hand: seat.hand, unseen: totalDice(s) - seat.dice, bid: s.bid, style: seat.style }, rng);
  return d.call ? callLiar(s, rng) : placeBid(s, seat.id, d.qty, d.face);
}

/** The house's seats take their turns until it is a person's move (or the match is over). */
export function aiRun(s, rng) {
  for (let next = aiStep(s, rng); next; next = aiStep(s, rng)) s = next;
  return s;
}
