# Zone Combat

[← Wiki home](index.md) · [Backdrop](Backdrop.md) · [Encounter Battle Maps](Encounter-Battle-Maps.md)

Zone combat is a fight with no battle map. A board of three bands, **Far**,
**Near** and **Close**, is drawn over the [Backdrop](Backdrop.md) for everyone
while the fight lasts, and each fighter stands in one band. Everything else is
real Foundry: real actors with their own hit points, and one real Combat in the
normal Combat tracker with real initiative and turns.

---

## What it is

- **One Combat, shown on every scene.** The fight is a single Combat that is not
  tied to a scene, so it appears in the tracker wherever the table is. Only one
  zone fight can exist at a time.
- **The party is in it.** The party's members are the first combatants, all in
  Close. When there is no party, the characters of the players who are connected
  are used instead.
- **Every foe is its own copy.** Each foe is a real copy of a creature, so two
  goblins have separate hit points. The copies are named "Goblin 1", "Goblin 2"
  and so on, and are kept in an actor folder called **Zone fight foes**. Players
  get no access to them.
- **The board is drawn from the Combat.** It is rebuilt from the fight's own
  documents, so a reload or a player who joins late sees the same board.

## Starting a fight

- **From a rolled encounter.** The Encounter panel has a **Zone fight** button
  beside Battle map. It makes one copy of the creature for each one rolled and puts
  them in the band the distance roll gives: 1 is Close, 2 to 4 is Near, 5 or 6
  is Far. With no distance roll they stand in Near. The button is grayed out
  while a zone fight is already running.
- **From the toolbar.** A GM gets a **Zone fight** tool in the Tokens group of
  the left toolbar. With no fight running it starts an empty one: the party in
  Close and no foes. While a fight is running the tool is lit, and clicking it
  asks whether to end the fight.
- **Adding a foe.** Drag an actor from the sidebar (a world actor or one from a
  compendium) onto a band. One copy is added to that band. This is mouse only.

Starting while a fight is already running is refused with a notice.

## The board

The board sits behind Foundry's windows and toolbar, over the Backdrop picture if
one is up and over a dark backing when none is. Each band lists its fighters as
chips, in turn order once initiative is rolled. A chip shows:

- the portrait and name;
- a **Turn** mark on whoever's turn it is, **Defeated** on a defeated foe, and a
  **Hidden** mark that only the GM sees;
- the actor's real status icons;
- the hit points (see below);
- the buttons that person may use: **Closer**, **Farther**, the **HP** popover,
  and, for the GM, **Defeated**.

The board header shows the round and, for the GM, the **End fight** button and a
reminder that actors can be dragged onto a band.

## Moving

**Closer** and **Farther** move a fighter one band at a time. A band is only a
place to stand, so nothing is blocked: a goblin can step from Far to Close in one
turn if you say so, and the buttons simply stop at the ends. The GM can move
anyone. A player can move only their own character.

There is no grid and no dragging between bands.

## HP and damage

- **The GM sees numbers** for everyone.
- **A player sees a foe's hit points only as a coloured bar** (Healthy, Hurt,
  Badly hurt, Near death, Down), with no numbers. The party members' numbers show
  to everyone.
- **The HP popover** takes an amount and has **Damage** and **Heal** buttons. The
  GM can use it on anyone and a player on their own character. It changes hit
  points through the system, so temporary HP is used up first, and defeat and
  dying work as they do anywhere else.
- **Defeat.** A foe taken to 0 HP is marked **Defeated** and its turn is
  skipped. The GM also has a **Defeated** toggle on each chip for a foe that runs
  away or surrenders.
- **Healing a defeated foe does not clear Defeated.** Use the Defeated toggle on its chip.
- **Hidden foes.** A foe the GM has hidden in the tracker is not shown to
  players.

## Initiative and turns

The board has no initiative or next-turn buttons. Use the Combat tracker, or the
Crawl Bar, to roll initiative and move on; the **Turn** mark follows.

## Ending

**End fight** on the board (it asks first), ending the combat from the Combat
tracker, and ending it from the Crawl Bar all do the same thing. The Combat is
deleted, loot and XP run as they do for any combat, and then the foe copies made
for this fight are deleted. Your own characters are not touched.

If Foundry or the GM's browser goes away between the two steps, the copies stay
in **Zone fight foes**. Delete them by hand; nothing sweeps that folder for you.

## What works differently

- A zone fight cannot be started while another combat is running; end that
  combat first.
- **Bring the table** to a battle map is refused with a notice while a zone
  fight exists. The Battle map button itself still works.
- **Start Combat** on the Crawl Bar is refused with a notice while a zone fight
  exists, because it would add every character on the scene a second time.
- **Add Tokens** on the Crawl Bar is refused with a notice while a zone fight
  exists, because a zone fight has no tokens.
- **Parry and Taunt** need a token target and do not work in a zone fight.
- **The system's own apply-damage buttons** in chat need a token and do nothing
  here. Use the HP popover.
- **The Crawl Strip**, which follows the fight's turn order, shows a player a
  foe's hit points as a bar only: no numbers, no armor class, no movement.
- **The session recap** counts the party as participants and the foes as enemies.
- **A hidden foe's initiative** roll does not leave a "GM privately rolled" line
  in the chat.

## Who can do what

| Action | GM | Player |
|---|---|---|
| Start a fight, add a foe, End fight | Yes | No |
| Move a character one band | Anyone | Their own character |
| Damage or heal through the HP popover | Anyone | Their own character |
| Mark a foe Defeated by hand | Yes | No |
| See a foe's hit point numbers | Yes | No, a bar only |
| See a hidden foe | Yes | No |

## Not in this release

- No grid, no free-form map and no dragging between bands.
- No tokens and no targeting by token.
- No automatic range or reach rules.
- No search picker for foes; they come from a rolled encounter or a drag.
- Nothing from Shadowdark Extras is used.
