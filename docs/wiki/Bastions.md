# Bastions

[← Wiki home](index.md)

A bastion is a place the party owns: a House, an Outpost, a Keep or a Castle,
with upgrades built into it a week at a time. It is an Actor type with its own
sheet, and the sheet draws it, from outside or from above, room by room.

It stands on its own: nothing here needs Shadowdark Extras.

---

## Creating one

**Actors sidebar → Create Actor**, then choose **Bastion**. It starts as an
unbuilt House with an empty treasury. Only the GM edits it; players who can see
the actor read it.

Macros can make one too: `game.shadowdarkEnhancer.bastion.create({ name, type,
treasury })` (see the [API](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md)).

---

## The four types

A **House**, an **Outpost**, a **Keep** and a **Castle**, each bigger than the
last: it costs more, takes longer to raise, has more AC and hit points and
room for more upgrades. The sheet shows the numbers of the type you pick, and
the Player's Guide to the Western Reaches prints them with the rules for repair,
siege damage and shelter.

Repair costs gold per hit point and takes a week; the **Repair** button on the
sheet works out the bill. At 0 HP the walls are breached.

---

## The sheet

**Overview.** The type, the party that owns it, AC, hit points, the treasury, how
many of its upgrade slots are used, and what it is worth. Under the build clock:
**Advance a week** finishes the bastion and its upgrades as the weeks pass,
**Repair** pays for the missing HP and mends them after a week, and **Roll the
month's disaster** rolls the month's check and posts it to chat.

