# Merchant Shop

[← Wiki home](Home.md)

**[▶ Try this in your browser](https://dimitroffvodka.github.io/shadowdark-enhancer/#merchant-shop)** — search the stock and spend a character's gold. No install needed.

A GM-run shop that opens for every player at once. Players buy and sell against
their own `system.coins`, and every transaction is logged.

![The Merchant Shop](images/merchant-shop.png)

---

## Opening it

| Route | How |
|---|---|
| **Crawl Bar** | Right-click **Forge & Loot** → **Merchant Shop** |
| **API** | `game.shadowdarkEnhancer.merchant.openLocally()` |

The GM opens the shop, and it appears for **all connected players simultaneously**.

### Player opt-in mode

You can also leave the shop **available** instead of forcing it open. Players
then open and close their own shop window at will, from a chat card or the crawl
strip, until you close the shop. This is persisted, so a reload restores it.

Players read a **snapshot** of the inventory taken when you made the shop
available, so opening the window doesn't need a round trip to the GM. The
snapshot refreshes whenever inventory changes.

---

## Two inventory sources

| Source | What it is |
|---|---|
| **Compendium catalog** | A curated list you assemble from compendium items |
| **An NPC's own inventory** | The shop sells what that actor is carrying |

Actor mode is the one to use for "you meet a peddler on the road": sell them the
peddler's actual goods, and the peddler's stock depletes.

## The buy list

Grouped into collapsible category sections:

**Basic Gear · Weapons · Armor · Scrolls · Wands · Potions · Poisons**, plus an
**Other** bucket for anything uncategorised.

## Buying and selling

- **Buying** deducts from the character's purse and creates the item on them.
  A player who can't afford it is refused, and their coins are untouched.
- **Selling** removes the item and pays out at the **sell ratio**, the
  percentage of an item's value the shop pays back.

![The Sell tab: Your Equipment listed with each item's value, the payout at the
current sell ratio, a quantity box and a Sell button](images/sell-tab.png)

The **Sell** tab lists the character's own equipment under **Your Equipment**,
with the ratio shown top-right. Each row gives the item's **Value** and, in
green, what the shop actually pays: a 2 gp Backpack pays `1 gp` at 50%.

| Setting | Default | Range |
|---|---|---|
| Merchant Sell Ratio (%) | `50` | 0–100, in steps of 5 |
| Merchant Shop Name | `The Merchant` | — |

> **These are set in the shop window, not in Configure Settings.** They are
> world settings, but deliberately not listed in Foundry's settings UI. You
> change them where you use them.

There is also a **Buy Markup (%)** (default `100`) for running a sale or a
gouging merchant. The shop window accepts `10`–`500`. (Setting it to `0` for
free goods is possible via the API's `open({ buyMultiplier: 0 })`, not the UI.)

> **Transactions are serialised.** Every buy and sell is queued on a single
> processing client, so two players spending the last of a shared purse, or
> buying the last item in stock, can't both succeed. No double-spending, no
> overselling.

### The extortion swing

A character who succeeded at **Extortion: 25% price swing** during
[Downtime](Downtime.md) walks in with leverage. The shop honours it on that
character's **next** transaction, whichever kind comes first:

- a purchase costs **25% less**, or
- a sale earns **25% more**.

It is armed on the character, not on the shop, so it never reprices anything for
anyone else and it stacks on top of whatever markup and sell ratio you have set.
The price the buyer is charged already includes it, and the transaction's chat
card and notification both name it, reading `(25% off — extortion)` on a purchase
and `(+25% — extortion)` on a sale.

It is spent only once the transaction has actually landed. A purchase turned away
for want of funds, or a sale that fails, leaves the swing armed for next time.

## Saved merchants

The module seeds two saved merchant configurations at world load, idempotently:

| Merchant | Stock |
|---|---|
| **The Merchant - Base** | Core system gear |
| **The Merchant - Western Reaches** | Base gear plus enhancer items (fills in once its item pack exists) |

**The Merchant - Base** is also loaded as the live shop in a brand-new world, so
the **Buy** tab has stock the first time you open the window, with no setup needed.
This happens once: if the world already has shop inventory it is left alone, and
once you have emptied or replaced the stock it stays that way across reloads.
Load either merchant again whenever you like from **Manage → Saved Merchants**.

Save your own configurations alongside them.

## Gamble

Off by default. Tick **Allow players to gamble on loot tables** on the Manage
tab, then add options: a display name, a roll table, and a gold cost. Players
pay the cost and get whatever the table rolls.

![The Gamble tab: two configured options, Treasure 0-3 at 10 gp and Luxury at
25 gp, each with its own Gamble button](images/gamble-tab.png)

Each option is one row: its name, its cost, and a **Gamble** button. The player's
purse sits in the header, and an option they can't afford is disabled.

A drawn row is turned into loot with **the same rules the
[Loot Generator](Loot-and-Treasure.md) uses**, so a table gives the same thing
however you roll it:

| The row | What the player gets |
|---|---|
| A linked item | That item, on their sheet |
| A linked table | Rolled too, up to three levels deep |
| Currency text (`10 cp in a greasy pouch`) | Coins in their purse |
| A sub-roll row (`Meteorite 1d4: 1. lute, 2. viol…`) | The die is rolled, giving *Meteorite harp* as a treasure item |
| Text naming real gear (`Torch`) | That item |
| Priced text (`Silver tooth (1 gp)`), scrolls, wands, `+N` | A treasure item worth that much |
| Any other text | Printed on the card as what they rolled, with no item |

The table picker lists **every roll table in the world *and* in every compendium**,
grouped by where it lives (world tables first, then one group per pack, labelled
with the package it came from). If a gamble's table can't be found when a player
pulls the lever (a compendium whose module was uninstalled, a deleted table),
they are told so and **not** charged.

## The transaction log

Every purchase and sale is recorded and **exportable to Discord** as markdown.
Transactions also feed the [Session Recap](Session-Recap.md) automatically.

![The Log tab: timestamped rows showing who bought or sold what and for how
much, with Shop Log and Session Summary export buttons](images/log-tab.png)

Each row is stamped with the time, the character, and the price. The icon says
which kind of transaction it was: a cart for a purchase, coins for a sale, and
**dice for a gamble**, whose row records what the table rolled.

The two buttons copy Discord-ready markdown **to your clipboard**: **Shop Log**
is the shop's own history, **Session Summary** the wider recap. GMs also get a
**Clear Log** button.

---

## Troubleshooting

**A player says the shop won't open.**
Either the GM hasn't opened it, or it isn't marked available to players. Check
the shop's availability toggle.

**"Your GM's Foundry tab needs a reload before shop transactions can land."**
Buying and selling happen on the **active GM's** client, and that tab has been
open since before the module was updated, so it is running code that doesn't
know about the transaction. Rather than let a purchase go silently nowhere, the
module pings the GM and compares versions before sending — this warning is that
check firing. Have the GM reload their tab. See
[Troubleshooting](Troubleshooting.md#a-player-action-does-nothing-and-no-error-appears).

**A purchase went through but the player has no item.**
The item is created on the *buying actor*. If a player controls several actors,
check the one they had selected in the shop.

**Quantities are wrong after a purchase.**
The created item's quantity is always overridden to what was bought. It does not
inherit the merchant's stack size. If you see a stack size instead of the bought
quantity, that's a bug worth
[reporting](https://github.com/DimitroffVodka/shadowdark-enhancer/issues).

**Selling paid the wrong amount.**
Check the sell ratio. At the default `50`, a 10 gp item sells back for 5 gp.

**A sale restocked the wrong inventory.**
This was a real bug fixed in v0.11.x: a headless active GM (window closed, or a
second GM relaying for a player) restocked an actor-mode sale into the compendium
inventory. If you are on an older build, update.

**Stock didn't go down after a purchase.**
Compendium-catalog mode sells from an unlimited list by design. Use actor mode if
you want depletion.

---

**Related:** [Loot & Treasure](Loot-and-Treasure.md) · [Session Recap](Session-Recap.md)
