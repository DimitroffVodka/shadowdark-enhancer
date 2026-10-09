# Encounter Battle Maps

[← Wiki home](index.md)

On the hex map the party is one token on a six-mile hex, so a travel encounter
has nowhere to be fought. **Battle map** takes the encounter to a real battle map
for the terrain the party is in, with the party and the monsters from the roll
already standing on it, and brings the table over when you are ready.

---

## The buttons

A GM gets **Battle map** in two places:

- the **Encounter** panel that drops from the clock bar when a travel check hits
  (see [Clock and Calendar](Clock-and-Calendar.md#encounters-while-travelling-gm)).
  **Choose map…** sits beside it;
- the encounter card posted to chat. The button is the GM's; players do not see it.
  The card has **Battle map** only: to choose the map yourself, use the Encounter
  panel.

**Battle map** opens the default map for the party's terrain (see
[A default for each terrain](#a-default-for-each-terrain)). **Choose map…** opens
the picker (see [The picker](#the-picker)) so you choose the map yourself, or any
scene in your world. **Battle map** opens the picker too when the module does not
know the terrain of the party's hex, or when every map for it is switched off.

One battle is set up at a time. While there is one, the panel shows its controls
(below) in place of the two buttons, and an older chat card's **Battle map** only
tells you a battle is already set up. A GM's controls stay on the bar on the
battle's own scene and during its combat, where the clock bar would otherwise be
hidden.

## Set up, bring the table, return

### Set up

The first click. The map's scene is made the first time it is used and reused every
time after. The party's characters (the members of your [Party](Party.md)) and the
monsters from the roll are placed on it, the monsters at the distance the roll gave
them (close, near or far) on the side of the map with the most room. On the few maps
where that strip would run through water, lava or a chasm, the monsters start on the
ground across it instead, whatever the roll said. Then the scene opens for **you**, and
only you. Nobody else is moved.

A map holds one battle at a time. Setting up on a map that already has a battle
tells you so, opens that battle again and places nothing more. A character who
already has a token on the map keeps it: it joins the combat and is not taken down
when you return.

The scene is an ordinary scene. Walls, lights and notes you add to it stay for the
next battle on that map. The tokens the battle placed do not stay (see
[Return to travel](#return-to-travel)).

While you look it over, the map's art starts loading on every player's computer
(see [Preloading](#preloading)).

### Bring the table

The second click. The scene becomes the active one for everyone, and a combat is
made holding the tokens that were placed. It is **not started**: start it when the
players are in.

The button reads **Ready 3/4**, players ready out of players, and turns green when
everyone is. You can press it early. The window then asks first, and names who is
still loading.

Once the table is brought the panel says so, and says whether the combat is waiting
to start, in its round, or over.

### Change map

Until you bring the table, **Change map…** opens the picker and moves the battle's
own tokens to the map you pick. After that the button is gone: return to travel and
set up again.

### Return to travel

Puts everyone back on the hex map. It ends this battle's combat first, then takes
down the tokens this battle placed (exactly those, nothing else on the scene). If
the combat cannot be ended, or some of the tokens cannot be taken down, it stops
there, tells you, and keeps the battle (listing only the tokens that are left), so
you can press **Return to travel** again. You can return from a battle that is only
set up, or from one that is live.

Returning does not touch the held encounter. Its **Continue** button on the clock
bar is as you left it, so you carry on with the clock the way you always do.

### Keep this battle

Tick **Keep this battle** before **Return to travel** and a map from the module is
copied first, tokens and all, into a world folder called *Saved encounters*. If the
copy cannot be made, nothing is taken down and you are told.

On a scene you brought yourself (one from your world, not a map from the module)
nothing is copied. Its tokens stay on it where they are, and the combat still ends.

## Choosing the map

### The picker

Three lists, top to bottom:

1. **Maps for the terrain** the party is in, the default marked.
2. **Other maps**: every other map, with a chip for each kind of ground to narrow
   the list.
3. **Scenes in this world**: any scene you already have, with a search box. A
   scene you pick is used as it is.

Click a map to choose it, then **Use this map** (clicking the chosen map again does
the same). The map the picker starts on is already chosen, so one click on it is
enough. Hover a map to see whose art it is.

### Day, night and camp

The bar above the lists sets how the map looks. It starts as the encounter is:
Night if it happened at night, Camp if the party is camping.

- **Night** is the same map in the dark: the scene's darkness is raised to 75%. The
  players see by their torches, which light about 30 feet, so a foe at near distance
  stands at the edge of the light and one far off is out of sight. The characters'
  tokens carry the light their characters hold when you bring the table: a torch lit
  or put out while the battle was being set up counts, and one lit during the fight
  is lit by its owner as usual.
- **Camp** is separate art for the same ground, with the camp set out and its
  fire lit. It is greyed out for a map that has no camp version. River, lake,
  ocean and arctic sea maps have none: the boat is the camp.
- A camp at night is both switched on. The fire is a light on the map, in the
  middle of the camp, and it lights about 30 feet around it: with the
  characters' torches out it is the only light, and the foes come out of the dark
  beyond it. The light follows the party's own camp: while the camping window
  says its fire is burning it is lit, and when that fire was never lit or has gone
  out the light is put out and the camp is dark. A camp you pick by hand, with no
  camp made in Overland, has its fire lit. The light stays on the map when it is
  out, so you can switch it on yourself.

A scene from your world is used as it is, so these go quiet while one is chosen.

### On the water

On a river, lake, ocean or arctic sea the party is in a boat, so the characters
start on the boat's deck.

### A default for each terrain

Until you say otherwise, **Battle map** opens the first map on the list for a
terrain. On that list the GM has three controls:

- the **pin** on a map makes it the default for that terrain;
- the **eye** switches a map off for that terrain;
- **Pick at random**, above the maps, makes **Battle map** open one of the maps
  that are on, a different one each time, instead of a fixed default. While it is
  on no map is marked Default, and each map that is on says Random. Turn it off
  and the first map that is on becomes the default again.

The pin on the pinned map takes the pin off, which is the same as Pick at random.
Pinning a map that is off switches it on. Switching a map off never changes which
map is the default, unless it is the default itself: then the next map that is on
takes over, and a terrain set to random stays random. When every map for a terrain
has been switched off, the first one you switch back on becomes the default. A map
that is off is only left out of the default: you can still choose it in the picker
for one battle. If every map for a terrain is off, **Battle map** opens the picker
instead.

## Preloading

Foundry can load a scene's art ahead of time but cannot tell you who has finished.
While you set a battle up, the module starts loading the map's art on every
connected player's computer and shows a readout with a line for each player:
Waiting, Loading (how many files of how many), Ready, Failed, or Stalled when a
player's loading has made no progress for a minute and a half. A player who leaves
is not counted, and a player who joins while the art is loading is asked to load it
too. If you reload your browser while a battle is set up, the readout starts again by
itself.

**Preload battle maps for players** in Configure Settings turns it off. It is on
by default. With it off nothing is loaded ahead of time, and the table still moves
when you press **Bring the table**.

## Art credits

The maps are art by 2-Minute Tabletop, used under CC BY-NC 4.0. Hover a map in the
picker to see the products it is made from. Every shipped map is listed in
[CREDITS.md](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/CREDITS.md).

## For macros

`game.shadowdarkEnhancer.encounterMaps` opens a battle map, asks for a choice,
brings the table and returns it. See the
[API](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#encountermaps--battle-maps-for-encounters).

---

**Related:** [Random Encounters](Random-Encounters.md) · [Clock and Calendar](Clock-and-Calendar.md) · [Party](Party.md) · [Settings Reference](Settings-Reference.md)
