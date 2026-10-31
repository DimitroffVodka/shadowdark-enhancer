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
| **Travel** | on a hex map | While travelling, a counter: how the party travels (on foot, mounted, by boat), then the day's movement points left over the day's total, with a double chevron when pushing. Hover it for the words. Before a day is open it reads **No day**, and when an encounter holds the travel clock it is lit and reads **Encounter**; its tooltip says to run it and press Resume clock. A second chevron shows while Auto travel is on. Or **Start travel** for a GM. |
| **Torches and rations** | on a hex map, with a party | The party's fresh torches (unlit and unused, magic ones left out) and its rations, counted across the party sheet, every member's pack and every mount's: the same stacks a camp spends. Hover each for the words. |
| **Find the party** (crosshairs) | anyone who can see a party | Pans the map to the party token, pulses on it (on your screen only) and selects it. If the token is on another scene it names the scene. With several parties it finds the selected one, else the one travelling; if neither is known it asks you to select one rather than guess. |
| **Party sheet** (shield) | anyone who can see a party | Opens the party sheet (the picker when there are several parties). |
| **The date** | everyone | In the middle of the bar: weekday, day, month and year, then the time. |
| **⌃ / ⌄** | everyone | A small, quiet chevron beside the date: shows or hides the sky. |
| **⏪** | GM | Opens a column of steps back: a day, 8 hours, an hour, 10 minutes, a round. |
| **Weather** (cloud) | everyone | Turns the weather drawing off and on for this device only (the Show weather effects setting); the scene keeps its weather and everyone else still sees it. A bare cloud, lit, means it is off here. |
| **Time** | GM | Opens the Time panel (below). |
| **Auto On / Auto Off** | GM, or the party sheet's owner, while travelling | The standing Auto travel switch: on, a clicked far hex is walked over as many days as it takes (see [Overland travel](Crawl-Strip-and-Crawl-Bar.md#automatic-travel-one-click-to-a-far-destination)). Lit when on. |
| **Travel panel** (the party icon) | on a hex map | Opens the Travel panel. |
| **⏩** | GM | Opens a column of steps forward, the same five. |

It hides during a combat and on any scene without a hex grid. **Settings →
Overland → Clock bar** chooses who sees it on a hex map: everyone, the GM only,
or nobody.

## The sky

