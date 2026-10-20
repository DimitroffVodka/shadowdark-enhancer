# Town Landing Page

[← Wiki home](index.md)

A front door for a town. The scene's own picture fills the screen and a menu
runs down the right: the town's name, a line for each merchant, and the Quest
Log, the Journals, the Party and Downtime. Players shop with their own
characters, and they can do it between sessions with you not connected. A table of games of
chance and a sales log for the GM can be added to the same page.

![The landing page: a scene's picture with the menu down the right](images/town-landing.jpg)

*The picture here is a sample. On your table it is the scene's own picture.*

Any scene can have one. Everything on it is read from your NPCs and the scene as
they are, so changing an NPC's items or a price changes the shop.

---

## Putting it up

Press the **Landing page** button (a landmark icon, in the Token Controls on the
left of the screen) or **Alt+T**. The first time on a scene it makes an empty
page: the scene's name, the four entries and no merchants. Then:

- **It is up for everyone on the scene, you included.** The button is lit while
  it is up.
- **Press it again** and it goes away for everyone. The page is kept, merchants
  and all; press again to bring it back. The eye icon on the page does the same.
- **Moving between scenes** follows the page. Arriving in a scene whose page is
  up opens it; arriving in one without a page, or with its page taken away,
  closes it.

The picture is the scene's own. Choose it, and where the camera starts, in the
scene's settings (the editor has a **Scene settings** button for it). The menu
fades dark on the right, so keep that side of the picture quiet. Players can
still pan and zoom the scene as usual.

When Foundry's sidebar is open the menu moves left of it, and if the Crawl Strip
is up and would cover the town's name, the menu sits just below it.

---

## Setting up a town

1. **Make each merchant an NPC actor.** Give it items of the types **Basic**,
   **Weapon** or **Armor**. Those items are the stock: an item's quantity is how
   many the merchant has, and its price is what it charges. Other item types
   are not sold.
2. **Press the pencil** on the page (the GM sees four icons at the top: the
   pencil for the settings, the receipt for the [sales log](#the-sales-log), a
   button that restocks every shop, and the eye that takes the page away).
3. **Fill in the town**, then pick an NPC under **Merchants** and press **Add
   merchant**. Set each merchant's fields (below).
4. **Save.** Every open page updates at once.

Instead of picking an NPC you already have, use **Generate merchant** under the
list (see [Generating a merchant](#generating-a-merchant)).

| Field | What it does |
|---|---|
| **Name, Tagline, Welcome text** | The heading, the italic line and the paragraph under it. Name defaults to the scene's name |
| **Around town** | Which entries players see: Quest Log, Journals, Party, Downtime, Carouse, Rumors (the last two are off on a new page; see A tavern page) |
| **Open a games table** | Adds **Games of chance** to the menu (see Games of chance). Off until you turn it on |
| **Largest bet (gp)** | The most one wager may stake, 1 to 1000 gp (10 by default) |
| **House keeps (% of winnings)** | The share of every win the town keeps, 0 to 50 (5 by default) |
| **Role, One-line pitch** | The line under the merchant's name and the hover text |
| **Prices %** | 100 charges list price; 110 is 10% dearer, 80 is 20% cheaper (10 to 500) |
| **Buys back %** | What the merchant pays for what a player sells, as a share of the item's price (0 to 100) |
| **Open** | A closed merchant shows as closed and cannot be visited |
| **Restock** | Puts the merchant's whole shelf back when you press Save (see Restocking) |
| **Restock (days)** | The shelf puts itself back this many world days after its last restock. 0 means only by hand (see Restocking) |
| **Allows haggling** | On by default. Off removes the Haggle button for this merchant (see Haggling) |
| **Edit stock** | Opens the NPC, so you edit its items there |

An NPC can be a merchant once per town. The same NPC in two towns has its own
stock in each. Removing a merchant and adding the NPC again starts it fresh.

---

## What players see

- **The merchants** are listed by name with their role. Pressing one opens its
  shop. A merchant you closed shows as closed.
- **The other entries** open the [Quest Log](Quest-Log.md), the Journal sidebar,
  the [Party](Party.md) and [Downtime](Downtime.md), plus Carouse and Rumors if
  you ticked them (see A tavern page below). An entry that cannot open is
  greyed and says why: Party until the player can see a party (the
  [Party](Party.md) needs at least Observer), Downtime until you start a
  downtime session, Carouse until you start a night of carousing (or while no GM
  is connected), Rumors until a rumor has been given.
- **The foot** says which character the player is, and their purse.
- **Their own copy.** While you have the page up, a player can close it for
  themselves and bring it back with the same button or Alt+T. When you take it
  away they have neither.

Change the key under *Configure Controls*.

---

## Shopping

![The shopfront](images/town-shop.png)

- **Buying as** (bottom left) picks which of the player's characters pays. It
  starts as the selected token's character, else the one assigned to the
  account.
- **Filter and search.** The chips filter by Weapons, Armor and Gear; the
  search box narrows by name.
- **What a ware is.** Every card shows facts read from the item's own stats, so
  a ware with no written description still says what it is: a weapon's kind,
  range, damage and properties (Melee, Near, Damage d4, Finesse, Thrown), an
  armor's AC (AC 13 + DEX, +2 AC for a shield), and how many slots it takes. The
  start of the item's description sits under the name. The **info** button (or a
  click on the name) opens the whole description and what each property does.
- **Add to cart.** Set the quantity with the stepper and press **Add to cart**.
  The same ware added twice stays one line. A ware that costs more than the
  purse shows its price in red. Gear sold in bundles (arrows, rations) is
  priced per bundle, and a ware card shows what will actually be charged, even
  for a bundle that is partly sold.
- **The cart** sits above the foot of the window: each line has plus, minus and
  remove, and the total updates as you change it. A quantity is cut to what is
  on the shelf, and the cart says so. The cart is kept while you switch which
  character buys (the prices are worked out again) and is emptied when you open
  another merchant.
- **Checkout.** One press buys everything: coins come off the purse and the
  items land on the sheet, line by line. Checkout is greyed while the total is
  over the purse. If the GM changed a price, a restock came or a haggle landed
  since you filled the cart, nothing is charged and the cart says the prices
  changed, so you look it over and press again. If a line cannot be completed,
  the lines before it stay bought and the chat card names the line that failed.
- **Sell.** The **Sell** tab lists what the character carries of those types
  and what one unit pays at the merchant's buy-back %, with the same facts and
  short description as the Buy tab. **Sell** sells one; **All** sells the
  stack. The merchant does not restock what it buys. Below the list, **Sold
  here** keeps what this character sold to this merchant (see
  [Taking it back](#taking-it-back)).
- **A chat card** is posted for each checkout (one card listing every ware
  bought) and each sale, in the merchant's name.
- **A downtime extortion swing** a character has armed applies to the next
  sale, or at checkout to the dearest line of the cart only, and is used up
  only if that line is bought. See the [Merchant Shop](Merchant-Shop.md).

---

## Haggling

The **Haggle** button is in the shop header (it does not need anything in the cart), unless the GM switched haggling off
for that merchant. A character gets **one try per merchant per restock**: roll
d20 and add the character's Charisma modifier.

| Natural roll or total | Result | Every price at that merchant |
|---|---|---|
| Natural 20, or total 20 or more | Masterful deal | 25% off |
| 17 to 19 | Sharp deal | 15% off |
| 14 to 16 | Good deal | 10% off |
| 11 to 13 | Fair deal | 5% off |
| 8 to 10 | No change | unchanged |
| 5 to 7 | Shaky | 10% dearer |
| 2 to 4 | Insulted | 25% dearer |
| Natural 1, or total 1 or less | Thrown out | the character is banned |

- **How long it lasts.** A good or bad result applies to everything the
  character buys from that merchant, in the cart and on the cards, until the
  merchant restocks. A restock is a new negotiation, so the character can try
  again. It never changes what the merchant pays for what a player sells.
- **The ban is permanent.** A banned character sees the shop shut, and cannot
  buy, sell or take back from that merchant. At Charisma +0 every try has a 1 in
  20 chance of it, and tries come back with each restock, so over a long
  campaign it is likely to happen to someone.
- **Pardon.** When you shop as a banned character, the shop header shows a
  **Pardon** button. Pressing it lets the character back in; that restock's
  attempt stays used.
- **The roll** is posted to the chat only after the result is saved, so a
  roll you can see always counted.
- **Turning it off.** Untick **Allows haggling** on the merchant in the editor.

---

## Taking it back

Every sale to a merchant is kept in the **Sold here** list on the Sell tab: the
item, how many and what the character was paid. The newest ten per merchant are
kept, and a restock does not clear them. **Take back** charges exactly what the
character was paid, with no markup, no haggle and no extortion swing, and gives
the item back as it was sold, with its own flags. It cannot be done while the
merchant is closed or the character is banned. The chat card and the sales log
call it "(bought back)".

---

## Games of chance

![The games table](images/town-games.png)

Turn on **Open a games table** in the settings and **Games of chance** joins the
menu. A player picks their character, sets a **wager** in silver (quick buttons
for 1 sp, 1 gp, 5 gp, 10 gp... and the table's limit) and plays one of nine
games. Four settle on one roll. The other five open a table of their own,
because there is something to decide. A result card is posted to the chat for
everyone to see.

**One roll.** The wager comes out of the purse only when the game is played.

| Game | How it plays | Pays |
|---|---|---|
| **Coin toss** | Call heads or tails; the coin is flipped | 1 to 1 |
| **Dice duel** | You and the house roll 2d6 each; higher wins, a tie gives the wager back | 1 to 1 |
| **Fortune wheel** | A d100: 1-45 nothing back, 46-68 half back, 69-90 double, 91-98 triple, 99-100 the jackpot | Up to 10 to 1 |
| **Card draw** | You and the dealer draw a card each, ace high; higher wins, the same rank gives the wager back | 1 to 1 |

**A table of its own.** There is no GM and no house purse, so these are played
against the house, whose moves are made for it from only what a player at the
table could see. Closing the window, or going back, in the middle of a game
walks away from it and loses what is in the pot.

### Beholder's Bluff

![A hand of Beholder's Bluff](images/town-hand.png)

Both sides roll four d10 in secret and ante one wager. Each round you **show
one of your dice** (the house shows one too) and then bet; after three rounds
the last die shows and the higher total takes the pot. Betting is fixed-limit:
**Check**, **Bet** one wager, **Raise** one more (once a round), **Call** or
**Fold**. You open the first and third round, the house the second. Equal
totals give every wager back. The house reads the odds from your shown dice and
what is in the pot, so showing a high die first can bluff it off a hand, and
hiding one can build a pot.

### Three-dice Brag

Both sides roll three d6 in secret and ante one wager. In round 1 you may
**reroll up to two dice** (the house may too, and the log says how many it
rerolled) and then bet; in round 2 you may reroll **one**, then bet again.
The better hand wins: a prial (all alike), a straight, a flush (all odd or all
even), a pair, then the high dice. A pair of one parity is a flush. Equal hands
give every wager back.

### Death roll

![The death roll](images/town-death.png)

You open on a d100; then the house and you take turns, each on a die as big as
the last roll. Whoever rolls the **1** loses the stake. The one about to roll is
always the underdog (never worse than 1 in 3, never better than even), and the
window shows the odds of the die coming. Before a roll either side can **offer
to double the stake**: the other **takes** it (both stakes double, and the taker
holds the right to double next) or **passes** and loses the stake as it stood.
Nobody doubles past 8 times the wager. The house takes a double it wins a third
of the time or more, so it passes at a d2 and doubles when you are about to roll
a small die.

### Dice roulette

![Dice roulette](images/town-roulette.png)

The wheel is a d20. Pick a chip size, click spots to lay chips (a click lays one,
the stack under the spot takes one off), then **Spin**: one d20 settles every
spot at once. **Even**, **Odd**, **Low** (1-10) and **High** (11-20) pay 1 to 1,
a number pays 19 to 1. Nothing is taken until the spin, so closing the window
costs nothing, and the layout stays so you can bet it again. The whole board
may not stake more than the table's limit.

### Blackjack

![A hand of blackjack](images/town-blackjack.png)

You and the dealer get two cards, one of the dealer's face down; every hand is
dealt from a freshly shuffled deck of 52, so counting cards earns nothing. Cards
count their pips, faces ten, an ace eleven or one. **Hit** for another card,
**Stand**, **Double down** (one more card and no more, for a second wager, on a
hand of two cards) or **Split** a pair of the same value into two hands with a
second wager (once; split aces take one card each, and 21 on a split hand pays 1
to 1). Over 21 loses at once. The dealer draws to 17 and stands on every 17, soft
ones too, and does not draw at all when you have bust. A natural 21 on your first
two cards pays **3 to 2**; the dealer has looked at its hole card by then, so if it
has a natural too the hand is a push, and if only it has one you lose the wager
before you can put more on the table. Insurance and surrender are not offered.
The dealer has no choices to make, so there is no house skill to set: with the
rules above a player who plays the book loses a fraction of a percent to the
deck, and the town's cut comes on top of that.

### What the house keeps

The **house keeps** a share of every *win*: at 5%, a 100 cp wager that wins pays
95 cp. In a hand or a round it takes that share of what the *house* put in the
pot, never of your own coins. A loss, a tie and the wheel's half-back are not
touched by it, and the winnings round down. With no cut the coin, the duel, the
cards and roulette are exactly fair, and the wheel returns 99.5% of what is
staked, so the cut is what makes the house win over a night. The **largest
bet** is the table's limit on one wager (a hand puts in up to 7 wagers in Bluff
and 5 in Brag, a round of the death roll up to 8, a hand of blackjack up to 4
when both split hands are doubled, a roulette board up to the limit in all), and the house has no purse to run dry, so the limit is what
bounds a lucky streak.

Like a purchase, a game only changes the player's own character, so it works
with no GM connected. Dice are rolled with Foundry's own dice and show in Dice So
Nice when it is installed; the blackjack deck is shuffled from Foundry's random
source, so it shows no dice.

---

## The sales log

![The sales log](images/town-log.png)

The receipt icon on the page (GM) opens the **Sales log**: every purchase, sale
and game at the town's tables, newest first, with who did it, where, when, and
the coins the character gained or lost. Filter by **Bought**, **Sold** or
**Games**, by merchant or game, and between **This town** and every town. The
header totals what was **paid in** (purchases and lost wagers), **paid out**
(sales and winnings) and what the **town kept**.

The log is read from the chat cards the town posts (each carries its facts), so
it works with no GM connected and it lasts as long as the chat does: clearing
the chat clears it, and sales made before the log existed are not in it.

---

## Stock and restocking

A merchant's stock is its NPC's items. Each purchase is recorded on the
buyer's own character, and what is left on the shelf is the NPC's quantity
minus what everyone has bought. So the whole table draws on the same stock,
and every open shop updates as others buy.

- **Never runs out.** As the GM, press the infinity button beside a ware's
  type in the shopfront. A ware that never runs out shows **Plenty**.
- **Restock.** Press **Restock** on a merchant in the editor (it takes effect
  when you Save), or the restock button on the page for every shop. The shelf
  is back to the NPC's quantities. Nothing is written to any player's
  character. A restock also starts a new round of haggling.
- **Restock by itself.** Put a number in **Restock (days)** on a merchant. When
  the world day turns, the shelf is put back once that many days have passed
  since its last restock, whichever way it was restocked. The count starts the
  first time the table sees the merchant with days set (and when you turn days
  on), so nothing restocks at once. If the clock jumps a month ahead the shelf
  restocks once, not once per interval. Setting the clock back restarts the
  count. Leave it at 0 to restock by hand. Only the active GM's browser does
  this, so a GM must be connected on the day it turns; a GM who was away
  catches up when they next load the world.
- **Changing an NPC's quantity** changes the shelf at once: raise it to add
  stock without a restock.

---

## Generating a merchant

Under the merchants list the editor has a **Generate merchant** row. Pick a
**kind of shop** and a **town size** and press the button.

| Kind | Sells |
|---|---|
| General store | Basic gear |
| Weaponsmith | Weapons |
| Armorer | Armor |
| Outfitter | Basic gear, weapons and armor |

| Town size | Different wares | Dearest single item | Most of one ware |
|---|---|---|---|
| Village | 6 | 20 gp | 3 bundles |
| Town | 12 | 70 gp | 5 bundles |
| City | 20 | no limit | 8 bundles |

Weapons and armor get half as many bundles of each ware (at least 1). Only ordinary gear is
picked, the same priced gear the Merchant Shop's Catalog lists, never magic
items. The button makes an NPC named after the kind and the scene (for example
"Armorer, Hollowmere") in an Actor folder called "Hollowmere merchants", gives it
the wares, and adds it to the page with the kind as its role. Edit its items on
the NPC afterwards like any merchant's. The NPC is made at once: if you cancel
the editor it stays in its folder.

---

## Without the GM

A player's purchase only changes their own character: coins out, the item in,
and a line in their own record. A player may write their own character, so
shopping works with no GM connected. This is why the stock is kept on the
buyers' characters and not in a setting only the GM can write.

Because of that, town sales are not written to the Merchant Shop's transaction
log or the [Session Recap](Session-Recap.md). The chat cards are the record, and
the sales log reads them.

---

## Limits

- A player shops as a Player character they own. The GM can shop as any.
- Two players taking the last unit at the same instant can both get it.
- Shopping as a token that is not linked to its actor is not counted against
  the stock.
- A merchant whose NPC was deleted is hidden from players and shown to you as
  an Unknown NPC, ready to remove.
- Items with no price sell for nothing.
- Haggling, a ban and the Sold here list are kept on the player's own
  character, per merchant. Removing a merchant and adding the NPC again makes a
  new merchant, so it starts clean.
- Automatic restock happens while a GM is connected when the world clock turns, or when a GM next loads the world.
- The cart is not kept when the window is closed.
- The page does not lock the camera: players can pan and zoom the picture.
- A game's dice are rolled on the player's own client, like everything else a
  player does to their own character; the wager limit is the safeguard, not the
  house's purse.

---

## A tavern page

Tick **Carouse** and **Rumors** in the page's settings (the pencil) and the same
page becomes a tavern. A new page does not get these two; only the four town
entries.

- **Carouse.** You open the Carousing window on the party that has a night
  open, else on the party you have selected if it is a native one, else on the
  first native party, and start a night there. With no native party you get a
  notice instead. A player can open it only while a party they can see has a
  night open; it then opens that party's Carousing tab. Until then the entry is
  greyed and says it opens when you start a night. Carousing needs a GM
  connected, so with none the entry stays greyed and says so (it updates when
  the GM connects or leaves). Joining and confirming there also needs Owner on
  the party actor: the Party sheet disables its controls for anyone who cannot
  edit it, so a player who only observes the party sees the night and who has
  confirmed, but cannot join or confirm. Give your players Owner on the party if
  they should carouse from the tavern page.
- **Rumors.** You get the usual Give rumors dialog. A player opens the Rumors
  Heard journal, which exists once any rumor has been given; until then the entry
  is greyed.

The games table, the shop and the sales log close with the page, so nothing is left
open when it goes away.

## On a Backdrop

A Town or Tavern place in Backdrop places can host this page over the full-screen
picture for the whole table, kept across scene changes. See
[A Town page on a place](Backdrop.md#a-town-page-on-a-place).

## Related

[Merchant Shop](Merchant-Shop.md) (the GM-run shop for the whole table),
[Quest Log](Quest-Log.md), [Party](Party.md), [Downtime](Downtime.md).
