# Party

[← Wiki home](index.md)

An explicit native roster, shared items and party quests, without Shadowdark
Extras. Open from the Actors directory or Party token HUD,
or `game.shadowdarkEnhancer.party.open(party)`; it also works with no canvas.

## The sheet

One band across the top: the party's emblem tile, name and four numbers
(members, HP, AC, level), and on the right the
[Marching order](#formation-deploy-and-follow).

The **emblem** is a picture of the party: a game-icons.net icon on a coloured
tile. A GM clicks the tile to open a picker of 24 icons and 8 colours and the
choice applies as it is made. A party that has chosen nothing wears the lantern
in amber. It is stored on the Party actor (`flags.shadowdark-enhancer.partyEmblem`,
`{ icon, color }`), so it survives reloads and is the same for everyone. The icons
are bundled with the module (credited in CREDITS.md); the picker does not need the
Game-icons.net module. Only the sheet's tile changes: the Party token's art on a
map is not tied to it.

Under the header, a thin status bar shows up to three readouts, and each one is
left out when its data is not available (with none, the bar is hidden):

- **Today**: terrain, weather and hexes left, while this Party is the one
  travelling overland with a day open ([Hex Maps](Hex-Maps.md)). Terrain
  that is not known is omitted.
- **Light**: the burning light source with the most time left among the Party
  and its characters and hirelings, and its minutes. Nothing lit, nothing shown.
- **Rations**: the "Rations" stacks (Basic items) on the Party and its
  characters, the food camp spends. It is hidden when a member's items are
  hidden from you, because the total would be a partial one.

Under it the tabs: **Members**, **Items**, **Travel**, **Quests**, **Bastion**
(only when the Party has a bastion) and **Description**.

**Members** are two-column cards: portrait, name and class, an HP bar with
numbers, AC / LV / SLOTS / XP chips, the six ability modifiers as one small
line, and the member's active effect icons. Hirelings and mounts omit the
character-only chips. Characters, Hirelings and Mounts are grouped; click a
portrait or name to open the sheet, and a manager sees a remove (x) on hover.

**Bastion** lets the whole table look at the Party's [bastion](Bastions.md): the
Bastion actor whose Party field is this Party (a Bastion the viewer cannot observe
is not offered, and with none linked the tab is hidden). It shows the name, type
and art, AC, HP, rooms used out of slots, the treasury, a chip for each room (a
dashed chip is still being built), and last month's result: the newest monthly
disaster roll or Casino income in its log. One button, **Open bastion** for a GM
and **View bastion** for players, opens the bastion sheet, which is read-only
for anyone but the GM.

The sheet has a GM view and a player view. A player (anyone who cannot manage
the party) sees every member's full stats and the same tabs, but not the
**Place / Recall** pin, remove (x), item and coin editing, or the emblem picker.
The Marching order switch shows as read-only status. **Camp** and **Carouse**
live under Travel, where each PC's owner confirms their own choices.

## Roster and ownership

Create a native Party (an NPC with Enhancer's boolean Party flag), then add
Characters, Hirelings and Mounts by UUID. A Party OWNER manages its roster,
leader, formation and follow choices. Adding a new character
requires OWNER on that character. Party ownership does not authorize spending
another PC's coins or selecting their camping/carousing result.

Missing/deleted/compendium references remain visible missing rows, never matched
by name or silently removed. Removing a member removes only membership/leader/
slot references, not the Actor, token, inventory or history. Characters may be
in more than one Party; the selected activity uses one explicit Party.

Legacy flagged NPC Parties adopt in place: UUID, ownership, items and foreign
flags stay intact. Extras `type: Party` documents are not converted. Native
values win conflicts; repeated adoption does not overwrite edited values.

## Party token

The Party's token stands for the whole group on a scene. It is the token that
travels on a hex map, and the one Deploy, Recall and the HUD act on.

- **Where it comes from.** Create the Party actor yourself, or let the first
  **Start travel** on a hex map make one: with no Party in the world, no party
  token on the scene and nothing selected, a GM gets a new Party and its token in
  the hex at the centre of the view. If the world has Parties already, travel
  never picks the first or makes another; choose one. When exactly one
  Shadowdark Extras party exists, its token is used and no native Party is made.
- **What it looks like.** A friendly, linked token. On a hex map, Start travel
  gives it the black Party hex, one cell wide with no ring and no rotation. Only
  that scene's token changes: the actor keeps its portrait everywhere else. A
  larger token shrinks onto the hex under its old centre. A token already wearing the
  hex is left alone.
- **Linked only.** Deploy and Recall need a *linked* Party token on the scene.
  Without one they say so rather than guess; drag the Party actor onto the scene.
- **HUD.** Selecting it shows **Open Party** (for anyone with that Party)
  and, for a Party OWNER, **Import/Export Members**. The second is greyed out
  in combat.
- **Hex maps.** It carries no light and no sight there; see
  [Hex Maps](Hex-Maps.md) and
  [which token travels](Crawl-Strip-and-Crawl-Bar.md).

## Formation, deploy and follow

The header's right side is the **Marching order**: a switch, a status line and
the 3×3 grid, which remembers nine slots. Marching order is a dungeon thing, so
it is a visible switch rather than a setting. Off, the party is "Moving freely"
and the grid dims; on, the status names who leads. Click a portrait to make that
member the leader; drag one onto another cell to arrange. Overflow members
follow behind the grid. Following has no paused state: while the switch is on
and the members are out, they follow every move the leader makes. A member who
cannot take a step (a wall, a missing token) stays where they are and the rest
carry on; the next move tries again. The formation holds while the party walks:
each member goes to their slot around the square the leader stopped on. The
grid's top row is the front: it faces the way the leader's last step went
(north, east, south or west), so turning the leader around reverses the order.
Hex maps keep the grid north-up. When a wall
is in the way they walk round it (up to ten squares) to the nearest square they
can reach, so nobody gets stranded behind a door the leader went through. Nothing follows during combat, and the
status line says so. The pin button beside the grid is **Place / Recall**.
Mounts never take a slot or follow the leader (nobody takes a mount into a
dungeon); they stay on the roster under Mounts and still eat at camp. An older
world's saved include-mounts choice is ignored.

A party with no members shows an outlined drop zone on the Members tab and a
hint under the grid: drag characters from the Actors directory onto either one
to add them.

**Place/Recall** and the Party token's **Import/Export Members** HUD entry call
the same service. Export releases linked member tokens around the Party; Import
gathers eligible linked copies on that scene regardless of distance. Other
scenes/unlinked tokens stay untouched. The Party token remains selectable.
Existing token IDs/configurations are reused; repeat Export makes no duplicates.

Placement puts each member in the grid slot around the party token, using
Foundry's own wall test (a clear line from the party token to the slot, inside
the scene), then the nearest such square, then stacking if cramped. A member
with no square at all is named and left packed. Native leader
movement drives ordered follower movement, never direct teleportation through
walls. There is nothing to pause or resume: a follower that cannot step is
skipped, a leader teleport is not followed, and reloading or changing scene
changes nothing. Combat blocks deploy, gather and following. Owner token actions use the authenticated GM relay without
an approval dialog; if no GM is connected they stop and say so.

On dungeon scenes the Party mirrors a current valid shared/member light without
another fuel consumer; an extinguished token does not revive its prototype's
light. On hex scenes token light is suppressed without rewriting stored vision.
Deployed Party movement does not also trigger aggregate travel/encounters.

## Quests, items and activities

The window displays party-assigned and member-personal [quests](Quest-Log.md),
filtered by ordinary permissions.

**Items** is the actual embedded Party inventory, with a column on its right:
the **Treasury** (gp, sp and cp, which a manager edits) and **Gems**, the
Party's items of the Shadowdark system's Gem type. A gem is worth its cost
(`system.cost`, as in the system's Gem Bag); the box lists each gem's quantity
and value and the total, quantity times value. Gems are kept out of the item list
and take no Party slots, as in the system. Quantity buttons and **New Item** are
a manager's. This feature does not add a trade/container transfer subsystem.
The **Travel** tab contains [Camping](Camping.md) and [Carousing](Carousing.md)
controls in the sheet: select each PC's task and ability, confirm their choices,
then lock and roll. Results and food/fuel decisions stay in the same tab;
**Camp** and **Carouse** (the two buttons at the top of Travel, and the
`camping.open` / `carousing.open` API) switch to it rather than opening another
window.
The **Quests** tab uses the existing Quest Log's status tabs, objectives and
rewards, scoped to this Party and its PCs. GMs create/edit quests and confirm
payouts inline; players retain the normal read-only quest permissions. New quests
remain Hidden until the GM changes their status. **Description** edits and saves
Party notes inline, with a cancel option.
Selected-party XP, encounters and travel use this roster rather than guessing
the first Party or auto-enrolling all world PCs.

See [Hex Maps](Hex-Maps.md#standing-on-its-own-optional-extras-seams) for optional
Extras ownership guards and the retained map-authoring integration.
