# Party

[← Wiki home](index.md)

An explicit native roster, shared items and party quests, without Shadowdark
Extras. Open from the Actors directory, Party token HUD or Forge & Loot menu,
or `game.shadowdarkEnhancer.party.open(party)`; it also works with no canvas.

## The sheet

One band across the top: the party's tile, name and four numbers (members, HP,
AC, level), and on the right the [Marching order](#formation-deploy-and-follow).
Under it the tabs: **Members**, **Items**, **Travel**, **Quests** and
**Description**.

**Members** are two-column cards: portrait, name and class, an HP bar with
numbers, AC / LV / SLOTS / XP chips, the six ability modifiers as one small
line, and the member's active effect icons. Hirelings and mounts omit the
character-only chips. Characters, Hirelings and Mounts are grouped; click a
portrait or name to open the sheet, and a manager sees a remove (x) on hover.

The sheet has a GM view and a player view. A player (anyone who cannot manage
the party) sees every member's full stats, but not the **Travel** tab, the
**Place / Recall** pin, remove (x), item and coin editing, or the emblem. The
Marching order switch shows as read-only status. **Camp** and **Carouse** live
under Travel, which is the GM's.

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
follow behind the grid. When following stops (a blocked path, combat, a scene
change, a teleport, a missing member) the status line says why, and a manager
gets a **Resume following** button next to it (combat is the exception: nothing
resumes during combat). The pin button beside the grid is **Place / Recall**.
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

Placement uses wall-safe slots, nearest safe space, then stacking if cramped.
A token whose full footprint cannot fit is named and left packed. Native leader
movement drives ordered follower movement, never direct teleportation through
walls. A visible pause/Resume covers obstruction, combat, missing leader,
scene change, teleport and reload. Resume starts a fresh path. Combat blocks
both deploy/gather. Owner token actions use the authenticated GM relay without
an approval dialog; if no GM is connected they stop and say so.

On dungeon scenes the Party mirrors a current valid shared/member light without
another fuel consumer; an extinguished token does not revive its prototype's
light. On hex scenes token light is suppressed without rewriting stored vision.
Deployed Party movement does not also trigger aggregate travel/encounters.

## Quests, items and activities

The window displays party-assigned and member-personal [quests](Quest-Log.md),
filtered by ordinary permissions. Items are the actual embedded Party inventory;
this feature does not add a treasury/trade/container transfer subsystem.
The **Travel** tab contains [Camping](Camping.md) and [Carousing](Carousing.md)
controls in the sheet: select each PC's task and ability, confirm their choices,
then lock and roll. Results and food/fuel decisions stay in the same tab;
**Camp** and **Carouse** (the two buttons at the top of Travel, and the
`camping.open` / `carousing.open` API) switch to it rather than opening another
window. Travel is the GM's tab.
The **Quests** tab uses the existing Quest Log's status tabs, objectives and
rewards, scoped to this Party and its PCs. GMs create/edit quests and confirm
payouts inline; players retain the normal read-only quest permissions. New quests
remain Hidden until the GM changes their status. **Description** edits and saves
Party notes inline, with a cancel option.
Selected-party XP, encounters and travel use this roster rather than guessing
the first Party or auto-enrolling all world PCs.

See [Hex Maps](Hex-Maps.md#standing-on-its-own-optional-extras-seams) for optional
Extras ownership guards and the retained map-authoring integration.
