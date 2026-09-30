# Clock and Calendar

[← Wiki home](index.md)

The date, the time and the sky sit at the top of the screen for everyone,
on every hex map. On any other scene the bar is hidden and the
[Crawl Strip](Crawl-Strip-and-Crawl-Bar.md) takes the top instead. A hex map is
any scene with a hex grid; it does not have to be tagged. Viewing another
scene shows or hides the bar at once. No calendar module is needed: this is
the world's own clock, on Foundry's calendar.

---

## The bar

Left to right:

| Part | Who | What it does |
|---|---|---|
| **⏪** | GM | Opens a column of steps back: a day, 8 hours, an hour, 10 minutes, a round. |
| **Month** | everyone | Opens the month view (below). |
| **Time** | GM | Opens the Time panel (below). |
| **The date** | everyone | Weekday, day, month and year, then the time. **Stopped** follows the time while an encounter holds the travel clock. |
| **⌃ / ⌄** | everyone | Shows or hides the sky. |
| **Travel** | on a hex map | The hexes left today while travelling, or **Start travel** for a GM. The party icon opens the Travel panel. |
| **⏩** | GM | Opens a column of steps forward, the same five. |

It hides during a combat and on any scene without a hex grid. **Settings →
Overland → Clock bar** chooses who sees it on a hex map: everyone, the GM only,
or nobody.

## The sky

Under the bar, the season, then the dial: a disc that turns once a day, with
now always at the bottom under the star. Daylight is the light part, the
twilight around sunrise and sunset is hatched, and night is dark with its
stars. The day's weather sits on the plate in the middle, with the next
sunrise or sunset under it; while travelling, the region and terrain too. The
moon rides the dashed outer track by its phase.

The season band fills with a hatch from the right over a season's last 30
days; hover it for how many days are left.

## Moving the clock (GM)

- **Steps** (⏪ and ⏩) move the clock as play does: lit torches burn.
- **Jump to the next** dawn, noon, dusk or midnight, in the Time panel.
- **Set date and time**, in the Time panel, to any date and year.
- **A day in the month view** moves there, at the same hour.

A date set or picked in the month view is a calendar jump: forward, it goes
off duty, so torches carried by the party are put out rather than burnt
through. Going back never burns anything.

While travelling, every move forward rolls the day's encounter checks it
passes, at their hours, as a move across the map does; a hit stops the clock
there, and the steps wait until the encounter is continued.

### Walking a hex takes its time

The party token walks as long as the clock takes to move it. A normal hex is
about a second on screen, and a difficult hex, which costs two points, is
about a second and a half. The clock runs alongside, in small steps,
so the date and time on the bar, the sky's darkness and the burning torches
all keep pace with the token instead of jumping at the start. A route across
several hexes walks them one after another.

**Make camp** and **Continue** run the rest of the night, or of a stopped move, as
a time-lapse: a beat plus a share of the span, never more than about three
seconds. The bar's time, the sky's darkness (dusk falling, dawn lifting) and the
torches all run through it, and an encounter check still rolls at its hour and
stops the clock there.

When the party's scene is not the one on the GM's screen there is nothing to
keep pace with, and the clock moves in one step as before. So do the clock bar's
own steps and jumps.

## Encounters while travelling (GM)

Travel's encounter checks roll quietly: nothing goes to chat, the game isn't
paused and no window opens. When one hits, the **Encounter** panel drops from
the bar for every GM, and the travel plate says **Encounter** until it's done.
The panel shows:

- the check: its step (6 by day, 8 at night), its hour and its chance;
- the tables it went through, each with its roll: the region's encounter zone,
  the category it named, and that region's table for the category;
- what turned up: how many, with their number-appearing dice, or a point of
  interest's text;
- the distance, activity and reaction rolls, in words.

Only the GMs see it. **Post to chat** shows the players the encounter card.
**Encounter Roller** opens the roller to roll again, set CHA or renown for the
reaction, or place the tokens. **Continue** clears it and runs the rest of the
clock.

The chevron at the panel's top right folds it into a strip under the bar:
**Encounter**, the check's hour and what turned up (a point of interest's text,
shortened). The strip stays while the encounter is held, above the sky or
whichever panel you open meanwhile. Its chevron opens the panel again, and its
**Continue** is the panel's.

How often the checks come is yours to change: **Adjust** in the Travel panel's
Encounters step sets the chance (1 to 5 in 6, one more on a pushed day) and the
checks by day and by night (0 to 4 each; the book's is 1 in 6, two and two). A
new chance counts from the next check, a new number of checks from the next
Start day. **Roll a check now** rolls one more at this hour, quietly; a hit
opens the panel.

The Time panel's **Clock runs in real time** is Shadowdark's own light
tracking clock: a second a second, paused with the game when the system says so.

## The month view

The month's days, a week to a row, with the moon's new, first quarter, full
and last quarter marked, today framed, and the City of Masks holidays on their
days once they're imported (**Importer Hub**, the Cursed Scroll 6 holidays).
**‹** and **›** turn the months. A GM clicks a day to go there.
