# Overland — design proposal

Tracking issue: [#192](https://github.com/DimitroffVodka/shadowdark-enhancer/issues/192), part of
[#177](https://github.com/DimitroffVodka/shadowdark-enhancer/issues/177).
Waiting on it: #193 (Trouble), #190 (rumors), #191 (holidays), #198 (downtime), #197 (encounter
columns), and in Extras [SDX#151](https://github.com/DimitroffVodka/shadowdark-extras/issues/151)
(carousing) and [SDX#152](https://github.com/DimitroffVodka/shadowdark-extras/issues/152) (hex fog).
Reads the rules data of #195.

Status: decided 2026-09-26. Patrick answered every open question below with the recommendation and
confirmed every rules reading in §5.7. Nothing is built yet. The "Decided so far" list in #192 is
taken as settled and not reopened here.

Ground truth, read rather than guessed: SDE `origin/master` at a17e740; SDX `main` at 5573faf
(line numbers below are from that checkout, not from `feat/road-river-network-authoring`); Foundry
14.368 client at `FoundryV14/app/client`; the Shadowdark system 4.0.6
(`systems/shadowdark/shadowdark-compiled.mjs`). Unmerged Enhancer work that this doc builds on is
named by PR: stat damage #213, stat-damage riders #215 (both merged since).

---

## Decisions (Patrick, 2026-09-26)

All nine were answered with the recommendation, the first option in each. The alternative (*B*) is
kept for the record of what was weighed and turned down.

1. **One travel state per world.** A world setting, like `crawlState`. Multiple parties are out of
   scope. *B:* one state per party, stored on each Extras party actor. That needs Extras to run, and
   every reader has to be told which party it means.
2. **Seasons come from the core calendar's months** (spring is March to May, core
   `calendar.mjs:512-518`), so a season changes on the 1st. The equinoxes and solstices are still
   exact anchors for the holidays and the length of the day. *B:* seasons start on the astronomical
   dates (20 March and so on). That overrides core and puts two ideas of "season" in the module.
3. **The clock per hex:** a travel day is 8 hours of movement, split over the method's base
   budget, so walking costs 2 hours per cost point and mounted 80 minutes. A pushed day has 1.5×
   the points at the same rate, which makes it a 12-hour day. The 8-hour day comes from the boat
   actor's "hexes per 8-hour day", `boat-data-model.mjs:25`. *B:* a flat 2 hours per cost point
   for every method.
4. **An encounter that hits stops the clock at its hour.** The GM runs the encounter, then presses
   Continue to finish the rest of the move or the night. *B:* the clock always finishes the move or
   the camp, and the chat card only names the hour. That is simpler, but a fight rolled for 20:00
   then starts in the next morning's light.
5. **The travel token** is the Extras party token when exactly one is on the scene; otherwise the
   GM picks a token when travel starts. Only that token's moves spend the budget. *B:* every
   player-owned token on the map, grouped the way `partyHex()` finds the majority hex
   (`encounter-terrain.mjs:177-206`).
6. **Rations with Extras:** Make camp hands off to Extras' camping rest, which eats the day's
   rations, and Overland adds nothing on top. Without Extras, Overland eats them itself. *B:*
   Overland always runs the rations step, and Extras' camp skips its own step when Overland is
   active.
7. **Darkness on the hex map:** the overview map darkens only to a readable tint (a cap of 0.6),
   and battle maps marked outdoors go fully dark. *B:* the same curve everywhere, which leaves the
   map black at night for anyone without token vision.
8. **Make camp puts out carried lights** and they keep their remaining time, using the same helper
   as the off-duty move. The Extras campfire burns its 8 hours. *B:* carried lights keep burning
   through the night, as the system does today, so every torch left lit is used up.
9. **The budget is hard.** A move the day can't pay for is refused, and the party "bounces" off
   the hex. *B:* soft, like the crawl budget (`movement-tracker.mjs:256-260`): the move goes
   through and the day shows a negative balance.

---

## 1. Scope

This doc covers five things: the travel state and where it lives, the time API, the bar, the
travel day, and the scene sky. It also names the Extras contracts and the build order. No calendar
UI is built (no date picker and no custom calendars), and there is no undo for a move. For a free
reposition the GM uses Foundry's "displace" movement action, described in §5.2.

Extras today computes no travel cost and no hexes per day
(SDX `docs/wiki/Developer-API.md:223`). Its travel speed is a label on the party actor
(`PartySheetSD.mjs:359`, `:726-729`), and its weather button rolls the core rule and stores nothing
(`party/partytravel.mjs:393-457`). So Overland moves nothing out of working Extras code. It builds
the rules that Extras never had, and Extras keeps the party sheet, the camp and the fog.

## 2. The travel state

### 2.1 Fields

| Field | Type | Meaning |
|---|---|---|
| `_v` | 1 | shape version, same guard as `crawlState` (`crawl-state.mjs:431-439`) |
| `tokenUuid` | string\|null | the travel token (Q5) |
| `members` | actor ids | who eats, forages and rolls the underground check; seeded at start from the Extras party's `members` flag, else from the player-owned `Player` actors (the same filter the system's light tracker uses, `shadowdark-compiled.mjs:7957-7959`) |
| `mounts` | int | mounts to feed; defaults to `members.length` when the method is mounted |
| `day` | worldTime\|null | dawn of the current travel day; `null` means no day is open |
| `method` | `walking`\|`mounted`\|`sailing` | #195's `hexesPerDay(method)` keys |
| `boatUuid` | string\|null | when sailing aboard a boat actor, its `system.speed` is the base (`boat-data-model.mjs:25-26`) |
| `pushed` | bool | chosen at dawn only |
| `budget` | int | this day's points, stored so a rules edit mid-day changes nothing |
| `spent` | int | points spent; hexes left = `budget − spent` |
| `weather` | `{kind, roll, rule, until, advantageNext}` | `kind` is `stormy`, `fair` or `excellent`; `until` is the worldTime the weather holds to |
| `checks` | `[{half, at, chance, rolled, hit}]` | the day's four encounter checks (§5.3) |
| `pending` | `{until, reason}`\|null | an advance stopped by a hit, waiting for Continue (Q4) |
| `foraged` | actor ids | who has foraged today |
| `hex` | `{num, terrain, region, features}` | the travel token's last hex; it survives scene changes, so readers can use it off the map |

Climate, harshness, night and the moon are **derived, never stored**. They come from `hex.region`,
the season and the weather, through #195's `rules.climate()` and the time API. Season and week
changes are computed from each clock move, so no counter is kept for them (§3.5).

### 2.2 Storage: a world setting

The state is a world setting, `overlandState`, handled exactly like `crawlState`
(`shared/settings.mjs:232`, `crawl-state.mjs:24-36`). The setting is the only truth. The module
socket carries a payload-free "re-read" nudge, and the pure reducers live in an
`overland-state-core.mjs` beside `crawl-state-core.mjs`, where they can be tested in Node.

It does not go on the party actor, for these reasons:

- Enhancer has no party actor of its own. The Extras party is an NPC with a flag
  (`PartySheetSD.mjs:914-916`), so keeping the state there breaks "useful without Extras".
- Players own the party actor, so they could write its flags directly and skip the single-writer
  rule in §2.3.
- Flag writes on shared documents are where siblings get silently deleted
  (`shared/module-flags.mjs:58`, `replaceModuleFlag`). A setting avoids that entirely.

The cost is one party per world (Q1).

### 2.3 Who writes it

- **Only the active GM writes.** Mutations are read-modify-write: `spent += cost`, checks marked
  rolled. So they follow Renown's rule, not the crawl bar's "any GM" rule
  (`docs/API.md` "A GM can be the wrong writer too"; compare `crawl-state.mjs:214-222`). Every
  mutation runs on `game.users.activeGM`, inside one promise queue, the same serialisation stat
  damage uses (PR #213).
- **Automatic reactions** are token moves, clocks passing check hours, and season changes. They
  fire on every client and are gated on `isActiveGM()` (`shared/gm-relay.mjs:188`).
- **A second GM's clicks** are forwarded with `queryActiveGM` (`gm-relay.mjs:240`). This matters in
  Patrick's world, where the Bridge GM is usually connected next to the Gamemaster tab.
- **Players have one action: Forage** for a PC they own. It goes through `relayToGM`
  (`gm-relay.mjs:309`), and the receiver runs `refuseQuery` (`:213`) plus `authorizeActorFor`
  (`:170`). The player rolls the INT check themselves. The GM reads the result off the chat message
  that roll created, whose author must be the requesting user, and never takes a total from the
  payload (API.md, relay trust rule 1).
- **Players move the travel token themselves.** The active GM's `moveToken` handler does the
  spending (§5.2).

### 2.4 API and hooks

| Surface | Returns / does | Readers |
|---|---|---|
| `time.now()` | `{worldTime, components, label}` | rumors #190 (`heardAt.world`), recap |
| `time.season(t?)` | `{key: spring\|summer\|autumn\|winter\|null, index, name}` from core | #195 `climate()`, the bar |
| `time.isNight(t?, {region}?)` | bool; the region applies the Isles of Andrik override (§6, added with O9; O1 shipped `isNight(t?)`) | SDX#152 fog, the bar. Not #197's columns: they keep the fixed 18:00/06:00 check halves of §5.7, and take only the moon from `moonPhase` |
| `time.moonPhase(t?)` | `{index 0-7, key, fraction, illumination}`, where index 0 is new and 4 is full | #197 Myre Swamp "New Moon", Lastmoon |
| `time.sun(t?, {region}?)` | `{sunrise, sunset}` in hours | the bar, the darkness driver |
| `time.anchor(name, year?)` | worldTime of that day's 00:00. Names: `springEquinox`, `summerSolstice`, `autumnEquinox`, `winterSolstice`, the four cross-quarters, `lastFullMoon` | holidays #191 (`holidays.today`) |
| `time.format(t?)` | the bar's date string, with month names from core's `CALENDAR.GREGORIAN.*` keys | rumors ledger, recap |
| `time.advanceOffDuty(seconds, {reason})` | §3.6 | downtime #198, SDX#151 carousing |
| `overland.state()` | a clone of the state plus derived `{hexesLeft, climate, harsh, isNight}` | SDX party sheet, SDX#152 |
| `overland.isActive()` | mode is `overland` | SDX |
| `overland.rollWeather({reroll}?)` | rolls or rerolls today's weather | the SDX weather button and Predict |
| `encounter.check({threshold, at, label}?)` | extends `encounter-check.mjs:21` to take a threshold and a time; no arguments behaves exactly as today | Overland |

| Hook | Where | Payload | Subscribers |
|---|---|---|---|
| `shadowdark-enhancer.timeAdvanced` | active GM only, once per world-time change | `{from, to, dt, offDuty: reason\|null, crossed: {days, weeks, seasons: [{from, to, at}], seasonChanges, dawns, dusks}}`; `seasons` keeps the last changes, one per season of the calendar at most, and `seasonChanges` counts them all | Trouble #193 (weeks, and `to` against stage thresholds), the underground check (seasons) |
| `shadowdark-enhancer.overlandChanged` | every client, after a commit | the state | the bar, SDX party sheet |
| `shadowdark-enhancer.overlandStart` / `overlandEnd` | every client | the state | Session Recap, as with `crawlStart` / `crawlEnd` (`crawl-state.mjs:230`, `:240`) |

Rumors, holidays and downtime need **no** subscription. Rumors and holidays read the time API
when asked, and downtime calls `advanceOffDuty`. Because `timeAdvanced` is active-GM only,
everything that subscribes to it is a single writer by construction. Each API addition bumps the
minor `apiVersion` (`shadowdark-enhancer.mjs:409`), and the section goes into `docs/API.md`.

## 3. Time

### 3.1 The core calendar, on 13 and 14

The world clock is `game.time`, which Overland only reads. `advance(delta, options)` passes its
options to `game.settings.set("core", "time", …)` (`helpers/time.mjs:146-150`). From there they
travel through the Setting's `_onUpdate` (`documents/setting.mjs:48-51`) to the time setting's
`onChange` (`game.mjs:1282-1288`), and then to
`Hooks.callAll("updateWorldTime", worldTime, dt, options, userId)` (`helpers/time.mjs:212-218`).
That route is how an off-duty move gets marked. Enhancer already relies on custom update options
reaching other clients' hooks: `opts?.[MODULE_ID]?.rollback` in `movement-tracker.mjs:236`.

Foundry 13 has the same pieces. Its API docs list `GameTime` with `calendar`, `components`,
`earthCalendar`, `advance`, `set` and `onUpdateWorldTime`, and `CalendarData` with
`timeToComponents`, `componentsToTime`, `add`, `difference` and `format`. The `preMoveToken` and
`moveToken` hooks exist in 13 as well. (This comes from foundryvtt.com/api/v13, because the wiki
mirror covers 14 only and there is no local v13 install.) Version 14 adds `componentsToUnit` and
`formatDuration` (`data/calendar.mjs:128`, `:402`), and Overland uses neither.

The time module is `scripts/time/time-core.mjs`. It is pure, and takes a calendar object and a
worldTime. A thin Foundry wrapper supplies `game.time.calendar`. Nothing assumes Gregorian:
weekdays, months and seasons all come from the calendar config.

### 3.2 Seasons, weeks and anchors

- **Season** is core's `components.season`, which on the Gregorian calendar is matched by month
  (`calendar.mjs:276-307`, `:512-518`) (Q2). It maps to a key for `rules.climate()`: Fall becomes
  `autumn`.
- **A week** starts at weekday 0 at 00:00, which is Monday on core's Gregorian calendar
  (`calendar.mjs:263-265`, `:498-505`). The number of weeks crossed is
  `floor((absDay(to) + firstWeekday) / 7) − floor((absDay(from) + firstWeekday) / 7)`.
- **Anchors** are fixed on the Gregorian calendar: 20 March, 21 June, 22 September, 21 December.
  The cross-quarters are the midpoints (about 5 May, 7 August, 6 November, 4 February). Another
  world calendar uses the same fractions of its year. #191 describes Maytide as "about May 1", but
  the true midpoint on this calendar is 5 May. Holiday recipes can offset from an anchor if the
  book means May Day.
- **The last full moon** of a year is the latest `epoch + (k + ½)·synodic` that still falls in that
  year.

### 3.3 Sunrise and sunset

Daylight follows a cosine between the solstices: 9 hours on the winter solstice and 15 hours on
the summer one, both centred on 12:00. Sunrise is `12 − daylight/2`. That gives 07:30 to 16:30 on
21 December, 04:30 to 19:30 on 21 June, and about 06:00 to 18:00 at the equinoxes. The curve
follows Calendaria's sinusoid (its `calendaria-calendar.mjs:1070-1090`, MIT, credited, §9).
`isNight(t)` is `hour < sunrise || hour ≥ sunset`. The two lengths are constants with a
`ponytail:` note; a setting can wait until a table asks for other latitudes.

### 3.4 The moon

The moon follows the synodic month, 29.530588853 days, counted from an epoch:
`fraction = frac((t − epoch) / 86400 / 29.530588853)`. There are eight phases,
`index = round(fraction·8) mod 8`, and illumination is `(1 − cos 2π·fraction)/2`. The epoch is a
world setting that defaults to worldTime 0. A GM button, "New moon tonight", sets it to the current
time. Anchoring to the real sky (SDX's prior-art note, `hex-calendar-prior-art.md:126-133`) buys
nothing in the Western Reaches, and core's simplified leap years would drift about 15 days from
the real calendar by the year 2000 anyway.

### 3.5 `timeAdvanced`

The active GM listens to `updateWorldTime` and computes one crossings object for
`(to − dt, to]`, then fires the hook. This has to stay cheap: when the system's real-time light
clock is on, it calls `game.time.advance` every tick (`shadowdark-compiled.mjs:7564-7565`). A
negative `dt` crosses nothing.

### 3.6 The off-duty move, and torches when time jumps

**What the system does.** Only GM clients listen to world time
(`shadowdark-compiled.mjs:7804-7812`), and only the system's primary GM burns lights. That is a
user flag, not Foundry's active GM (`:5071-5085`, `:8080`). Every lit light in its cached list
loses the whole `delta` (`:8111-8117`). One that reaches 0 is deleted from the actor (`:8119-8125`).
A dropped Light actor loses the actor and its tokens (`:8127-8133`). A three-day downtime would
therefore delete every torch left lit.

**The cache is the trap.** The list is rebuilt by a 1-second housekeeping interval
(`:7582`, `:7879-7882`), and only when it is marked dirty (`:7941-7947`). Dirty is set by the
system's `toggleLightSource`, but only on the client that ran it (`:7905-7927`, `:8053-8056`),
and by `updateActor` (`:7809`). It is **not** set by an item update. So putting a torch out and
advancing straight away still burns the torch from the stale cache.

**`time.advanceOffDuty(seconds, {reason})`** is GM-only, refused for players, and does this:

1. It runs on the system's primary GM: the active user with `flags.shadowdark.primaryGM`. A GM→GM
   query hands it there: `queryActiveGM` (`gm-relay.mjs:240`) with a new option naming the
   target user. When light tracking is off, or
   no primary GM is online, it goes straight to step 4.
2. It puts out every lit `Basic` light the members carry, through the system's own toggle. That is
   the path the strip already prefers, `actor.sheet._toggleLightSource`
   (`crawl-strip.mjs:1152-1168`). The toggle marks the tracker dirty on this client and keeps
   `remainingSecs`. One chat line names what was put out.
3. It waits for one housekeeping pass: `lightSourceTracker._updateLightSources()` when that
   exists, or else a 1.1-second wait.
4. It calls `game.time.advance(seconds, {"shadowdark-enhancer": {offDuty: reason}})`, so
   `timeAdvanced` carries `offDuty`.

Effect lights (a Light spell) and dropped Light actors are left to the clock. A spell's duration is
real, and a campfire left behind burns out. Blitz clamps relit torches as usual
(`modes-of-play/blitz.mjs:1-21`).

**Overland spends only on its own actions**: a move, dawn and Make camp. Any other clock move
spends nothing, whether it is off-duty, core's time controls, or Extras' camp advance. So an
off-duty jump spends no rations, rolls no weather and makes no checks, by construction. The marker
exists for listeners. The Trouble tracker, holidays and the season change still see the jump
(#198's acceptance). A travel day left open across an off-duty jump is simply stale; the next dawn
opens a new one, and the skipped days cost nothing.

**On-duty moves burn lights as the system does**, because an hour of travel is an hour of torch.
The bar shows a flame marker while a member has a lit light. Make camp is the one on-duty move that
puts lights out first (Q8).

## 4. The bar

### 4.1 Slim and expanded

```
 Tue 14 May  14:20  |  sun (sets 19:10)  waxing gibbous  |  Stormy  |  Hexes 2 of 4  |  v
```

- **Slim bar** (everyone): date and time, a sun or moon glyph with its phase, weather, hexes left.
  The GM also sees a **Continue** button while `pending` is set, and the flame marker.
- **Expanded view** (click the bar):
  - the **sky dome**: a small SVG arc with the sun placed by its progress from sunrise to sunset
    and the moon drawn by phase;
  - season, climate and a "harsh" marker;
  - the weather card: roll or reroll, GM only;
  - method, boat and push, editable at dawn only;
  - the budget as a bar;
  - the ration stock of members and mounts;
  - the foraged-today list, with a Forage button on each PC the viewer owns;
  - GM only: the four checks with their hours and results, and Start day, Make camp, End travel.
- Players never see the check hours. Every string lives under `SDE.overland.*` in
  `languages/en.json` (#169). Today's literal encounter flavour text (`encounter-check.mjs:82-84`)
  is not copied; Overland's cards get keyed strings.

### 4.2 Placement

The bar sits top centre, in the Crawl Strip's slot: a click-transparent full-width wrapper with an
inner bar that takes clicks (`styles/shadowdark-enhancer.css:408-434`). The two never show at once,
so they never collide. The GM's bottom crawl bar (`crawl-bar/crawl-bar.mjs:60-85`) stays where it
is and gains the mode buttons.

### 4.3 Mode switch rules

Overland is a fourth `mode`. The work in `crawl-state-core.mjs`:

- add `overland` to `VALID_MODES` and `VALID_PRIOR_MODES` (`:13`, `:16`);
- add `startOverland` and `endOverland` reducers;
- make `endCrawl` a no-op outside `crawl`, where today it only skips combat (`:163-166`);
- bump `STATE_VERSION` to 3 (`:11`), so an older client refuses to write (`crawl-state.mjs:431-439`).

`CrawlState.isActive` (`crawl-state.mjs:65`) narrows to `mode ∈ {crawl, combat}`. Its nine readers
then treat Overland as "no crawl" without further edits: strip render (`crawl-strip.mjs:631`),
movement tracking (`movement-tracker.mjs:121`, `:243`, `:282`, `:317`, `:322`, `:390`, `:473`),
and the bar's idle state (`crawl-bar.mjs:102`).

| From → to | Trigger | What happens |
|---|---|---|
| off → overland | GM: **Start travel** on the crawl bar, offered only on a hex-map scene | picks the travel token and members; resumes an open day or asks for dawn choices |
| overland → off | GM: **End travel** | the state is kept, and the day stays paused |
| overland → crawl | GM: **Start crawl** | the strip shows; the travel state is kept, so its `hex` still feeds the underground check |
| crawl → overland | GM: End crawl, then Start travel | two clicks; `crawlEnd` fires as today |
| overland → combat | `createCombat` / `combatStart` (`crawl-state.mjs:120-136`) | `priorMode = overland`; the bar hides and the strip shows the combat. No crawl-member enrolment, since that only happens when `priorMode` is `crawl` (`:392`) |
| combat → overland | `deleteCombat` with no combat left (`:138-152`) | the bar comes back |
| reload or GM handoff | `_reconcileCombatMode` (`:198-212`) | unchanged |
| overland, on a scene that isn't a hex map | — | the bar is hidden on that client; the state is untouched |

A hex-map scene is one where `partyHex()` would work: an SDE `hexTags` origin on a hexagonal grid
(`encounter-terrain.mjs:190-193`).

## 5. The travel day, step by step

### 5.1 Dawn

The day starts on **Start day**, or automatically when an Overland advance reaches sunrise.

1. **Weather**, unless it still holds (`until` is later than now):
   - *Western Reaches* (the default): roll d6, or 2d6 keep highest when `advantageNext` is set.
     A 1 is `stormy` until the next dawn; a 6 is `excellent` and sets `advantageNext`; 2 to 5 is
     `fair` and clears it.
   - *Core* (an option): on a 1, a storm for 1d4 days, with `until` that many dawns away and no
     roll while it lasts. Otherwise `fair`. This is the rule SDX implements today at
     `partytravel.mjs:393-457`.
   - The roll goes to chat as a keyed card, and §6 puts it on outdoor scenes.
2. **Climate** is `rules.climate(hex.region, season)` (#195). The day is harsh when that climate is
   harsh always (†), or harsh in storms (*) and today is stormy.
3. **Method, push and budget.** The GM picks the method, and a boat when sailing. The push can
   only be chosen here.
   - The base is `rules.hexesPerDay(method)`, or the boat's `system.speed`.
   - The budget is `floor(base × 1.5)` when pushed, otherwise the base; `spent` goes to 0.
   - Each cost point takes `8 h / base` (Q3).
4. **Check hours.** Roll four d12s:
   - two day checks at `06:00 + (d12 − 1) h`, and two night checks at `18:00 + (d12 − 1) h`;
   - the chance is 1-in-6, or 2-in-6 on a pushed day;
   - a check whose hour has already passed, because the GM started late, falls due at once.

### 5.2 A hex move

1. **The mover's client checks first**, in `preMoveToken` (`documents/token.mjs:1990`, present in
   13). It works out the hexes entered with `canvas.grid.getDirectPath` over the waypoints (the
   call the SDX fog uses, `SDXHexFogSD.mjs:666-667`) and prices each one with `hexCost()` below.
   A move worth more than the hexes left is refused with a "bounced" line naming the terrain and
   its cost (Q9). The `displace` movement action (`config.mjs:2439-2450`) is free, and is how the
   GM repositions the token.
2. **The active GM is authoritative**, in `moveToken` (`token.mjs:2886`). It re-prices the move,
   adds to `spent`, records `hex` (region through `regionOf`, `hex-region.mjs:198`), and advances
   the clock by `cost × hours per point`. Two quick moves can both pass the client check; if the
   GM finds a move over budget, it sends the token back.
3. **`hexCost(hex, from)`:**
   - start from `rules.terrainCost(terrain, {boat, weather})` (#195), where storms turn normal
     terrain difficult;
   - impassable when the weather is stormy and the climate is harsh;
   - 1 when both hexes carry a `path` feature, because the party followed the road;
   - a river feature never changes the cost (#196: only terrain decides; a river tile is terrain).
   - A scene with no SDE tags prices every hex at 1, and the bar says so.

### 5.3 Checks fall due

Every Overland advance runs from now to its target and rolls, in time order, each unrolled check
whose `at` falls inside that span. The roll is `encounter.check({threshold, at, label})`, and the
table comes from #197's `tableForHex(hex, {hour})`. Until #197 lands, it uses `pickTable`
(`encounter-terrain.mjs:46`). A hit stops the advance at `at` and stores
`pending = {until, reason}` (Q4); **Continue** resumes. Checks are logged to the recap with the
in-game time as their `clockLabel` (`session-recap.mjs:177-182`), and the `pauseOnEncounter`
setting applies as it does today (`encounter-check.mjs:47-49`).

### 5.4 Forage

A PC may forage once a day, and not on a pushed day.

- It is an INT check against DC 12, or DC 18 in a harsh climate.
- It is impossible when the day is both stormy and harsh.
- Success adds one ration to that PC's Rations stack. Rations are matched by name, as SDX does with
  `/^rations?$/i` (`CampingRestSD.mjs:24`, `:32-36`).
- Players relay the action (§2.3). Foraging takes no clock time.

### 5.5 Make camp

1. Put out carried lights (Q8).
2. Advance to the next sunrise, rolling the remaining day checks and both night checks as they fall
   due (§5.3).
3. Rations:
   - **Without Extras**, Overland does them. Each member needs 1 ration, or 2 when harsh, and each
     mount the same, drawn from the members' stacks.
   - Under a harsh climate a PC who can't cover 2 eats nothing.
   - A PC who goes without takes 1 CON through `statDamage.apply(actor, "con", 1)` (PR #213). Death
     at CON 0 is already its job. If `statDamage` is absent, a chat line tells the GM instead.
   - **With Extras**, the hand-off in §6 does rations (Q6).
4. The new day's weather rolls at that dawn. The bar then offers the dawn choices, with push reset.

### 5.6 The underground season check

When `timeAdvanced` reports a season crossing and `state.hex.terrain` is `deep_tunnels`
(`hex-map/tag-overlay.mjs:56`), each member makes a DC 12 CHA check, and a failure costs
1d4 CHA through `statDamage`. The player rolls through the GM→player query that stat-damage riders
already use, and the GM rolls when that player is offline (PR #215, `stat-damage/stat-riders.mjs`).
One check is made per season crossed. The check runs in every mode, because the party may be
crawling below that hex.

### 5.7 Rules readings (confirmed by Patrick, 2026-09-26)

| Reading | Where it bites |
|---|---|
| The d12 gives the hour within that half of the day: 06:00 to 17:00 for day checks, 18:00 to 05:00 for night checks | §5.1 |
| The push's +1-in-6 applies to all four checks of that travel day, the night ones included | §5.1 |
| Forage is DC 12, the book's default DC for camping tasks | §5.4 |
| In a harsh climate, having only 1 ration counts as having none | §5.5 |
| Stormy in a harsh climate makes every hex impassable for the day, not only normal terrain | §5.2 |
| Under the core rule, no daily roll is made while a 1d4-day storm lasts | §5.1 |
| Following a path from one path hex to another costs 1 | §5.2 |

## 6. Extras, and the sky on scenes

### 6.1 Contracts

Each change below is one line on each side. Filed as one complete SDX issue (build step X1), except
the fog, which is SDX#152 and already filed.

| Need | Enhancer side | Extras side |
|---|---|---|
| Weather button | `overland.rollWeather({reroll})` | `_onRollWeather` (`partytravel.mjs:308`) calls it when `game.shadowdarkEnhancer?.overland` exists **and** no custom weather table is set (`:311`). Predict (`:343-378`) calls it again with `{reroll: true}` |
| Make camp | Make camp calls `game.shadowdarkExtras?.camping?.open({party, members, pushed, harsh, stormy, rationsEach, advanceTime: false})` and awaits `{completed, fed: {actorId: bool}}` | a stable `camping.open` around `CampingRestApp.show` (`CampingRestSD.mjs:338`), which pre-fills `pushed` (Hunt is blocked, `:652`) and applies the WR food rules SDX#149 left to "the travel-day issue": Hunt at DC 18 when harsh and impossible when stormy and harsh, `rationsEach` in `_buildRationPlan` (`:599`), mounts eat, a missing ration costs `statDamage` CON 1, and no clock move (`:747-748`) |
| Party sheet | `overland.state()` and `shadowdark-enhancer.overlandChanged` | the travel tab shows date, weather, hexes left, method and push, read-only, and hides the cosmetic speed select (`PartySheetSD.mjs:359`, `:726-729`) while Overland is present |
| Hex fog (SDX#152) | `time.isNight({region})`, `overland.state().weather.kind`, `rules.visibility()` | #152 as filed, in `_onUpdateToken` (`SDXHexFogSD.mjs:649`); this row pins the names #152 reads |
| Carousing (SDX#151) | `time.advanceOffDuty(s, {reason: "carousing"})` (§3.6), and `holidays.today` on the anchors of §3.2 | #151 as filed |
| Travel token | reads `flags.shadowdark-extras.isParty` and `members` (`PartySheetSD.mjs:914-916`) | nothing |

**Not needed from Extras:**

- a read API for SDX hex records;
- any change to the fog's per-hex roll tables (`SDXHexFogSD.mjs:727-730`), which are GM content,
  not Overland's checks;
- any change to SDX's travel activities.

**Without Extras**, everything in §2 to §5 works: the travel token is picked by the GM, members are
the player-owned PCs, and Overland runs its own camp rations. The only thing missing is the fog.

### 6.2 Scene darkness and weather effects

- **Outdoor scenes.** Scene config gets a "Follows the sky" choice, stored as a scene flag with the
  values default, on and off. The default is on for hex-map scenes and off everywhere else. Dungeons
  stay untouched unless the GM marks them.
- **Darkness** is 0 by day. It ramps linearly over a one-hour twilight after sunset and before
  sunrise, up to a night level of `1 − 0.2 × moon illumination`, so a full-moon night sits at 0.8.
  Hex maps are capped (Q7).
- **Writes.** The active GM writes `environment.darknessLevel` (`common/documents/scene.mjs:116-117`)
  on the active scene when time changes and when a scene is activated:
  - only when the value moves by 0.02 or more;
  - animated for steps under an hour.
  - This is the batch-and-animate pattern of Calendaria's `updateDarknessFromWorldTime` and its
    resync on activation (its `darkness.mjs:351-365`, `:437-461`).
- **Weather effects** set `scene.weather` (`common/documents/scene.mjs:160`) on outdoor scenes:
  - `rainStorm` when stormy;
  - `blizzard` when stormy and the climate is Cold or Freezing;
  - empty otherwise.
  - The effects are core's (`config.mjs:1437-1548`). The value is written only when it changes.
- **The Isles of Andrik**, keyed by region name as a shipped recipe, like `training-core.mjs`, with
  the source page and no book text. The region is the party's, `state.hex.region`.

  | Season | Sky | `isNight()` | Darkness |
  |---|---|---|---|
  | spring, summer | Midnight Sun | always false | never above 0.3 |
  | autumn | Harvest | normal | normal |
  | winter | Long Dark | always true | the night level all day |

- **Neighbours.** When Calendaria's `darknessSync` is on (a world or per-scene setting), Overland
  leaves darkness alone and says so once in the log. Only one writer ever owns a scene's darkness.

## 7. Build plan

The foundations come first. O1 lets #193, #190, #191 and #197's moon column start. O2 lets #198
and SDX#151's duration start. Neither needs the bar.

| # | Piece | Depends on | Unblocks | Acceptance check |
|---|---|---|---|---|
| O1 | **Time API** (`scripts/time/`): `now`, `season`, `isNight`, `sun`, `moonPhase`, `anchor`, `format`; the `timeAdvanced` hook; the in-game time added to recap's `_stamp` (`session-recap.mjs:117-122`); API.md; `apiVersion` minor | — | #193, #190, #191, #197 | Unit tests: 21 June 04:30–19:30 and 21 December 07:30–16:30. At the epoch the moon is `new`, +14.77 days `full`. `anchor("summerSolstice")` is 21 June. `lastFullMoon` falls in the year's last 29.53 days. Sunday 23:00 plus 10 days reports `weeks: 2`. 28 February to 1 March reports winter → spring. No v14-only call is used (a test greps for `componentsToUnit` and `formatDuration`). |
| O2 | **Off-duty move**, `time.advanceOffDuty` (§3.6) | O1 | #198, SDX#151 | Live, on the Bridge (`targetUser` always passed): a torch lit with 40 minutes left, after a 3-day move, is out and still has 40 minutes; one chat line names it; the clock moved exactly 3 days; `timeAdvanced.offDuty === "downtime"`. Called from the non-primary GM, it still keeps the torch. With tracking off, it only advances. |
| O3 | **Travel state and the `overland` mode**: setting, core reducers, active-GM queue, relays, `overland.state()`, hooks, and Start/End travel on the crawl bar | O1 | O4–O8, X1 | Reducer tests: combat started from overland returns to overland, and `endCrawl` does nothing in overland. The strip is hidden and movement tracking idle in overland. A player's forged forage for an unowned PC is refused. The state survives a reload. A v2 client refuses to write the v3 crawl state. |
| O4 | **Weather and climate** | O3, #195 | O5, SDX#152, O9 | A 6 sets `advantageNext` and the next roll is 2d6kh1. A stormy day prices grassland at 2. A harsh region in a storm is impassable. Under the core rule a storm lasts 1d4 dawns with no roll. `rules.climate` shows on the state. |
| O5 | **Movement budget and clock** | O3, O4, #195 | O6, O7 | Walking into forest spends 2 of 4 and moves the clock 4 hours. A pushed walking day has 6. A move worth more than what's left bounces. Displace is free. Aboard a speed-3 boat the budget is 3. Path to path costs 1. |
| O6 | **Encounter checks** | O5; #197 (with `pickTable` as fallback) | — | A full day posts four checks with hours. A pushed day checks at 2-in-6. A hit at 20:00 during camp stops the clock at 20:00, and Continue finishes to dawn. With #197, a Myre Swamp night check rolls the Night column. |
| O7 | **Forage, rations, camp, underground** | O5, stat damage (#213, #215, merged) | X1 | Forage works once per PC per day, is refused on a pushed day, is DC 18 when harsh, and is impossible when stormy and harsh. Camp without Extras: 1 ration each (2 when harsh), and a PC without one takes 1 CON. A season change with the party on deep tunnels prompts DC 12 CHA, and a failure costs 1d4 CHA. |
| O8 | **The bar** (§4) | O3; O4–O7 for its controls | — | The slim bar shows date, time, weather and hexes left; the expanded view shows the dome and travel details. It appears only in overland on a hex map, hides during combat and returns after. Players see no check hours. Every string is in `en.json`. |
| O9 | **Sky on scenes** (§6.2) | O1, O4 | — | An outdoor scene darkens over the twilight hour after sunset; an indoor one is untouched; the hex map stops at the cap. Stormy sets `rainStorm`, or `blizzard` in the cold. The Isles in summer never go dark and in winter never get light. With Calendaria's darkness sync on, nothing is written. |
| X1 | **One SDX issue**: weather hand-off, `camping.open` with the WR food rules, the party-sheet travel view (§6.1), with an acceptance check and a not-needed list | O3's API names | — | Filed complete in one go, the way SDX#151 and SDX#152 were. |

O4 to O7 can land in one PR if they come out small. The split is there so the encounter work can
wait for #197 without holding up the rest.

## 8. Borrowed ideas and licences

- **Calendaria** 1.4.2 is installed under `Data/modules/calendaria`. Its licence is MIT,
  "Copyright (c) 2025 3 Death Saves" (`LICENSE`, `module.json:37`). The minified bundle ships a
  source map with the full sources, and the files cited above are paths in that map. Two small
  functions would be ported with credit: the solstice sinusoid (`calendaria-calendar.mjs:1070-1090`)
  and, if Q7's cap needs a curve, the darkness shape (`darkness.mjs:30-47`). The credit goes in the
  file header and under "Bundled code" in `CREDITS.md:151`. Its ideas are used without code: the
  scene-sync override (`darkness.mjs:383-388`) and animating only small steps (`:351-365`).
  Calendaria is not a dependency.
- Whether Calendaria is *enabled* in the live world was not checked, since the world is off limits.
  §6.2's stand-down covers either case.
- **Ember's travel HUD** is not installed under `Data/modules`, or anywhere under `Data/`. The bar
  follows #192's description of it, not its code.
- **SDX's prior-art review** (`docs/architecture/hex-calendar-prior-art.md`) agrees on using core
  and a formula for the moon (`:118-133`). It recommends SmallTime for darkness; #192 decided that
  Overland drives darkness itself, and SmallTime is not installed.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The torch guard leans on system internals: the cache, the dirty flag and the primary GM | Pinned to 4.0.6 in O2's live check; `_updateLightSources` is feature-checked, with a timed wait as the fallback |
| Custom `advance` options get dropped on the server round trip | Checked in O1. Nothing depends on them for spending, because Overland only spends on its own actions; only the `offDuty` label would be lost |
| The real-time light clock fires `updateWorldTime` every tick | `timeAdvanced` is O(1) per call, and darkness writes are gated at 0.02 |
| Two writers for scene darkness (Calendaria, SmallTime, a GM by hand) | §6.2 stands down for Calendaria, and the per-scene "Follows the sky" off switch covers the rest |
| #195's region names differ from `regionOf`'s | Both normalise the same way, as #195 requires; O4 tests a pair such as "Bastion Mtns" and "Bastion Mountains" |
| `mounts` is a number, not actors | Enough for rations; mount actors (`actors/mount-npc-sheet.mjs`) can replace it later |
