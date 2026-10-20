/**
 * Shadowdark Enhancer — one person's side of a Liar's Dice table: hosting one, sitting at another's, and the list of open
 * tables (no Foundry in here: the sockets, the clock, the dice and the money are handed in, so a test can seat several
 * people at one table in memory).
 *
 * THE HOST'S CLIENT RUNS THE TABLE. It holds every seat's dice (liars-dice-table.mjs), checks every move against who sent
 * it (the socket names the real sender; nothing a message says about who it is from is believed), plays the house's
 * seats with a pause between moves so the people can follow, and sends each person only their own view of the table. The
 * other people send it their moves and leave messages and hear back a view each time something changes, so a view that
 * is lost is mended by the next. Each person's client moves only their own character's coins.
 *
 * LEAVING. A person who leaves a match forfeits their wager and their dice go; one who leaves the lobby gets the wager
 * back. The host leaving a lobby calls the table off and every wager goes back. The host leaving a match in play (or
 * dropping off the world) ends it for the others, whose wagers go back, while the host's own is lost like anyone's who walks
 * away. (A person dropping off is told by Foundry's presence: `userGone`.)
 *
 * One person is at one table at a time. Solo against the house is the same table with no seat for anyone else, so it never
 * sends a message.
 */
import { aiToMove, applyMove, cancel, forfeit, join, openTable, peopleIn, start, stepAI, summary, viewFor } from "./liars-dice-table.mjs";

/** The pause between the house's moves, so a person can follow what each did. */
export const AI_DELAY_MS = 900;

const text = (v, n) => String(v ?? "").slice(0, n);
const whole = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

export class LiarsClient {
  /**
   * @param {object} deps
   * @param {string} deps.userId  this client's user
   * @param {(msg: object, to: string|null) => void} deps.send  one message to a user, or (null) to everyone else
   * @param {(ms: number) => Promise<void>} deps.delay
   * @param {() => number} deps.rng  0 up to 1
   * @param {string[]|(() => string[])} deps.aiNames  the house's players' names, already localized
   * @param {{take: Function, refund: Function, settle: Function}} deps.money  see town-liars-dice.mjs, bound to this client's io
   * @param {() => string} deps.newId
   */
  constructor({ userId, send, delay, rng, aiNames, money, newId }) {
    Object.assign(this, { userId, send, delay, rng, aiNames, money, newId });
    /** Open tables of other people, by id: `{ id, hostId, hostName, ante, town, free, total }`. */
    this.tables = new Map();
    /** The table this client hosts (every seat's dice), or null. */
    this.hosted = null;
    /** This person's place at a table, hosted or not: `{ tableId, hostId, ante, player, view, settled }`, or null. */
    this.part = null;
    this.onChange = null;
    this.onTable = null;
    this.onError = null;
    this.tasks = new Set();
    /** The payouts and refunds so far, one after another, so a leaving person can wait for theirs. */
    this.settling = Promise.resolve();
    this.looping = false;
    this.opening = false;
    /** Whether this client has told the others about its table (so it only says "closed" about one it announced). */
    this.listed = false;
  }

  /** This person's latest view of their table, or null. */
  get view() { return this.part?.view ?? null; }

  notify() { this.onChange?.(); }

  /** Run `promise` and let `idle()` wait for it. */
  track(promise) {
    this.tasks.add(promise);
    promise.finally(() => this.tasks.delete(promise)).catch(() => {});
    return promise;
  }

  /** Resolves when nothing this client started is still running (the house's moves, a payout). */
  async idle() {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
  }

  // ─── what the window asks for ──────────────────────────────────────────────

  /** Ask everyone for their open tables. */
  requestTables() { this.send({ op: "who" }, null); }

  /**
   * Open a table: put this person's wager in, and either start at once (no seat for anyone else) or wait in the lobby.
   * `town` is `{ on, maxBet, name, sceneId, edge }`.
   */
  async open({ player, ante, aiCount, humanSlots, town }) {
    if (this.part || this.opening) return { ok: false, error: "busy" };
    this.opening = true;
    try {
      const table = openTable({ id: this.newId(), host: { userId: this.userId, charId: player.id, name: player.name }, ante, aiCount, humanSlots, town: { name: town.name, sceneId: town.sceneId, edge: town.edge } });
      if (!table) return { ok: false, error: "seats" };
      const paid = await this.money.take(player, ante, town);
      if (!paid.ok) return paid;
      this.hosted = table;
      this.part = { tableId: table.id, hostId: this.userId, ante, player, view: null, settled: false };
      if (humanSlots === 0) this.begin();
      else { this.announce(); this.broadcast(); }
      return { ok: true };
    } finally { this.opening = false; }
  }

