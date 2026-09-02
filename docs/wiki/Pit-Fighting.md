# Pit Fighting

[← Wiki home](index.md)

Run Cursed Scroll 2's pit fights in the book's intended order: roll the venue,
determine the stakes against party level, choose the danger level, draw the foe,
and manage a secret twist until the bout begins.

Open it from the Crawl Bar's **Forge & Loot** menu → **Pit Fighting** (GM only).

---

## Before you start: import the tables

The pit fight roller provides the dice logic and threshold math. All narrative
text—venues, twists, stake descriptions, prize tables, and monster rosters—is
read directly from RollTables you import from your copy of Cursed Scroll 2 via
the [Importer Hub](Importer-Hub.md).

The roller looks for six table sets:

- **Venue** and **Twist** (2d6 tables)
- **Pit Fight encounters:** Solo and group encounter tables across three danger
  tiers (6 tables total)
- **Prize tables:** Low, Mid, High, and Epic Stakes (4 tables total)

CS2 also prints **Stakes** and **Tonight's Crowd**. The module calculates stakes
thresholds mathematically (`Party APL + 1d6`), so importing that lookup table is
optional. **Tonight's Crowd** provides flavor text you can roll manually.

If any tables are missing, the window lists them with direct links to the
importer. You can still roll without imported tables; missing text simply falls
back to raw die rolls and row numbers.

---

## Setting up a bout

### The offer & party level

The bout window builds the offer before individual fighters volunteer:

1. **Party APL:** The roller calculates the average player level across your
   entire active party (displayed with unrounded numbers for reference).
2. **Roll the whole offer:** Rolls venue, stakes, foe, and twist in one click.
   You can also roll or select individual elements separately.

| Element | Dice | What it determines |
|---|---|---|
| **Venue** | 2d6 | The fighting arena |
| **Stakes** | Party APL + 1d6 | Value tier: Low, Mid, High, or Epic |
| **Size** | Toggle | Solo or Group bout (selects encounter table) |
| **Danger** | Selector | Danger tier (pre-set to stakes suggestion) |
| **Foe** | Table draw | Opponents faced (click **Draw** to redraw) |
| **Twist** | 2d6 | Secret complication (kept hidden until revealed) |

### Stakes, size, and danger

- **Size (Solo vs Group):** Toggle this button to pick between CS2's solo and
  group encounter tables.
- **Danger tier:** The dropdown suggests a danger level based on stakes, but you
  can change it to fit your narrative. Choosing a different tier redraws the foe
  from that tier's table.

### Who steps up (accepting or declining)

Under **Who steps up**, check the boxes for each character entering the ring:

- Click **Accept the bout** to commit the fighters.
- Click **Decline** if they refuse. The refusal is recorded on screen because
  CS2 rules note that refusing bouts may impact future invitations.

---

## Putting it on the table

### Resolving and placing foes

The drawn foe displays CS2's raw text (for example,
`2 hero* | 2 lion | 30' deep pits`) and matches creatures against your
installed compendium packs.

1. Review the creature list below the foe description. Matched creatures show a
   green checkmark.
2. Click **Place** to drop tokens directly onto your active scene.
3. Click on the canvas to place each creature in sequence. Notifications announce
   what the next click will place.
4. Press `Escape` at any time to cancel remaining placements.

Name matching accommodates CS2 abbreviations automatically (such as `Gt. centipede`
matching **Centipede, Giant** and `2 hero*` stripping footnotes and counts).
Rival adventuring parties (such as `2d4 rival crawlers`) are narrative NPCs and
are skipped by automated token placement.

### Choosing an arena battle map

Click **Arena map…** to open one of twelve bundled battle maps (2-Minute Tabletop,
CC BY-NC 4.0; see CREDITS) created as dedicated scenes in your world.

The map picker prioritizes maps matching your rolled venue:

| Rolled Venue | Recommended Maps |
|---|---|
| Shady back alley or tavern cellar | Back Alley (Day/Night), **Tavern Cellar**, Small Arena |
| Cage fight, small arena | Small Arena |
| Open-air, large arena | Large Arena, Open-Air Arena: Greybanner, Desert (Day/Night) |
| Luxurious private arena | Private Arena (Day/Night) |
| Glorious coliseum | Glorious Coliseum (Day/Night) |

Other maps remain selectable under **Other maps**.

Re-selecting a previously opened arena map loads your existing, customized scene
rather than duplicating it.

### The Tavern Cellar (multi-level pit)

Selecting **Tavern Cellar** creates a two-level scene using Foundry scene
levels:

- **Vault level:** 0–20 ft elevation.
- **Fighting pit:** 20–40 ft elevation, with a central opening looking down
  into the vault below.
- **Cellar Stair region:** Spans both levels. Walking a token into the stair
  prompts Foundry's native level transition without switching scenes.

Foundry triggers region transitions on standard token moves; teleporting or
dragging tokens across the canvas bypasses the trigger.

---

## The secret twist

### Keeping it hidden

The twist is rolled during setup and kept hidden from chat, even when the outcome
is *nothing happens*. This prevents players from deducing whether a surprise is
waiting.

### Revealing and mechanical effects

- Click **Reveal** to post the twist to chat when the moment arrives.
- If the twist requires a sub-roll (such as rolling 1d4 for details), it is
  pre-rolled and included automatically.
- **Donor twists:** If a twist raises the stakes, the roller automatically
  steps up the **prize table** tier without altering the agreed combat danger.

---

## Resolving the fight & rewards

### Outcome & prize tables

Once the combat concludes:

1. Mark the bout **Won** or **Lost**.
2. Roll the **Prize table** button for the final stakes tier.

### Renown awards

CS2 awards fame for pit fights without fixing a strict number. The roller
defaults to:

- **+1 Renown each** for a victory.
- **0 Renown** for a defeat.

You can adjust the **Renown each** field to match the fight's significance.

### Applying the result

Click **Apply the result** to:

- Post a summary card to chat.
- Award renown to participating characters through the module's single write path.
- Log renown awards directly to the [Session Recap](Session-Recap.md).

Award XP and physical loot separately using [Party XP](Party-XP.md) and standard
item distribution.

---

## Rules & rulings at the table

### Setting lethality

CS2 links lethality to venue and stakes (such as fights to half HP, knockouts, or
rare bouts to the death). Lethality is left to GM adjudication; the roller tracks
encounters and rewards without forcing death saves.

### CS2 arena monsters (page 39)

Three arena creatures—**Rookie**, **Hero**, and **Canyon Ape**—are published in
Cursed Scroll 2 (page 39) rather than the core rules. Import their stat blocks via
the [Importer Hub](Importer-Hub.md) to enable automatic token placement.

### State persistence & rerolls

- **Bouts survive window closure:** You can close the pit fighting window, run
  the entire battle on the canvas, and reopen it later. The active bout, stakes,
  and volunteer status remain stored in world state.
- **New offer:** Clears the active bout and generates a fresh setup.
- **Draw:** Redraws only the monster encounter without altering venue or stakes.

---

## See also

- [Renown](Renown.md) — How fame awards and status bands function
- [Downtime](Downtime.md) — Downtime activities and inter-crawl options
- [Importer Hub](Importer-Hub.md) — Importing tables and monster stat blocks
- [Random Encounters](Random-Encounters.md) — Wilderness and dungeon wandering checks
