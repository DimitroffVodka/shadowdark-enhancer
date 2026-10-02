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

| Type | Cost | AC | HP | Upgrades | Build time |
|---|---|---|---|---|---|
| House | 200 gp | 12 | 40 | 3 | 1 week |
| Outpost | 300 gp | 15 | 50 | 5 | 2 weeks |
| Keep | 1,000 gp | 18 | 100 | 10 | 1 month |
| Castle | 5,000 gp | 18 | 300 | 20 | 2 months |

- **House**: a sturdy domicile, a cabin or cob hut.
- **Outpost**: a fortified camp behind a 15' wooden palisade.
- **Keep**: a 60' tower of three floors, with one siege weapon on the roof.
- **Castle**: 30' crenellated walls round a keep and inner courtyard; the walls
  fit 8 siege weapons (not trebuchets).

Ordinary weapons can't hurt a bastion. Siege weapons, fire, storm, earthquake and
huge creatures can. At 0 HP the walls are breached. Repair takes a week and 1 gp
per HP. A bastion shelters you from weather, climate and random encounters.

---

## The sheet

**Overview.** The type, the party that owns it, AC, hit points, the treasury, how
many of its upgrade slots are used, and what it is worth. Under the build clock:
**Advance a week** finishes the bastion and its upgrades as the weeks pass,
**Repair** pays 1 gp per missing HP and mends them after a week, and **Roll the
month's disaster** rolls the d6 (and on a 1 the d4) and posts it to chat.

**The party and the treasury.** Pick the **Party** that owns the bastion (Extras'
party, or the Enhancer's own). **Pay in** moves gold from a character's purse into the
treasury, and **Pay out** moves it back to a character. The dialog lists the party's
members, or every player character when the bastion has no party or its party lists
none. The gold is whole, comes out of silver and copper first, and a payment that
can't complete on both sides is put back. You can still type the treasury yourself.
Extras keeps a party's own coins in its own data and offers no way to change them, so
the party's stash isn't touched: a member pays from their own purse.

**Upgrades.** All twenty, with their art. **Build** takes the cost from the
treasury and starts a week of work. You can't build one that's already there,
beyond the type's slots, before the bastion stands, or without the gold. **Take
down** frees the slot and refunds nothing; the other upgrades keep their places.

| Upgrade | Cost | Effect |
|---|---|---|
| Aviary | 100 | Send one message per day via pigeon |
| Armorer | 200 | Buy any ordinary armor at +10% cost |
| Barracks | 200 | Warbands heal +1d6 HP while here |
| Blacksmith | 100 | Buy any ordinary weapons at +10% cost |
| Brewery | 200 | +1 to carousing event rolls within the bastion |
| Casino | 300 | Generates 2d20 gp per month |
| Dungeon | 300 | Underground prison and tunnels |
| Granary | 100 | Warbands each cost 10 gp less in the bastion |
| Idol | 400 | +1 to CHA spellcasting checks in the bastion |
| Infirmary | 200 | Patients have ADV on CON checks |
| Kennels | 300 | DISADV on checks to sneak into the bastion |
| Library | 400 | +1 on downtime learning checks |
| Moat | 200 | 20' wide and deep; includes a drawbridge |
| Stable | 100 | Mounts don't need to graze or eat rations |
| Tavern | 400 | PCs can carouse in the bastion (100 gp limit) |
| Temple | 400 | +1 to WIS spellcasting checks in the bastion |
| Trading Post | 100 | Buy any basic gear at +10% cost |
| Trophy Room | 100 | Gain 1 XP for each notable trophy placed |
| Vault | 200 | Securely store up to 100 gear slots of items |
| Wizard Tower | 400 | +1 to INT spellcasting checks in the bastion |

Eight effects are applied for you while the bastion stands:

- the **Granary** makes each warband [garrisoned](Warbands.md) there cost 10 gp less a month;
- the **Barracks** heals each of them 1d6 more a day;
- the **Casino** earns **2d20 gp** into the treasury at each month start the world clock
  passes, one roll a month shown in chat and logged, each month paid once however the clock
  moves. A Casino that finishes part way through a month earns from the next month start. If
  the treasury can't be saved, the GMs get a card with the gold to add by hand;
- the **Library** gives **+1** to the downtime checks about learning (Martial Training and
  Magical Research) for the members of the party that owns the bastion, on the Downtime
  window's rolls and shown on the chat card as "Library +1". Members are the linked party's
  (every player character if the party lists none); two Libraries don't stack;
- the **Trophy Room** gives each member of the party **1 XP** for each notable trophy you place
  (the Overview tab's Trophies box, GM only: name it and place it). The name is kept on the
  bastion, the XP goes out through Party XP (the full amount to each member, with its chat card),
  and a trophy is only placed when the party has a character to give it to. Taking a name off the
  list doesn't take the XP back;
- the **Vault** holds up to **100 gear slots** of items (the Vault box on the Overview tab).
  Drop gear on the Bastion sheet to store it (GM only): gear a character holds is moved out of
  their pack, anything else is copied in, and gear that would pass 100 slots is refused. The
  button on a stored item hands it to a character of the party. A stack takes the slots it
  takes on a character (per-slot quantity and slots used). Each move is a copy first and a
  delete second, so an item is never in two places and never lost;
- the **Stable** means a mount **stabled** there needs no grazing or rations: pick the bastion
  in the Care box on the mount's sheet ("Stabled at") and the starvation warning stays off
  while the Stable stands. The days-since-food counter is still yours to keep, and water is
  still needed;
- the **Aviary** sends **one message a day** by pigeon: the Aviary box on the Overview tab (GM)
  asks who it is for (everyone, or one player, as a whisper the GMs also see) and what it says,
  and posts it from the bastion. A day is a world-clock day; the pigeon is ready again the next
  one, and a message that couldn't be posted doesn't use the day up.

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

Each month the GM rolls a d6; on a 1 they roll a d4:

1. **Enemy warband**: an army of 2d8 enemy warbands approaches.
2. **Natural disaster**: fire, storm or earthquake does 1d100 damage. The sheet
   applies it to the bastion's hit points.
3. **Pestilence**: every resident makes a DC 12 CON check or contracts rat disease.
4. **Dragonstrike**: a hostile dragon approaches, and retreats below half its HP.

The roll goes to chat and the log. Only the damage is applied for you; the rest is
the GM's to run.

---

## For macros

`game.shadowdarkEnhancer.bastion` creates a bastion, opens its sheet and reads its
state, its party (and a party's bastions) and its finished upgrades, so other features
can read a bastion's effects. See
the [API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#bastion--bastions).