  /** Sit down at someone else's open table: put this person's wager in and ask the host for the seat. */
  async join(tableId, player) {
    if (this.part || this.opening) return { ok: false, error: "busy" };
    const t = this.tables.get(tableId);
    if (!t) return { ok: false, error: "gone" };
    this.opening = true;
    try {
      const paid = await this.money.take(player, t.ante, null);
      if (!paid.ok) return paid;
      this.part = { tableId, hostId: t.hostId, ante: t.ante, player, view: null, settled: false };
      this.send({ op: "join", tableId, charId: player.id, name: player.name }, t.hostId);
      this.notify();
      return { ok: true };
    } finally { this.opening = false; }
  }

  /** The host starts the match (seats nobody took go to the house). */
  startTable() {
    if (this.hosted?.phase === "lobby") this.begin();
  }

  /** This person's move: `{ call: true }` or `{ qty, face }`. */
  move(mv) {
    const p = this.part;
    if (!p || p.view?.phase !== "playing") return false;
    if (this.hosted) {
      const r = applyMove(this.hosted, this.userId, mv, this.rng);
      if (r.error) return false;
      this.hosted = r.table;
      this.broadcast();
      this.kick();
      return true;
    }
    this.send({ op: "move", tableId: p.tableId, move: mv }, p.hostId);
    return true;
  }

  /**
   * Leave the table (or let go of a finished one). The host calling a table off gives every person their wager back; a
   * person leaving the lobby takes theirs back; a person leaving a match forfeits it and gets a losing card.
   */
  async leave() {
    const p = this.part;
    if (!p) return;
    if (this.hosted) {
      const h = this.hosted;
      if (h.phase === "lobby" || h.phase === "playing") {
        // Calling off a lobby gives every wager back. Leaving a match in play ends it for the others (their wagers go back) but
        // the host walked away from theirs: it is lost, with a losing card, like any person's who leaves a match.
        const walked = h.phase === "playing" && !p.settled;
        if (walked) p.settled = true;
        this.hosted = cancel(h);
        if (h.phase === "lobby") this.close(h.id);
        this.broadcast();
        this.hosted = null;
        await Promise.all([this.settling, walked ? this.money.settle({ player: p.player, view: p.view, forfeit: true }) : null]);
      }
    } else if (!p.settled) {
      const phase = p.view?.phase;
      p.settled = true;
      this.send({ op: "leave", tableId: p.tableId }, p.hostId);
      if (phase === "playing") await this.money.settle({ player: p.player, view: p.view, forfeit: true });
      else if (phase !== "over" && phase !== "cancelled") await this.money.refund(p.player, p.ante);
    }
    this.part = null;
    this.hosted = null;
    this.notify();
  }

  // ─── the host's table ──────────────────────────────────────────────────────

  /** Start the match and run the house's seats until it is a person's move. */
  begin() {
    const names = typeof this.aiNames === "function" ? this.aiNames() : this.aiNames;
    this.hosted = start(this.hosted, this.rng, names);
    this.close(this.hosted.id);
    this.broadcast();
    this.kick();
  }

  /** Tell everyone about the lobby's free seats (or that there are none). */
  announce() {
    const t = this.hosted;
    if (t?.phase !== "lobby") return;
    if (summary(t).free > 0) { this.listed = true; this.send({ op: "open", table: summary(t) }, null); }
    else this.close(t.id);
  }

  /** Take the table off everyone's list, if it was ever on it (a table played alone never sends a message). */
  close(tableId) {
    if (!this.listed) return;
    this.listed = false;
    this.send({ op: "closed", tableId }, null);
  }

  /** Send each person their own view of the table (this person's own is delivered here). */
  broadcast() {
    for (const uid of peopleIn(this.hosted)) {
      const view = viewFor(this.hosted, uid);
      if (uid === this.userId) this.receive(view);
      else this.send({ op: "state", view }, uid);
    }
  }

  kick() { this.track(this.runAI()); }

