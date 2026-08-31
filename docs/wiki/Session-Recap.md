# Session Recap

[← Wiki home](index.md)

A session log that fills itself in while you play, and exports to Discord as
markdown.

![The Session Recap window](images/session-recap.png)

---

## Opening it

| Route | How |
|---|---|
| **Crawl Bar** | Right-click **Forge & Loot** → **Session Recap** |
| **API** | `game.shadowdarkEnhancer.recap.open()` |

---

## It's tied to the crawl

You don't start and stop it separately:

| Crawl action | Recap effect |
|---|---|
| **Start Crawl** | Begins a new session, or continues the current one |
| **End Crawl** | Prompts you to **save**, **pause**, or **discard** |

Saved sessions go to a history you can browse later.

## What it captures, with no extra clicks

| Captured | From |
|---|---|
| **Loot claims** | [Loot & Treasure](Loot-and-Treasure.md) |
| **XP awards** | [Party XP](Party-XP.md) |
| **Merchant purchases and sales** | [Merchant Shop](Merchant-Shop.md) |
| **Downtime attempts** | [Downtime](Downtime.md) |
| **Carousing** | Shadowdark Extras' carousing overlay, if you run it |
| **Encounter checks** | Roll, threshold, hit/miss, and the crawl round it happened on |
| **Combats** | Start, end, and participants |
| **Per-PC roll statistics** | Every roll each character made |
| **Damage dealt and kills** | Combat tracking |

## The tabs

**Overview · Combat · Loot · XP & Renown · Downtime & Carousing · History**

### XP & Renown

XP awards first, grouped by player with a per-player total. Underneath, a
**Renown** block with every change to a character's [renown](Renown.md) this
session — the time, the change, the new total, the band it landed in and your
reason — grouped by player with a net change each. The block is hidden entirely
when nothing moved.

Renown shares this tab rather than taking one of its own: both are per-character
advancement ledgers the GM awards, and a session rarely produces more than a
couple of renown rows.

### Downtime & Carousing

One row per resolved [Downtime](Downtime.md) attempt, grouped by the controlling
player and newest first inside each group. The group header carries a subtotal of
how many landed and what they cost, reading `2/3 · 30 gp`. A row gives the time,
the character, the activity and slot, the check, the verdict and the fee, with
whatever the success actually applied in italics underneath. With nothing
recorded it says `No downtime activity recorded.`

> **A paid attempt is counted twice, deliberately.** The fee also appears under
> the merchant purchases as `Downtime: <slot label>`, because that is the money
> ledger and feeds the spend totals. This tab is the narrative record of what was
> attempted and how it went. Both views need their own copy.

Downtime is also written to a permanent **Downtime Log** journal that outlives
the session. See [Downtime](Downtime.md#the-downtime-log).

#### Carousing

Underneath the downtime blocks, a **Carousing** block for each carouse the party
ran through **Shadowdark Extras**' carousing overlay. Carousing is that module's
feature, not this one's — nothing here rolls it, changes it, or writes to it. The
results are mirrored in so the night lands in the session log beside everything
else, and so it survives into the Discord export and the saved history.

Each block is one carouse, not one player: the tier and its cost were bought by
the whole party, and every character rolled against the same one. The header
gives the timestamp Shadowdark Extras stamped on it, then a subtotal reading
`4 carousers · 18 XP · 5 benefits · 3 mishaps · renown +2` — only the parts that
actually happened. Under that, the tier in italics, then a row per character with
their d8 result and each benefit and mishap they rolled.

What the last column says depends on which carousing mode you run:

| Shadowdark Extras mode | Row ends with |
|---|---|
| **Expanded** | The effects it applied itself, in italics |
| **Original** | The GM's applied summary, or `not applied` until you press Apply |

The block only appears when Shadowdark Extras is installed, active, and its
**Enable Carousing** setting is on.

> **This is a copy, deliberately.** Shadowdark Extras' overlay holds one live
> carouse at a time, so resetting it for a second round of the evening erases the
> first. The recap keeps every carouse it saw, which is also what lets an
> archived session still show one.

> **A carousing renown swing is counted twice, deliberately.** The same change
> appears as its own row under **XP & Renown** and in the character's
> [renown log](Renown.md#changes-made-outside-the-module), tagged **Carousing**.
> That is the same double-entry downtime uses: this block is the night's summary,
> the renown ledger is the per-character record.

In **Expanded** mode the subtotal also carries the night's net swing, reading
`renown +2`, and it agrees with the ledger — Shadowdark Extras hands the change to
this module and records back the number this module actually wrote.

In **Original** mode the subtotal leaves renown out. That mode stores no renown
figure on the result; Shadowdark Extras works it out from the outcome's wording
when you press Apply, and keeps only the sentence. Re-deriving it here would mean
second-guessing that module's own reading, so the block shows what it applied
instead — the renown appears in the italic applied line for that character, and in
the renown ledger, just not in the header total.

Shadowdark Extras keeps its own permanent **Carousing Log** journal as well, with
its own table per session. That one is the GM-only record inside that module; this
tab is the same night in the context of everything else that happened.

## Exporting

**Copy for Discord** produces a markdown recap ready to paste into a channel,
including **Renown**, **Downtime** and **Carousing** sections — the first two
grouped per player, carousing grouped per carouse.

---

## Multi-GM safety

> **In a world with several GMs, only the *active* GM records.** Nothing is
> double-counted, and no two GMs write competing session state.

This is the same single-writer pattern the loot claims, merchant transactions,
and content sweeps use.

---

## Troubleshooting

**Nothing is being recorded.**
No session is active. Start a crawl. The recap begins with it. Every logging
call self-guards on an active session, so it silently does nothing otherwise.

**I ended the crawl and lost the session.**
The end-crawl prompt offers save / pause / discard. Discard throws it away.
Choose **pause** if you want to resume the same session later.

**Two GMs are online and entries look duplicated.**
They shouldn't be. Only the active GM records. If you can reproduce this,
[report it](https://github.com/DimitroffVodka/shadowdark-enhancer/issues).

**The Discord export is missing a section.**
Sections with no entries are omitted. If you expected combat data, confirm the
combats ran while the session was active and not before you started the
crawl.

**We caroused and the Carousing block is empty.**
Three things have to be true: Shadowdark Extras is active, its **Enable Carousing**
setting is on, and a recap session was running when the rolls landed. A carouse is
only captured once it has resolved — one still being set up in the overlay isn't
an event yet.

**A carouser shows as `?` instead of a character name.**
The name is read from the overlay's actor drops, which the GM clearing the overlay
wipes. A name captured while the drop was still live is kept, so this only happens
to a carouse whose rolls were never seen — one from before the session started,
for instance.

**Encounter checks aren't showing a turn number.**
The crawl round is only stamped when the check happens in crawl mode. Checks made
during combat are recorded without one.

---

**Related:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Party XP](Party-XP.md) · [Merchant Shop](Merchant-Shop.md)