**The party and the treasury.** Pick the **Party** that owns the bastion (Extras'
party, or the Enhancer's own). **Pay in** moves gold from a character's purse into the
treasury, and **Pay out** moves it back to a character. The dialog lists the party's
members, or every player character when the bastion has no party or its party lists
none. The gold is whole, comes out of silver and copper first, and a payment that
can't complete on both sides is put back. You can still type the treasury yourself.
Extras keeps a party's own coins in its own data and offers no way to change them, so
the party's stash isn't touched: a member pays from their own purse.

**Upgrades.** All twenty, with their art: Aviary, Armorer, Barracks, Blacksmith,
Brewery, Casino, Dungeon, Granary, Idol, Infirmary, Kennels, Library, Moat,
Stable, Tavern, Temple, Trading Post, Trophy Room, Vault and Wizard Tower.
**Build** takes the cost from the treasury and starts a week of work. You can't
build one that's already there, beyond the type's slots, before the bastion
stands, or without the gold. **Take down** frees the slot and refunds nothing;
the other upgrades keep their places.

**What each upgrade does** is the book's wording, and this module doesn't ship
it. The sheet reads it from your own copy of the Player's Guide: with the PDF
linked (**Importer Hub → Tools → Source PDFs**), press **Read upgrade text** on
the Upgrades tab (GM) and every upgrade's line appears on its card, on the plan's
hover card and in the macro API, for everyone. Until it is read, the cards show
the name and the cost.

Ten of the upgrades have an effect the module applies for you while the bastion stands:

- the **Granary** makes each warband [garrisoned](Warbands.md) there cost less a month;
- the **Barracks** heals each of them more a day;
- the **Casino** earns gold into the treasury at each month start the world clock
  passes, one roll a month shown in chat and logged, each month paid once however the clock
  moves. A Casino that finishes part way through a month earns from the next month start. If
  the treasury can't be saved, the GMs get a card with the gold to add by hand;
- the **Library** adds a bonus to the downtime checks about learning (Martial Training and
  Magical Research) for the members of the party that owns the bastion, on the Downtime
  window's rolls and shown on the chat card as "Library". Members are the linked party's
  (every player character if the party lists none); two Libraries don't stack;
- the **Trophy Room** gives each member of the party XP for each notable trophy you place
  (the Overview tab's Trophies box, GM only: name it and place it). The name is kept on the
  bastion, the XP goes out through Party XP (the full amount to each member, with its chat card),
  and a trophy is only placed when the party has a character to give it to. Taking a name off the
  list doesn't take the XP back;
- the **Vault** holds gear (the Vault box on the Overview tab). Drop gear on the Bastion
  sheet to store it (GM only): gear a character holds is moved out of their pack, anything else
  is copied in, and gear that would pass the Vault's slots is refused. The button on a stored
  item hands it to a character of the party. A stack takes the slots it takes on a character
  (per-slot quantity and slots used). Each move is a copy first and a delete second, so an item
  is never in two places and never lost;
- the **Stable** means a mount **stabled** there needs no grazing or rations: pick the bastion
  in the Care box on the mount's sheet ("Stabled at") and the starvation warning stays off
  while the Stable stands. The days-since-food counter is still yours to keep, and water is
  still needed;
- the **Aviary** sends a message a day by pigeon: the Aviary box on the Overview tab (GM)
  asks who it is for (everyone, or one player, as a whisper the GMs also see) and what it says,
  and posts it from the bastion. A day is a world-clock day; the pigeon is ready again the next
  one, and a message that couldn't be posted doesn't use the day up;
- the **Infirmary** is named on the month's disaster roll: when it comes up pestilence, the chat
  message adds that the patients make the check with advantage. The check itself is still
  rolled at the table;
- the **Armorer**, the **Blacksmith** and the **Trading Post** are shops: each finished room
  puts a button in the Shops box on the Overview tab (GM) that opens a shop window. The
  Armorer sells ordinary armor, the Blacksmith ordinary weapons and the Trading Post basic
  gear, from the same gear the Merchant Shop's Catalog lists, each at a markup over its list
  price (rounded to the copper). Pick which character of the party buys, search, set a
  quantity and Buy: the gold is taken from their purse and the item is added to their sheet.
  Magic items are never sold here. The sale is run by the GM; it does not touch the Merchant
  Shop that may be open at the same time.

The rest the sheet records and you rule on at the table.

**Plan.** The bastion drawn two ways:

- **Exterior**: the main building in the middle, each upgrade's own building set
  round it, a moat ring under the lot if you've built one.
- **Interior**: one connected compound seen from above. A House is a hall and
  rooms off a corridor; an Outpost a palisade yard with rooms along the north
  range and either side of the gate; a Keep three floors (ground, second, roof);
  a Castle rooms lining the inside of the curtain wall round a courtyard. Each
  upgrade is a room. Rooms still to be built show as a dashed plus for as many
  upgrades as the type has room for.
- **Roofs** (interior view): each room shows its exterior over its tile, so you see
  the compound from outside; hover a room to lift its roof.

Scroll to zoom, drag to pan and double-click to reset. Hover a room for a card with
its outside and inside art, cost and effect. **Shift-click** a room to take it
down. **SVG** and **PNG** save the plan as it's shown, for a handout or a map.

An upgrade keeps the place it took when you built it, whatever you take down
later. Upgrades being built are drawn faint.

**Log.** Every build, repair, disaster and change, by week.

---

## The panel

**Bastions** (a button on the crawl bar once the world has one, and in the Actors
directory's right-click menu on a party actor) opens a panel with a card for each
bastion you can see, or just the party's: its art, type and week, hit points,
treasury, upgrades built and building. **Open** opens the sheet. The GM also gets
**Pay in** and **Pay out** on each card, and **New bastion**, which makes a House
owned by the panel's party when it was opened for one. The panel redraws as
bastions change. Players see the bastions they have at least Observer permission on.

---

## The monthly disaster

Each month the GM rolls for a disaster, and a bad roll opens a second table of
four. The Player's Guide to the Western Reaches prints both; the sheet's
**Roll the month's disaster** button rolls them, posts the result to chat and
writes it to the log.

Only the damage is applied for you (a natural disaster takes hit points off the
bastion); an approaching warband or dragon, and a pestilence's check, are the
GM's to run.

---

## For macros

`game.shadowdarkEnhancer.bastion` creates a bastion, opens its sheet and reads its
state, its party (and a party's bastions) and its finished upgrades, so other features
can read a bastion's effects. See
the [API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#bastion--bastions).