Under the bar, the season plate (the season, the **Month** button that opens
the month view below, and today's weather), then the dial: a
half disc that turns once a day inside a ring of hour ticks, with now always
at the bottom under the star (hover it for the time). Daylight is the light
part, the twilight around sunrise and sunset is hatched, and night is dark with
its stars. Sunrise and sunset are badges on the hour ring that turn with the
disc; hover one for its time. While travelling, the region and terrain are
written across the disc, wrapping when the name is long. The moon rides the
dashed outer track by its phase.

The season plate fills with a hatch from the right over a season's last 30
days; hover it for how many days are left.

## Moving the clock (GM)

- **Steps** (⏪ and ⏩) move the clock as play does: lit torches burn.
- **Jump to the next** dawn, noon, dusk or midnight, in the Time panel.
- **Set the date**, in the month view: click the month and year at its top, type
  the day and year and pick the month, then press **Go** or Enter. The clock goes
  to that day at the same hour; there is no time to enter.
- **Go to this day**, in the month view's day panel, moves there, at the same hour.

A date typed or picked in the month view is a calendar jump: forward, it goes
off duty, so torches carried by the party are put out rather than burnt
through. Going back never burns anything.

While travelling, every move forward rolls the day's encounter checks it
passes, at their hours, as a move across the map does; a hit stops the clock
there, and the steps wait until the encounter is continued.

### Walking a hex takes its time

The party token walks as long as the clock takes to move it. A normal hex is
about a second and a half on screen, and a difficult hex, which costs two
points, is about two and a half seconds. The clock runs alongside, and on
every screen the bar's dial turns, its time ticks over and the sky darkens or
lightens smoothly with the token instead of jumping; the burning torches keep
pace too, and the fog lifts from a hex as the party walks into it. A route
across several hexes walks them in one unbroken stride; it stops only where a
check rolls an encounter or the day's points run out.

**Fast travel** (GM): with the party token selected, **Shift-click** the end of the
route the cursor shows and the party is there at once. No day has to be open, and
nothing is spent: no hexes of the day, no encounter checks, no time, no camp, no
rations. It needs no way there either: Shift-click open water without a boat, or
any hex the party could not enter, and the party is simply there. The fog lifts
along the way as a walk would lift it. Move the clock
yourself from the bar if the trip should take time. It is refused while an
encounter is held, until you press Resume clock. Players' Shift-clicks do nothing.

**Make camp** sits on the Travel panel's Traveling and Resting steps for the GM and
for a player who owns the travelling party; the camp window opens on that player's
own screen. **Resume clock** stays the GM's.

**Make camp** and **Resume clock** run the rest of the night, or of a stopped move, as
a time-lapse: a beat plus a share of the span, about eight seconds for a whole
night and never more than ten. The camp window folds away while the night runs,
so you watch it on the map, and opens again at dawn with the results. The bar's
time, the sky's darkness (dusk falling, dawn lifting) and the torches all run
through it, and an encounter check still rolls at its hour and stops the clock
there.

When the party's scene is not the one on the GM's screen there is nothing to
keep pace with, and the clock moves in one step as before. So do the clock bar's
own steps and jumps.

## Encounters while travelling (GM)

Travel's encounter checks roll quietly: nothing goes to chat and no window
opens. When one hits, the game pauses (unless **Pause game on encounter** is
off), the **Encounter** panel drops from the bar for every GM, and the travel
plate says **Encounter** until it's done. The panel shows:

- the check: its step (6 by day, 8 at night), its hour and its chance;
- the tables it went through, each with its roll: the region's encounter zone,
  the category it named, and that region's table for the category;
- what turned up: how many, with their number-appearing dice, or a point of
  interest's text;
- the distance, activity and reaction rolls, in words.

Only the GMs see it. **Post to chat** shows the players the encounter card.
**Encounter Roller** opens the roller to roll again, set CHA or renown for the
reaction, or place the tokens. **Resume clock** clears it and runs the rest of the
clock.

The chevron at the panel's top right folds it into a strip under the bar:
**Encounter**, the check's hour and what turned up (a point of interest's text,
shortened). The strip stays while the encounter is held, above the sky or
whichever panel you open meanwhile. Its chevron opens the panel again, and its
**Resume clock** is the panel's.

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
days (and the gods' holy days, below). **‹** and **›** turn the months.

**Click a day** to see what falls on it; nothing moves. For a holiday the panel
shows what it does to carousing and the book's page text, with a button to open
the page. For a holy day it shows its god, when it falls and a line on what it
is, with a button to open the god's page. Clicking a line in the list under the
grid does the same. A GM's **Go to this day** button in that panel moves the
clock there, at the same hour. A small
dot on a day means something else falls on it; the list under the grid says
what, day by day.

### What the calendar shows

- **The equinoxes and solstices**, and the day each **season begins**.
- **Eclipses** of the Sun and the Moon, as someone standing in Avignon would
  see them: the day, the hour (Avignon's local time), and how much is covered.
  An eclipse you could not see from there (the Moon or Sun below the horizon, or
  only the faintest shadow) is left out. The table covers the years 1200 to 1500.
- **Holidays**, the City of Masks ones from Cursed Scroll 6 pp. 46-47. The
  import guide files them for you as part of importing Cursed Scroll 6, so they
  are on the calendar as soon as the import finishes (**Importer Hub → Tools →
  Chapter to journal** does the same by hand). The ones that follow the sun
  (the Duke's Ball on the summer solstice, the Night of St. Anton on the
  autumn equinox) fall on the real day, not a fixed date.
- **The gods' holy days**, from the Player's Guide (pp. 190-205). The import guide
  files the gods' pages when you add the Player's Guide, and the calendar lists
  a holy day once its god's page is there. Most are as loose as the book:
  "the seventh day of spring" lands on 7 March, a new or full moon in a season
  lands on those days, and a stretch like "high summer" or "late winter" is one
  line, with no day, for each month it touches (the thirds of a season: early
  is its first month, mid its second, late its third). Four have no date to
  show and are left out: Ord's Chariot and the Blood Moon (every three years),
  Catterghat and Imprisonment (a day a priest chooses). The module ships only the
  name, god and timing. The line on what each day is comes from your own
  Player's Guide PDF: the import reads each god's Holy Days table when it files
  the pages, and a GM can press **Read holy day text** on a holy day that has no
  line yet. It is kept in a world setting, so players read it too.
- **Entries**: notes and quests a GM adds, and lines the module writes as the
  party plays.

The dates are the ones Foundry's own calendar prints. Its world calendar is
"Simplified Gregorian", a leap day every fourth year, which in the 1300s is the
Julian calendar, so in 1348 the spring equinox falls on 12 March, the summer
solstice on 13 June, the autumn equinox on 14 September and the winter solstice
on 13 December. That is why a new campaign starts on 12 March 1348. The moon
counts the average month from a real new moon, so its full moon can sit up to
about half a day, rarely a day, from an eclipse's.

### What players see

Players see the holidays, with the book's page text and what each does, and the
holy days, with a line on each, in the same calendar. They cannot read the
module's journal compendium (it holds every imported book), so a GM's client
keeps a copy of just the holiday pages and the list of imported holy days in a
world setting, and refreshes it when the world loads, when the month view opens
and after an import. The holy days' lines are a world setting of their own,
read from the Player's Guide PDF. A player sees them once a GM has loaded the
world with the pages imported; there is no page for them to open.

A GM can keep any one of them from players: open the holiday or holy day (click
it) and press the **Players can see this** button, which becomes **GM only:
players can't see this**. A GM-only one is left out of the copy players read, so
its text never reaches their clients, and it shows a "GM only" tag on your
calendar. Press it again to show it.

### Entries

A GM adds one under the list: a date, **Note** or **Quest**, a title, details,
and **GM only** to hide it from the players' calendar. The **×** on a line removes it.
Players see every entry that is not GM only, but cannot add or remove any.
GM only hides an entry from the calendar, it is not a secret store: the entries are one world
setting, which a player who goes looking for it can read.

The module logs these lines as play goes: **The party sets out** and **Travel
ends** (with the hex), **The party makes camp** (hex, terrain, region and the
day's weather), and each **Encounter** a travel check draws (GM only; what turned
up and the hex). The log is kept to 1000 lines, dropping the oldest logged ones
first; the ones you wrote stay.

### Where a new campaign starts

A world whose clock has never been set starts on **12 March 1348, 08:00**
instead of 1 January of year 0, once, the first time a GM loads it. A clock
anyone has already set is left alone. Set another date any time by clicking the
month and year in the month view.

The module leaves the date alone in a world that keeps it some other way: when
Simple Calendar, Simple Calendar Reborn, Calendaria or Simple Timekeeping is
active, or when the world's calendar is not Foundry's own.

## A calendar of your own

Gregorian is the default, and a world that never touches this stays exactly as
it was. Your own calendar is there if you want one, with its own months,
weekdays, holidays, moons and seasons:

1. As a GM, open the month view and press **Edit calendar**, under the grid. The
   same button sits in **Configure Settings → Shadowdark Enhancer → Overland**,
   for a world with no hex map to show the clock bar.
2. Change what you want. It starts from Foundry's calendar, so you only change
   what differs.
   - **Months** and **Weekdays**: names, and each month's length.
   - **Holidays**: a name, a month number and a day. They show in the month view
     on those days, for players too. They are names on the calendar: they have
     no carousing effects.
   - **Moons**: a name, the days from one new moon to the next, and how many days
     after the calendar's first day its first new moon falls. Add as many as you
     like. The first is the one encounter tables read; the sky dial and the month
     view show them all. With no moons left, the world keeps the usual moon.
   - **Seasons**: a name, and the month number and day it starts. Each runs until
     the next one.
3. Save. Calendar switches to **Custom** and the world reloads on the new
   calendar for everyone, once you say yes to the reload.

Save with nothing changed leaves the world as it is, so looking is safe on a
Gregorian world. To go back, set **Calendar** to **Gregorian** in the Overland
settings. Your calendar stays saved: set it to **Custom** to return to it. While
another module runs the calendar, Save only keeps yours and the world stays as it
is.

**Paste or copy a calendar** at the bottom of that window holds the whole
calendar in JSON: a Foundry v14 config, with `moons` and `holidays` lists beside
it, because Foundry has no field for those. Copy it to share your calendar; paste
one in and it replaces the rows when you save. A pasted calendar keeps its own
hours in a day, leap years, seasons and year numbering. If it leaves seasons out,
the four usual ones are spread over its year. If it leaves moons out, it has the
usual moon.

The clock is a count of seconds, and the calendar decides what those seconds
read as. Changing the calendar keeps every entry on the same moment but changes
the date the world shows, so set the date you want from the month view
afterwards.

On a Custom calendar:

- The clock, travel hours, sunrise and night, entries and quests all work as
  usual. The month view shows your months and your length of week, your holidays,
  and each moon's quarters, with a line saying what each moon is doing now.
- The equinoxes and solstices sit where the sun's day length turns, in the same
  place every year, and the Cursed Scroll 6 holidays that follow the sun fall on
  those days. Maytide is the first day of the fifth month.
- **Eclipses and the gods' holy days are hidden.** They are Earth dates.
- A new world stays on the first day of the calendar's first year: the jump to
  1348 is only for Foundry's calendar.

Foundry counts every day toward the week, so a calendar cannot have days that
sit outside it, such as Dolmenwood's Wysendays. A long month and a weekday that
slips is the closest it comes.

If Simple Calendar, Simple Calendar Reborn, Calendaria or Simple Timekeeping is
active, or another module sets the world calendar, that module is in charge and
this setting does nothing. Its hint says so. The Enhancer's clock reads Foundry's
calendar, so with a module that keeps its own calendar apart from Foundry's, such
as Simple Calendar, the Enhancer's dates and that module's will differ.