  /** The house's seats move, one at a time with a pause, until it is a person's turn or the match ends. */
  async runAI() {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.hosted && aiToMove(this.hosted)) {
        await this.delay(AI_DELAY_MS);
        if (!this.hosted || !aiToMove(this.hosted)) break;
        this.hosted = stepAI(this.hosted, this.rng).table;
        this.broadcast();
      }
    } finally { this.looping = false; }
  }

  // ─── what arrives ──────────────────────────────────────────────────────────

  /** A message from `senderId`, who the server (not the message) says sent it. */
  handle(msg, senderId) {
    if (!msg || typeof msg !== "object" || typeof senderId !== "string" || senderId === this.userId) return;
    const op = { who: this.onWho, open: this.onOpen, closed: this.onClosed, join: this.onJoin, leave: this.onLeave, move: this.onMove, state: this.onState, denied: this.onDenied }[msg.op];
    op?.call(this, msg, senderId);
  }

  onWho(_msg, senderId) {
    if (this.hosted?.phase === "lobby" && summary(this.hosted).free > 0) this.send({ op: "open", table: summary(this.hosted) }, senderId);
  }

  onOpen(msg, senderId) {
    const t = msg.table;
    if (!t || typeof t.id !== "string") return;
    const entry = { id: t.id, hostId: senderId, hostName: text(t.hostName, 60), ante: whole(t.ante), town: { name: text(t.town?.name, 80), sceneId: text(t.town?.sceneId, 40) }, free: whole(t.free), total: whole(t.total) };
    const fresh = !this.tables.has(entry.id);
    this.tables.set(entry.id, entry);
    if (fresh) this.onTable?.(entry);
    this.notify();
  }

  onClosed(msg, senderId) {
    if (this.tables.get(msg.tableId)?.hostId !== senderId) return;
    this.tables.delete(msg.tableId);
    this.notify();
  }

  /** Someone asks for a seat at the table this client hosts. */
  onJoin(msg, senderId) {
    if (!this.hosted || msg.tableId !== this.hosted.id) return;
    const r = typeof msg.charId === "string" && msg.charId ? join(this.hosted, { userId: senderId, charId: text(msg.charId, 40), name: text(msg.name, 80) || "?" }) : { error: "closed" };
    if (r.error) { this.send({ op: "denied", tableId: msg.tableId, reason: r.error }, senderId); return; }
    this.hosted = r.table;
    this.announce();
    this.broadcast();
  }

  /** Someone leaves the table this client hosts (the lobby, or the match: their dice go). */
  onLeave(msg, senderId) { this.dropPerson(msg.tableId, senderId); }

  dropPerson(tableId, userId) {
    if (!this.hosted || tableId !== this.hosted.id || !peopleIn(this.hosted).includes(userId) || userId === this.userId) return;
    const lobby = this.hosted.phase === "lobby";
    this.hosted = forfeit(this.hosted, userId, this.rng);
    if (lobby) this.announce();
    this.broadcast();
    this.kick();
  }

  /** A seat's move at the table this client hosts. Only the seat's own person, on their turn, with a legal move, changes anything. */
  onMove(msg, senderId) {
    if (!this.hosted || msg.tableId !== this.hosted.id || !msg.move || typeof msg.move !== "object") return;
    const r = applyMove(this.hosted, senderId, { call: msg.move.call === true, qty: msg.move.qty, face: msg.move.face }, this.rng);
    if (r.error) return;
    this.hosted = r.table;
    this.broadcast();
    this.kick();
  }

  /** The host's view of this person's table. */
  onState(msg, senderId) {
    const p = this.part;
    if (!p || this.hosted || senderId !== p.hostId || msg.view?.id !== p.tableId || typeof msg.view.phase !== "string") return;
    this.receive(msg.view);
  }

  /** The host refused the seat: the wager goes back. */
  onDenied(msg, senderId) {
    const p = this.part;
    if (!p || this.hosted || p.view || senderId !== p.hostId || msg.tableId !== p.tableId) return;
    p.settled = true;
    this.track(this.money.refund(p.player, p.ante).then(() => { this.part = null; this.onError?.(text(msg.reason, 20)); this.notify(); }));
  }

  /** A person left the world (Foundry's presence): their seat goes, or, if it was the host, the table is called off. */
  userGone(userId) {
    for (const [id, t] of [...this.tables]) if (t.hostId === userId) this.tables.delete(id);
    if (this.hosted) this.dropPerson(this.hosted.id, userId);
    const p = this.part;
    if (p && !this.hosted && userId === p.hostId && !p.settled && p.view?.phase !== "over" && p.view?.phase !== "cancelled") this.receive({ ...(p.view ?? { id: p.tableId }), phase: "cancelled" });
    this.notify();
  }

  /** This person's view changed: show it, and settle what it ends. */
  receive(view) {
    if (!this.part) return;
    this.part.view = view;
    this.notify();
    this.settling = this.settling.then(() => this.settleIfDone());
    this.track(this.settling);
  }

  /** The match is over (pay, post the card) or the table was called off (the wager goes back): once. */
  async settleIfDone() {
    const p = this.part, v = p?.view;
    if (!p || p.settled || !v) return;
    if (v.phase === "over") {
      p.settled = true;
      p.result = await this.money.settle({ player: p.player, view: v });
      this.notify();
    } else if (v.phase === "cancelled") {
      p.settled = true;
      await this.money.refund(p.player, p.ante);
      this.notify();
    }
  }
}
