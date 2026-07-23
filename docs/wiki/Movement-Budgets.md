# Movement Budgets

[← Wiki home](Home.md)

Per-turn movement allowances, a coloured ruler while you drag, optional refusal
of over-budget moves, and a one-click rollback to where a token started its turn.

<!-- TODO screenshot: images/movement-ruler.png — The movement ruler showing an over-budget move in red
     How: Start a crawl, drag a party token past its budget; screenshot the red ruler. -->

---

## What it does

Every tracked token carries a **remaining movement** figure. Dragging it draws
Foundry's ruler in **green while the move fits** and **red once it doesn't**. The
matching pill on the [crawl strip](Crawl-Strip-and-Crawl-Bar.md) card counts down
as the token moves.

Whether an over-budget move is actually *refused* is a separate, per-mode
setting — and both are **off by default**. Out of the box this is a visual aid,
not a cage.

## Which tokens are tracked

| Mode | Tracked |
|---|---|
| **Crawl** | Tokens whose actor is in the crawl roster (added via **Add Tokens**) |
| **Combat** | **Every** owned token in the combat — combatants join the tracker, not the crawl roster |

Nothing is tracked while the crawl is stopped.

## Where the budget comes from

There is **no per-actor speed setting** for player characters — the budget is
driven by module settings, deliberately, because Shadowdark has no per-character
speed stat.

| Situation | Budget |
|---|---|
| **Crawl**, any token | `Out-of-combat movement budget` — default **90 ft** |
| **Combat**, PC token | `Combat movement default` — default **30 ft** |
| **Combat**, NPC token | The NPC's own `system.move` from its stat block (see below) |

### NPC movement in combat

NPCs use their stat block, mapped from Shadowdark's move enum:

| Stat block | Feet per turn |
|---|---|
| None | 0 (immobile) |
| Close | 5 |
| Near | 30 |
| Double near | 60 |
| Triple near | 90 |
| Far | 120 |
| Special | *falls back to the combat default* |

An unrecognised or missing value also falls back to the combat default.

## When budgets reset

| Event | Effect |
|---|---|
| **Next Turn** on the crawl bar | Every crawl member's budget refills |
| **Combat round or turn change** | Each combatant gets a fresh budget |
| **Rollback** | The token's budget is restored along with its position |

## Enforcement

**Configure Settings → Shadowdark Enhancer:**

| Setting | Default | Effect when on |
|---|---|---|
| Enforce out-of-combat movement budget | **off** | Crawl moves beyond the budget are refused before they commit |
| Enforce combat movement budget | **off** | Combat moves beyond the remaining movement are refused |

Combat enforcement is off by default on purpose — Shadowdark combat traditionally
runs on player honesty rather than hard limits.

When a move is refused you get a warning naming the actor and the feet remaining
(`Sneaky Pete: only 15ft remaining.`), the token does not move, and its budget is
untouched.

> **With enforcement off, remaining movement can go negative.** This is
> intentional: a card reading `-20/90 ft` tells you at a glance exactly how far
> past the cap someone went, which a floor at zero would hide.

Distances are measured with the scene's own grid size, distance, and diagonal
rule, then rounded to the nearest 5 ft.

## Rolling back a move

Each token's **turn-start position** is snapshotted when its turn or round
begins, and stamped onto the token document.

To undo: **open the token HUD** (right-click the token) and click the
**Rollback Movement** button — the circular arrow in the left column.

<!-- TODO screenshot: images/rollback-hud.png — The Rollback Movement button on the token HUD
     How: Start a crawl, right-click a party token; screenshot the token HUD with the Rollback Movement button. -->

The token returns to its turn-start square **and its full movement budget is
refunded**. A chat notification confirms it.

The button appears for:

- **crawl members**, in crawl mode
- **any owned token**, in combat mode

**Players can roll back their own tokens.** Only GM clients may write the change,
so a player's click is relayed to the active GM over the socket and performed
there. With several GMs online, exactly one serves the request — you never get a
double rollback or a double refund.

---

## Troubleshooting

**"No turn-start position recorded for this token."**
The token's turn never started while the crawl was running — for example it was
dropped onto the scene mid-turn, or the crawl was started after combat began.
There is nothing to roll back to. It will have a position from the next turn on.

**Movement isn't being deducted.**
Check that the crawl is actually running (the bar shows **End**, not **Start**),
and in crawl mode that the actor is in the roster — select the token and click
**Add Tokens**.

**The ruler stays green past the budget.**
The ruler colours against *remaining* movement, which is stored per token. If the
token has never moved this turn the flag may be unset and it falls back to the
base speed. Advance a turn to reset cleanly.

**A ghost ruler trail is left on the canvas.**
Selecting a different token clears stale rulers. This is also cleaned up
automatically ~100 ms after a move commits.

**Enforcement is on but a GM can still move tokens freely.**
Enforcement applies to whoever performs the move, GM included. If a move is
committing anyway, confirm the token is tracked — an untracked token in crawl
mode (not in the roster) is never checked.

**Movement got deducted twice.**
It shouldn't — the deduction is written by exactly one client, the user who moved
the token. If you can reproduce this, it's a bug worth
[reporting](https://github.com/DimitroffVodka/shadowdark-enhancer/issues).

---

## Known limitations

These are deliberate omissions, not oversights:

- **No terrain difficulty.** Every square costs its face value. Deferred until
  Shadowdark has a region-based terrain system worth integrating with.
- **No fly / swim / climb modes.** One budget per token.
- **No encumbrance interaction.** Being overloaded does not change the budget.

---

**Related:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Settings Reference](Settings-Reference.md)
