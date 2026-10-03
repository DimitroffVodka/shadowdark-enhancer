# Party

[← Wiki home](index.md)

An explicit native roster, shared items and party quests, without Shadowdark
Extras. Open from the Actors directory or Party token HUD,
or `game.shadowdarkEnhancer.party.open(party)`; it also works with no canvas.

## Roster and ownership

Create a native Party (an NPC with Enhancer's boolean Party flag), then add
Characters, Hirelings and Mounts by UUID. A Party OWNER manages its roster,
leader, formation, follow and include-mounts choices. Adding a new character
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

The fixed 3×3 header widget remembers nine slots. Click a portrait to choose the
leader; drag it to another slot. Overflow members follow behind the grid, then
included mounts. **Follow leader** selects Marching Mode versus Free Movement;
mount inclusion affects deployment, not roster membership or daily food.

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
**Camp** and **Carouse** switch to it rather than opening another window.
The **Quests** tab uses the existing Quest Log's status tabs, objectives and
rewards, scoped to this Party and its PCs. GMs create/edit quests and confirm
payouts inline; players retain the normal read-only quest permissions. New quests
remain Hidden until the GM changes their status. **Description** edits and saves
Party notes inline, with a cancel option.
Selected-party XP, encounters and travel use this roster rather than guessing
the first Party or auto-enrolling all world PCs.

See [Hex Maps](Hex-Maps.md#standing-on-its-own-optional-extras-seams) for optional
Extras ownership guards and the retained map-authoring integration.
