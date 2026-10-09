# Shadowdark Enhancer — File Inventory

<!-- inventory:stats:start -->
1800 tracked files · ~229,900 lines of code/markup across scripts+templates+styles+test.
`v0.17.3` in both `module.json` and `package.json`.
<!-- inventory:stats:end -->
**Layout reflects the 2026-07-21 feature-folder reorganization (v0.11.0 cycle).**

> The counts above and the §3 `scripts/` tables are **generated** — run
> `npm run inventory` after adding or renaming a script. Per-file descriptions
> and section prose live in `tools/inventory/data.json`; everything else on this
> page is hand-written.

---

## 1. Repo root (shipped)

| File | What it is |
|---|---|
| `module.json` | Foundry manifest. id `shadowdark-enhancer`, v0.13.1, core min 14 / verified 14.365, system shadowdark min 3.6.2 / verified 4.0.6, recommends `shadowdark-extras` 6.10.45. Declares the `mount` + `boat` Actor sub-types, one ESM entry, one stylesheet, `socket: true`. |
| `package.json` | Dev-only. `npm test` → `node --test test/*.test.mjs`; `npm run lint` → eslint over `scripts test`. |
| `eslint.config.mjs` | Flat ESLint config (browser + node globals, Foundry globals). |
| `README.md` | User-facing feature docs. |
| `CHANGELOG.md` | Running changelog. |
| `CREDITS.md` | Third-party asset attribution (Shikashi icon pack, game-icons.net, PD portraits). |
| `LICENSE` | MIT. |
| `.gitattributes`, `.gitignore` | Line-ending rules; ignore list (see §9). |
| `.github/workflows/ci.yml` | Lint + `node --test` on push/PR. |
| `.github/workflows/release.yml` | Tag → build module.zip (allowlist: module.json, README, LICENSE, CHANGELOG, CREDITS, docs/API.md, assets, icons, languages, scripts, styles, templates) + attach manifest to the GitHub release. `test/` and the rest of `docs/` never ship. |

## 2. Repo root (NOT shipped — see §9)

**Tracked in git, excluded from the release zip:**
`verify.sh` (pre-commit grep wall + `node --check` + eslint, `--strict` tier).

**Not in git at all:**
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.impeccable.md` (agent instructions) ·
`package-lock.json`, `node_modules/`.

---

<!-- inventory:scripts:start -->
## 3. `scripts/` — module code (feature-folder layout)

### 3.1 `scripts/` root

| File | Lines | Description |
|---|---:|---|
| `shadowdark-enhancer.mjs` | 1385 | **Entry point** (module.json esmodules). Registers hooks, settings, sheets, actor sub-types, the public `game.shadowdarkEnhancer` API, and wires every sub-system. |
| `luck-reroll/luck-reroll.mjs` | 172 | Wraps the system's `_onReroll` to enforce nat-1 prevention and log Luck rerolls to the session recap. |
| `spell-mishap/spell-mishap.mjs` | 271 | Nat-1 spellcasting failures auto-roll the class's mishap table (wizard / witch / necromancer sets); divine casters are exempt. |
| `scavenger/scavenger-core.mjs` | 171 | Pure Delver Scavenger rules: the 5-6 success range and Master Scavenger's widening (floored at 3-6), what counts as expending a consumable's last use (a 1→0 decrement or a delete at quantity 1 — never a stack deleted whole), and which single client rolls. |
| `scavenger/scavenger.mjs` | 209 | Foundry wiring for Scavenger: pre-hooks snapshot the quantity and a restore copy, post-hooks roll the d6, post the card, and hand back one use — refuelling and unlighting a restored light source. |
| `parry/parry-core.mjs` | 116 | Pure Duelist Parry rules: what the system's clamped `applyDamage` actually removes (so a reversal gives back the clamped delta, not the printed damage), whether an attack is parryable, and which parts of a downed state this hit caused. |
| `parry/parry.mjs` | 448 | Parry button on an attack card that hit: spends the 1/day use, makes the attack miss, and reverses damage the GM already applied — HP, defeated flag and downed conditions. Player clicks go through the authenticated gm-relay. |
| `taunt/taunt-core.mjs` | 118 | Pure Duelist Taunt rules: round+turn as one ordinal, the "end of your NEXT turn" expiry comparison, advantage/disadvantage cancelling, and what arms the talent (a miss — including a parried hit). |
| `taunt/taunt.mjs` | 252 | Arms Taunt when an enemy misses its holder, sets `mainRoll.advantage` on attacks back at that enemy via `SD-Player-Attack` (with the reason printed on the roll card), and expires it when the holder's next turn ends. |
| `stat-damage/stat-damage-core.mjs` | 194 | Pure stat-damage rules and the effect contract Shadowdark Extras' Effects library follows: a negative ADD on `system.abilities.<key>.value` flagged `statDamage: { ability }`, summed across effects, healed whole or N per ability, and the parser for monster riders ("DC 12 CON or 1d4 STR damage", enriched or not). |
| `stat-damage/stat-damage.mjs` | 150 | `statDamage.{apply, heal, of}`: writes replace an ability's effects with one holding the new total (serialized per client), and a stat-damage effect taking CON to 0 hands the character to dying's onConZero on the active GM (dead, unless noDeathAtZeroCon). |
| `stat-damage/stat-riders.mjs` | 127 | Applies a monster attack's stat-damage riders when its card HIT a character, reading the attack's rider and the NPC feature it names (or shares its name with). Only a card posted by a GM or the attacker's owner, naming the attacker's own item, counts. A rider behind a save asks the owning player to roll it (GM→player user query, GM sender required) and falls back to the GM's client. StatRiders.save also takes a title, for Overland's forage and underground checks (#233). |
| `calendar/calendar-core.mjs` | 111 | Pure calendar shaping: entry cleaning and the 1000-entry cap (logged lines go first), `solarOn` (the day an equinox or solstice falls, from the generated table, the usual dates past it), `eclipsesOn`, and `dayEvents` (holidays, sun days, a season's start, eclipses and entries on one day; players miss GM-only entries). |
| `calendar/calendar.mjs` | 107 | The calendar's entries on Foundry: the `calendarEntries` world setting (GM write, everyone reads), `addCalendarEntry` / `removeCalendarEntry` / `logCalendar`, the lines logged when travel starts and ends, and the one-time move of a year-0 clock to the campaign start, 12 March 1348, off duty. |
| `calendar/eclipse-data.mjs` | 720 | GENERATED by tools/calendar/gen-eclipses.mjs from Astronomy Engine: the eclipses visible from Avignon 1200-1500, the day of each equinox and solstice, and one real new moon, all as the Julian dates Foundry's Simplified Gregorian calendar prints. |
| `camping/camping-app.mjs` | 102 | Camping controller hosted inline in Party Travel for native owner-choice task setup, food/fuel decisions and persistent results. |
| `camping/camping-cook.mjs` | 38 | Post-eligible-rest Cook seam and active-benefit-scoped native damage/healing/expiry compatibility. |
| `camping/camping-core.mjs` | 116 | Pure PC task choices, lock, exact shared-first torch cost and scoped Cook surplus/expiry rules. |
| `camping/camping-nutrition.mjs` | 120 | Actor/day whole-meal accounting, personal-first then automatic Party rations, per-effect starvation and eligible normal-rest receipts across parties/reloads. |
| `camping/camping.mjs` | 269 | Authenticated owner-choice camp task relay, persistent results/rewards, nearby-PC fire and deferred native nutrition/rest seams for Overland nights. |
| `carousing/carousing-app.mjs` | 65 | Carousing controller hosted inline in Party Travel, with GM table/manual-place setup, each PC owner's own-spend choices, persistent results and independent history. |
| `carousing/carousing-core.mjs` | 75 | Pure imported basic table adapters, owner choices/funds/holiday/cooldown preflight, supported effects and stable recap shaping. |
| `carousing/carousing.mjs` | 186 | Authenticated native per-PC carousing authority, saved rolls/atomic costs and effect progress, off-duty time, independent history and recap upsert. |
| `dying/dying-core.mjs` | 234 | Dying rules (#181), pure: the dying-modifier vocabulary (Active Effect flag keys: timer die and bonus, rise range, own and near stabilize DC, no death at CON 0), the 1d4 + CON timer (minimum 1; none under Deadly, whose 1 beats every die and bonus), stabilize DC resolution (15, Deadly 18, raised near a Draugr, the helper's own DC beats both), shouldTick (once per round of a scope, forward only), the turn-start outcome, what an HP change means (Fatality: 0 HP kills), which stabilize cards count, and the strip badge with the hidden timer. |
| `dying/dying.mjs` | 584 | Dying on the active GM (#181), one queue per actor: 0 HP from updateActor gives the Dying status; a wrapped Combat#_onStartTurn and the crawlRound hook, once per round and forward only, roll the death timer on the first turn (the owner's client rolls the natural die by user query and the GM adds the modifiers; blind on the GM's under the hidden timer, #263) and the d20 on every turn after (rise, tick, dead + defeated). Stabilize cards, first roll or Luck reroll, are read in createChatMessage against the GM's own DC; another GM's buttons and crawl ticks are relayed (gmDo). onConZero is stat damage's death. The strip badge and its menu. Off while Crawl Helper is active. |
| `hex-map/a0-print.mjs` | 173 | The Western Reaches A0 print, pure (#257): its lattice as numbers only (D1), isA0 by the image's size, A0_TOTAL (4736 hexes), a0Origin (the printed 0000 on a scene's grid from the image's rect, checked on four corner hexes), copyTags and copySource (another scene of the same print), and playablePlan (which of anchor, copy, pins, handoff, fog and legend Make this map playable runs, each gated on its own done). |
| `hex-map/a0-prompt.mjs` | 39 | The one-time offer to make a Western Reaches A0 scene playable (#257): on canvasReady the active GM, on a scene showing the print that isn't numbered, is asked once (the scene's hexPlayableAsked flag); yes runs HexTaggerApp.makePlayable. |
| `hex-map/bitmap.mjs` | 145 | 0/1 cell bitmaps: dilate, 8-connected components, majority stamps, hex masks, residual features, label zone. Pure. |
| `hex-map/classify.mjs` | 886 | Nearest-exemplar terrain + stamp-subtraction river/path classifier with a review queue; truth-CSV comparison for the dev check. Pure. |
| `hex-map/coordinate-overlay.mjs` | 109 | Opt-in per-user native published-number labels on flat-top hex maps; reads native geometry and current fog without changing numbering or calibration. |
| `hex-map/extras-records.mjs` | 27 | Read-only SDX legacy/authoring record reader, retained for painter-feature merges and unadopted gameplay; native adopted scenes use hex-records instead. |
| `hex-map/geometry.mjs` | 221 | Hex numbering by cube difference from one anchor cell; printed offset ↔ cube under the map's column-shift rule. Pure. |
| `hex-map/hex-adoption.mjs` | 145 | Read-once SDX record adoption with negative offset parsing, lossless original archives, existing-native conflict precedence, reports and automatic eligibility hooks. |
| `hex-map/hex-brush-app.mjs` | 262 | The hex brush: a small window that sets one terrain (a picture tile per Legend terrain) plus features, so clicking or dragging across the tag overlay retags whole patches; a stroke is one scene write and Undo puts it back. |
| `hex-map/hex-explorer-app.mjs` | 103 | Small scene-offset GM Hexplorer editor for terrain, line/structured features, public/private notes, document links and discovery. |
| `hex-map/hex-explorer.mjs` | 221 | Player-safe Hexplorer canvas hover/select observer and GM writes over authoritative terrain tags and rich offset records; preserves discovery and imported metadata. |
| `hex-map/hex-fog-core.mjs` | 91 | Pure shared terrain/location disclosure, lossless fog/history migration, native-grid sight and arrival/overlap decisions. |
| `hex-map/hex-fog.mjs` | 189 | Adopted-scene native static fog overlay, GM disclosure, selected-party committed visits/arrival history and SDX ownership guard. |
| `hex-map/hex-legend-session.mjs` | 88 | The Hex Tagger's Legend without its window: runs the tagger unshown as the engine (reads the map, builds the picture cards, applies the names) and hands a page just the cards and five calls, so the import wizard can show them on its Terrain page. Also legendNamed(scene). |
| `hex-map/hex-map-controls.mjs` | 85 | The Hex map group on the left toolbar (GM, any scene with hex numbering): show terrain tags, regions and encounter zones, the paint brush, the most-likely-wrong review and the Hex Tagger, each calling what the tagger's own buttons call; refreshed through the hexTools hook when an overlay or the brush opens or closes. |
| `hex-map/hex-map-flow.mjs` | 499 | Hex map from an image: file dialog, lattice detection, confirmation preview with corners set by hand, upload into the world folder, an aligned scene (stretch to Foundry's pitches, offset to cell 0,0), tagger opened on its legend. |
| `hex-map/hex-number-api.mjs` | 47 | `hexMaps.numberAt` / `hasNumbering`: the tagger's published hex number for a Foundry offset on a numbered scene, synchronous, so Shadowdark Extras' Map Coordinates shows what the tagger shows. |
| `hex-map/hex-picture.mjs` | 188 | What the hex brush shows per terrain (pure): the Legend palette's terrains only, which tagged hex stands for each, the hexagon mask and printed-number patch geometry, and the edge-ink test that rejects a neighbour's border bleeding in. |
| `hex-map/hex-pins.mjs` | 124 | Keyed hexes as map notes: deploys the crawl journal into the world with stable ids (links rewritten), plans one Note per keyed page at its hex centre (pure planner), moves existing pins on re-run. |
| `hex-map/hex-prints.mjs` | 86 | What is known of each book's hex map, pure: which book's key locations pin onto it, where its crawls are filed, the printed number of its first hex, and for the two black maps the grid finder cannot read (the Black River, joined from two halves, and Morzomotha) their measured grids. Numbers and names only, no part of the print. |
| `hex-map/hex-records.mjs` | 231 | Scene-offset native rich-record facade over existing tags, keyed pins/pages and regions, private compendium records and allowlisted public disclosure projections. |
| `hex-map/hex-region.mjs` | 317 | Which region is a hex in: the book's own word for a keyed hex, the nearest keyed hex's region for any other (84.8% on the Western Reaches, leave-one-out over the book's own keyed rows). Seeds come from the filed crawls; nothing is stored. |
| `hex-map/hex-tagger-app.mjs` | 1904 | Hex Tagger AppV2: contact sheet over the active hex scene, anchor numbering, tags on the scene flag, dataset hand-off. |
| `hex-map/hex-tagger-tabs.mjs` | 14 | Hex Tagger tab list and the pure rule that keeps the chosen tab when the scene still offers it, else Sheet. |
| `hex-map/ink.mjs` | 62 | Whole-image 0/1 ink bitmap at a working scale, one browser resize then strip reads; ink threshold from the paper's brightness. Browser-bound. |
| `hex-map/lattice.mjs` | 448 | Hex lattice detection from a map's ink: row and column pitch by autocorrelation, phase by folding long horizontal runs, the hex field by outline support with frame-cut half cells, edge-band pitch refinement, and a lattice hung on two hand-placed corner cells. Pure. |
| `hex-map/legend.mjs` | 250 | The legend: cells grouped by glyph with k-means++ over masked cell features (restarts, lowest inertia kept), one card per group with sample members and a core that becomes the hand tags. Pure. |
| `hex-map/reference-tile.mjs` | 130 | Hidden reference tile: places the tagged print on a painted hex scene so its hex field covers the first cols × rows cells; two-rectangle placement, non-uniform scale, create-once-then-update. |
| `hex-map/region-scan.mjs` | 238 | Region borders read off the print: the thick line a hexcrawl map draws along a hex edge, measured across the whole edge so a river crossing it is not mistaken for one, then flood-filled into enclosures. Reuses the cell bitmaps the tagger already built, so it costs no extra image reads (45 ms for 4768 hexes). Pure. |
| `hex-map/sampler.mjs` | 185 | Reads the active scene's background per hex cell (one drawImage each) for bitmaps, thumbnails and the brush's masked hex pictures; scene→image transform from the drawn sprite. |
| `hex-map/tag-corrections.mjs` | 337 | What the GM judged about the classifier, kept on the scene: per-cell corrections (was, now, margin, whether it was flagged) and wrong/judged counts per margin band, plus the scene's review margin and the report that says what it catches. Pure. |
| `hex-map/tag-overlay.mjs` | 853 | The tag overlay: every numbered hex drawn on the map in its terrain colour, dots for river/path/coast, an amber ring on unsure automatic cells; hover names a hex, a click edits it through the same scene-flag write. |
| `hex-map/tag-store.mjs` | 517 | The tagger's scene-flag store: compact `terrain;feature\|source` strings (terrain is what a hex is, features what runs through it), coast derivation, sheet selection (random/keyed/review), dataset tags. Pure. |
| `holidays/holidays.mjs` | 383 | Holidays for carousing (#191): the four City of Masks holidays (CS6 pp.46-47) as recipes (name, page, place, `when` anchor, carousing mechanics, garb questions with modifiers), no book wording; pure `whenMatches(rule, dateInfo)` / `placeMatches`, and `holidays.list()` / `today({place})`, which list a holiday once its page is imported by the Chapter-to-journal preset. `currentDateInfo()` reads the core calendar, with `isLastFullMoonOfYear` from the time API's `anchor("lastFullMoon")` (#227), so Lastmoon falls. |
| `holidays/holy-days.mjs` | 86 | The gods' holy days for the calendar (Player's Guide pp.190-205): name, god, printed page and a timing rule over the calendar's seasons and moon (a day, a stretch of a season, or a moon), no book wording; `holyOnDay` and `holyWindows` say what shows on a day or only in a month. The four with no date are left out. |
| `luck-reroll/hard-luck.mjs` | 57 | Hard Luck Mode (GMWR p.30, #186), pure: the system's criticalFailure test with a plain-d20 fallback, and the luck-granting spell/ability (Bless, Trance, Omen) a roll came from, by name. |
| `modes-of-play/blitz.mjs` | 100 | Blitz Mode (#179): lighting a Basic light source clamps its remaining time to 30 min (and marks it used); a light spell's Effect is created with 30 min. Pure patch helpers + preUpdateItem/preCreateItem hooks. |
| `modes-of-play/chaos.mjs` | 233 | Chaos Mode (#180): reroll every combatant's initiative (Combatant#getInitiativeRoll) at the start of rounds 2+, one combatant update with combatTurn 0, one card per round without hidden combatants; off under clockwise initiative. The round's turn events are held (combatRound hook) and replayed through Combat#_manageTurnEvents around the reroll, so the new top starts first (#259). Called from turn-skip.mjs under its lock. |
| `modes-of-play/hunter.mjs` | 98 | Hunter Mode (#184): on deleteCombat (not a Delete Encounter discard) the active GM pays every PC in the fight XP for each NPC still defeated (half its level, level 1 → 1) through PartyXP.award, one card. Pure hunterXp/hunterAward + payHunterXp. |
| `modes-of-play/pulp-core.mjs` | 127 | Pulp Mode pure half: critExtraFormula (the dice a crit adds to rolled damage, per applyCriticalHit), showLuckCrit, showForceReroll. |
| `modes-of-play/pulp.mjs` | 293 | Pulp Mode (#185): session luck on the sessionStart hook (1d4, set), and the Luck: critical hit / force a reroll chat buttons. Both relay to the active GM (PULP_QUERY), which checks the requester, spends the token and edits the card. |
| `overland/encounter-panel.mjs` | 109 | The clock HUD's Encounter panel (#257): a quiet travel check's hit as the GMs see it until Continue: the check (step 6 or 8, its hour and chance), the chain of tables it went through as chips (zone and its roll, category, the region's table and its roll), the creature with its art and number appearing, the distance, activity and reaction rolls in words, a second category's draw, and Post to chat and Continue; encounterCard gives the chat card's data at CHA +0. |
| `overland/find-party.mjs` | 38 | The clock HUD's two party buttons: Find pans to the party token, pulses on it (this client only) and selects it when the viewer can, naming another scene if that is where it is; the other opens the party sheet. |
| `overland/hex-rules.mjs` | 167 | Hex rules on hex maps (#257): at init, the Token class never lights a hex-rules scene (a tagged print or an Extras hexcrawl) and the visibility group gives it no token vision, at runtime with no data written; the Enhancer party actor (flag party) placed as a hex token when travel starts with no party on the map; the travel token made to wear the black party hex (icons/party-hex.svg). |
| `overland/hud-core.mjs` | 343 | The clock HUD, pure (#253): who sees the bar, the GM's steps in the calendar's units, the sky dial as a half disc (its model: the disc turning 15 degrees an hour with now at the bottom, day and twilight sectors, an hour ring with sunrise and sunset badges, the moon on its track by phase; the region and terrain fitted to the disc; and its SVG), which party token Find picks, the season band's hatch, the month grid read back day by day from the calendar (moon quarters, today, holidays by a callback) and a typed date to a worldTime. |
| `overland/overland-bar-core.mjs` | 74 | The travel bar (#234, O8), pure: where the sun (sunrise to sunset) or the moon (sunset to the next sunrise) stands on the sky dome's arc, the moon's shadow offset by phase, and the bar's model for one viewer (members' rations and forage state, Forage only on owned members of an open unpushed day, and the check hours for a GM only). |
| `overland/overland-bar.mjs` | 852 | The clock HUD (#253, #257 look; was the travel bar #234): on hex maps only (any hex grid, #298), for whom the clockBar setting says, hidden in combat. The bar: date with the year, time, Stopped while an encounter holds the travel clock, the sky chevron, on a hex map the travel plate (hexes left) or Start travel, and for a GM the rewind/advance step columns, the Time panel (jump to the next dawn/noon/dusk/midnight, set a date, the real-time clock) and the month view (moon quarters, imported holidays, a day click jumps). Under it the season band and the sky dial SVG. Steps go through Overland's clock action; calendar jumps forward go off duty. The Crawl Strip moves under it (body.sde-clock-on). |
| `overland/overland-state-core.mjs` | 670 | Overland travel state (#229, O3), pure: the one travel state's shape (token, members, method, the open day and its budget, weather, checks, forage, the travel token's hex), its normalization, the startTravel / setHex / recordForage reducers, the travel-token choice (the one Extras party token, else the one selected token), the forage refusal rules, and the weather (#230, O4): the setWeather reducer, whether a weather holds, the advantage a roll has (a Western Reaches 6 gives the next roll 2d6kh; a reroll keeps the replaced roll's), the weather from a d6 under the Western Reaches or core rule, whether today is harsh, and a hex's cost with the weather; and the travel day (#231, O5): openDay (budget, push, clock rate fixed at the day's start), spendMove, priceMove (displaced legs free, unknown terrain 1) and moveVerdict (no day, pending, impassable, bounce); and the encounter checks (#232, O6): dayChecks (two by day 06-17, two at night 18-05, 1 or 2 in 6), dueChecks, markCheck and setPending; and the day's end (#233, O7): forageRefusal's travel rules (no day, pushed, harsh storm), forageDC, closeDay and planRations (each member's own, a single ration none when harsh, mounts from what's left). |
| `overland/overland.mjs` | 1460 | Overland travel (#229): the overlandState world setting (active-GM writes in one queue, payload-free re-read nudge), Start and End travel (another GM's forwarded to the active GM), the players' relayed Forage with the sender checked from the query context, overland.state() with hexes left, climate, storm, harshness and night derived, rollWeather (GM; dice rolled on the active GM, one chat card, the overlandWeatherRule setting), startDay and its dialog (the weather first, then the budget; a boat actor's speed when sailing aboard one), the travel token's moves (preMoveToken refuses on the mover's client; moveToken on the active GM spends, records the hex and advances the clock, or sends an overdrawn move back with a displace), advanceTravel (rolls each check due at its hour through encounter.check; a hit stops the clock and leaves pending) and resume (Continue), forage (the owner rolls INT through StatRiders.save after the queue; a success adds a ration), makeCamp (lights out through advanceOffDuty(0), the clock to dawn or the last night check, then Extras' camping.open or Overland's own rations, the day closed and the weather rolled), the underground season check on timeAdvanced, and the overlandChanged / overlandStart / overlandEnd hooks. |
| `overland/party-choice.mjs` | 23 | The dialog that asks which party is meant when a world has several: Start travel uses it when more than one party has a token on the hex map (or none is on it), and the choice becomes the party the GM sees. |
| `overland/route.mjs` | 369 | The route on the hex map (#257): with the travel token selected while travelling on a tagged hex map, the cheapest route (overland-state-core cheapestRoute over the grid's neighbours, priced as a move) is drawn to the hovered hex with each hex's cost and a tooltip (hexes, miles, points, hours, or why there's no way); a click walks the party there one hex a move, stopping at an encounter, a bounce or the end of the day's points. |
| `overland/sky-core.mjs` | 132 | The sky on scenes (#235, O9), pure: darkness by the sun and moon (0 by day, a four-hour cosine twilight each way (#389), night 1 - 0.2 x illumination, the hex map capped at 0.6), the Isles of Andrik's Midnight Sun and Long Dark by region and season, the weather effect (rainStorm, blizzard in the cold, the season's snow or leaves on a fair day: #294), and which scenes follow the sky and are written (the active scene and the party's). |
| `overland/sky.mjs` | 249 | The sky on scenes (#235, O9): the active GM writes the darkness of the active scene and of the party's scene, the one the travel token is on (#294; only on a 0.02 change, animated for steps under an hour, never on a locked scene; no other module is consulted) and weather effect (never over one the GM chose) on each clock move, weather change and scene activation; one pass at a time. While the clock is paced every screen paints the darkness from the time it shows and the GM writes it once the slices stop (#257). Also the per-device Show weather effects setting and its drawWeatherEffects hook (#294). Adds the Follows the sky choice to Scene Configuration's Environment tab (the followsSky scene flag). |
| `overland/travel-panel.mjs` | 215 | The clock HUD's Travel panel (#257): the day as the book's travel procedure in eight steps (weather, sight, method, speed, traveling, encounters, resting, night), the step list as the day's record with the current step marked; step bodies read Overland's state (the weather and its roll, sight in hexes by hex rules, the budget meter, forage by member with INT and DC, the checks by half for a GM) and carry the day's buttons. |
| `party/party-app.mjs` | 605 | Native ApplicationV2 Party actor sheet and directory/token-HUD entry points, preserving detailed member cards with inline activities, scoped quests/payouts and description editing. |
| `party/party-core.mjs` | 32 | Pure versioned roster validation, membership permissions, groups and quest scoping. |
| `party/party-create-option.mjs` | 15 | Adds the Enhancer's Party entry to the Create Actor type list and drops Extras' duplicate Party entry. |
| `party/party-emblem-core.mjs` | 110 | Pure party emblem: the curated icon and colour sets, the default, the safe read of the stored flag and the picker's choices. |
| `party/party-hud.mjs` | 21 | Single combat-gated Import/Export Members Party token HUD action. |
| `party/party-item-picker.mjs` | 80 | The Party sheet's Add item > From compendium window: an ApplicationV2 that reads every Item compendium's index once, filters it by name as the GM types (searchItemIndex), and hands the picked entry to the sheet to copy onto the party actor. |
| `party/party-light.mjs` | 49 | Runtime-only dungeon Party light mirror without duplicated fuel items; hex lights and stored vision unchanged. |
| `party/party-movement-core.mjs` | 128 | Fixed formation fill, follow ordering, heading turns, and the wall tests: centre-line placement and a breadth-first route round walls. |
| `party/party-movement.mjs` | 196 | Authenticated Party-owner gather/deploy relay, linked token configuration preservation and native marching: followers keep the formation, turned to the leader's heading, and never pause. |
| `party/party-roll.mjs` | 138 | Request roll from the Party sheet's GM bar: posts one chat card with a Roll link per character asked; the owner's click runs the system's ability check against the DC and posts pass or fail. |
| `party/party-sheet-core.mjs` | 488 | Pure Party sheet decisions: the tab row and view flags (GM vs player), the Marching order status line, Gems, the linked Bastion and its last month, and the Today / Light / Rations status bar. |
| `party/party-token.mjs` | 44 | Uploads the party emblem as a hex-shaped token picture and keeps the party actor, its prototype token and scene tokens wearing it. |
| `party/party.mjs` | 131 | Explicit native Party provider, safe in-place NPC adoption and owner-scoped membership writes; the active GM re-checks every roster a player writes and takes off a member that player could not have added. |
| `rules-data/rules-data-app.mjs` | 423 | The GM-only Rules data window (AppV2, Configure Settings menu): shows and edits every rules table, staged until Save. Its import (importFromBooks, also the Importer Hub step's importAndSave) runs table-shapes RULES_TABLES over the GM's own linked GM Guide and Player's Guide PDFs (lazy-loaded), canonicalises region names through hex-region knownRegions, and previews every filled value it would replace. |
| `rules-data/rules-data-core.mjs` | 471 | Rules data (#195), pure: the Western Reaches lookup tables (terrain cost and elevation, terrain types, hexes per day, hex visibility, climate by region and season, carousing and recruiting limits) as one sparse world setting laid over an empty structure, the game.shadowdarkEnhancer.rules lookups over it, the readers that turn the importer's `reference` rows into those tables, and the overwrite preview and merge for an import. Ships structure only (tagger terrain words, travel methods, conditions, seasons, settlement kinds), never a value. |
| `rules-data/rules-data-notice.mjs` | 56 | The GM-only "Rules Data isn't set" notices (#299): tellMissing posts one whispered card per empty table per session, naming Importer Hub > Rules Data > Import from GM Guide with a button that opens the hub's Rules Data step; openRulesStep; the chat hook that wires the button. |
| `rules-data/rules-data-scope.mjs` | 49 | Which ruleset a scene reads: the default `rulesData`, or one of the `rulesSets` a scene names in its `rulesSet` flag. storedRulesFor for the API, Overland and recruiting; setSceneRuleset for the editor. |
| `rumors/rumor-core.mjs` | 179 | The rumor generator's rules, pure (#190): which names are rumor tables and for which region, how N rumors split between the region's table and the general one, picking rows still there to give (weighted by range, no repeats) and the rows a re-import recreated, a trouble as rumor text, the ledger page body, heard()'s shape, and a quest name from a rumor. |
| `rumors/rumors.mjs` | 394 | The rumor generator and the Rumors Heard ledger (#190): give (troubles first, then the tables in turn; rows marked drawn by the module, since core marks nothing drawn on a pack table), the Give Rumors dialog, the player-readable ledger (a page per region, rumors in the page flag, text written from it), heard() for anyone and Extras' party sheet, Promote to quest per rumor, the RollTable.draw wrap that marks a GM's hand-rolled rumor drawn, and the debounced rumorsChanged hook. |
| `time/off-duty.mjs` | 250 | time.advanceOffDuty (#228, Overland O2): the off-duty clock move. GM only; runs on the Shadowdark system's primary light GM (a GM-to-GM query when that is another GM), refuses when two GM tabs hold the flag, stops the system's real-time light clock for the move, puts out every lit Basic light the player-owned PCs carry with the sheet toggle's steps minus its per-light card (remainingSecs kept, one chat line saying whether the clock moved), rebuilds the tracker's cache and waits until it holds no PC's Basic light, re-checks the flag, then advances with the offDuty reason. A refusal or a throw never advances and reports what was put out. Pure decisions (who, which lights, where it runs, the last flag check) are exported for tests. 0 seconds only puts the lights out (Overland's camp, #233). |
| `time/time-core.mjs` | 348 | Time (#227, Overland O1), pure: readings on the core world calendar (a CalendarData) and a worldTime. Season from core's components, keyed by where its months fall in the year, sunrise/sunset on a solstice-to-solstice cosine (9 to 15 hours, ported from Calendaria, MIT), isNight, the moon's phase from an epoch on the synodic month, anchors (equinoxes, solstices, cross-quarters read back as the date the calendar shows, lastFullMoon), what a clock move crosses (days, weeks, dawns and dusks by arithmetic; season changes by jumping from one to the next, the list capped at one per season), the date's parts, and the nth dawn after a time (dawnAfter, for Overland's weather). |
| `time/time.mjs` | 156 | game.shadowdarkEnhancer.time (#227): now, season, isNight, sun, moonPhase, anchor, format over game.time.calendar and the moonEpoch world setting, and the shadowdark-enhancer.timeAdvanced hook, fired on the active GM once per world-time change with what it crossed and the offDuty reason from the advance options. Also carries advanceOffDuty and registers its GM-to-GM query. isNight takes { region } for the Isles of Andrik's skies (#235). Also the time this screen shows (shownTime, onShownTime): a paced clock step (a walk, a time-lapse) slides it frame by frame for the bar and the sky to paint (#257). |
| `training/training-app.mjs` | 292 | The Regional Training window (AppV2): pick a character, pick a trainer grouped by region, see all four benefits with the ones already taught struck through, and roll the trainer's d4. Each task can be taken as a Quest Log quest for the character (GM) and shows Taken or Done. Names a benefits table that has not been imported instead of inventing its contents. |
| `training/training-art.mjs` | 61 | One game-icons.net emblem per regional trainer, pre-tinted gold in the SVG the way the Character Builder's class art is. Fifteen reuse a vendored class emblem (often the honest pick — the assassin trainer leads the Ras-Godai); six are vendored under icons/game-icons/trainers/. Returns null rather than a placeholder path. |
| `training/training-core.mjs` | 573 | Pure metadata for the Game Master's Guide's 21 regional trainers: trainer and region names, page numbers, the benefits table each one imports as, and a recipe per d4 face — Active Effect changes, one-time actions, either/or branches, or a stated reason the table must handle it. Ships no rules text; the book's wording is read from the GM's own imported table. Also the "once each" helpers and the roll walk. |
| `training/training-grant.mjs` | 306 | Grants one training benefit for real: finds the GM's imported benefits table by name, reads the book's line for that d4 face, writes the Talent with its effects and provenance flag, and runs the one-time actions (permanent HP, a renown award through the ledger, an ability reroll, a granted weapon or item). Enforces "once each" off the character's own Talents. |
| `training/training-journal.mjs` | 210 | Files the 21 trainer spreads as journal entries in the managed sde-journal pack, one entry per trainer foldered by region, read from the GM's own registered GM Guide PDF. Identity is a flag, so re-running updates in place and adopts a page whose flag went missing rather than adding a second. |
| `training/training-parser.mjs` | 109 | Reads one trainer spread out of column-split PDF text: the trainer's description and the four numbered TASKS. Knows the page's shape only — the display title sorting after the tasks, a bare page number landing inside the task block, tasks wrapping across lines — and never the benefits, which import as a RollTable. Pure; ships no book text. |
| `traps/trap-core.mjs` | 130 | Trap logic that needs no Foundry: reads a Core Traps roll or an adventure's printed trap line into a trap record (check, damage, every round, chance), decides whether a trap can spring, builds the chat card. |
| `traps/traps.mjs` | 324 | The `shadowdark-enhancer.trap` Region behavior (fires on entry, every round, or by hand; posts a pass/fail roll card), the Core Traps generator, the behavior form's buttons, and `game.shadowdarkEnhancer.traps`. |
| `troubles/trouble-core.mjs` | 117 | The Trouble tracker's rules, pure (#193): the weekly check's growing chance, the week starts a clock jump crosses, the Region table's printed names matched to the imported regions (", The" moved, abbreviated words), the settlement kind a row names, an inline Type of Trouble list, Urgency Level rows, and the countdown's stage times. |
| `troubles/troubles.mjs` | 450 | The Trouble tracker (#193): the weekly check on every week start the world clock passes (timeAdvanced, active GM, queued), stirring a trouble in a settlement picked from the imported key locations, one GM-only page per trouble in a flagged Troubles journal entry with its state in the page's trouble flag, stage whispers as the clock passes each stage, the page's status bar and buttons (heard, promote to quest), resolving on its quest's completion, the Journal sidebar's Check for trouble button, and the troubles API. |

### 3.2 `scripts/shared/` — cross-feature infrastructure

| File | Lines | Description |
|---|---:|---|
| `module-id.mjs` | 8 | Single source of truth for the module ID (highest fan-in file: 58 importers). |
| `source-keys.mjs` | 75 | One canonical key per source book (core/cs1-6/wr) across every spelling. |
| `curated-icons.mjs` | 477 | The one curated-icon resolver (A4), pure and Foundry-free. Six issue paths want a reviewed Foundry-native icon for an item this module imported or generated; rather than each growing its own name matching (as `core-monster-spell-icons.mjs` did for Monster Spells), they share this. TWO KEY SPACES, and the split is structural rather than stylistic: weapons, armor and basic gear key on `normalize(name)` alone, because `defaultItemImg` — the module's single automatic art-choice channel — cannot know which book a draft came from (source is a commit-time batch option threaded through `createItems`, reaching the document only afterwards as a flag), so a source-qualified gear key would be unresolvable at the one place gear art is chosen; treasure keys are `<sourceId>:<normalize(name)>` via `sourceKey`, because its names are book prose two Cursed Scrolls could both print. Map keys are DERIVED from display names, never hand-written beside them — the reviewed source spec drifted exactly that way — and map construction is TOTAL: a duplicate key, blank name or path that is not a native `icons/**.webp` drops that row into `problems` and leaves the item on its fallback, because throwing at load would take the module down over an icon. `auditCuratedIconRegistry` aggregates those for the test gate. Registration is BY IMPORT (`registerCuratedIconMap`) so the tickets owning the rows never edit one shared list. `isCuratedApplyTarget` is a `world.` allowlist, not a denylist: `LootLinker` resolves rows system-pack-first by design, so a plunder row's uuid routinely points into `shadowdark.gear`, and a materializer applying art to whatever it just resolved would edit the base system compendium. Unmatched returns null — never a guess, because a wrong curated icon looks deliberate. |
| `curated-icon-maps/index.mjs` | 78 | Discovery point for the curated-icon maps (A4). Each reviewed map lives beside this file as its own module, publishes itself with `registerCuratedIconMap` at import time, and becomes reachable when this index side-effect-imports it. Loaded once from the module entry point so every consumer sees the same registry regardless of load order. A ticket adding a map creates ONE file and appends ONE import line, so two tickets never collide on a shared array literal. Carries the worked example and the four invariants the audit enforces: native `icons/**.webp` paths, keys derived from display names, bare-space names globally distinct across the weapon/armor/gear maps, and treasure rows qualified by book. The D1 weapon, D2 armor, D3 Basic Gear, D4 Sea Wolf Plunder, D5 Dead Bandit Loot, and D6 Diabolical Treasure maps are the active production registrations; an uncovered category remains on null lookup and its prior fallback/provenance behaviour. |
| `curated-icon-maps/armor-icons.mjs` | 26 | The reviewed N3 armor map (D2): nine canonical armor names plus four deliberate mithral source-spelling aliases, registered through A4's bare normalized-name key space. Each alias shares its canonical armor's Foundry-native icon; category tests audit all 13 accepted rows against the real public/icons inventory and exercise A3 upgrade/preservation provenance. |
| `curated-icon-maps/dead-bandit-loot-icons.mjs` | 39 | The N3 §5.3/D5 Dead Bandit loot map: exactly 20 CS2 p68 source-qualified canonical Item names and reviewed native Foundry `icons/**.webp` paths. Feature prose and optional terminal prices stay on the source TableResult rather than entering the art key. |
| `curated-icon-maps/diabolical-treasure-icons.mjs` | 38 | The N3 §5.2/D6 Diabolical Treasure map: exactly 20 CS1 p68 source-qualified Item names and reviewed native Foundry `icons/**.webp` paths, registered through A4; feature text stays with the D6 materializer rather than the art key. |
| `curated-icon-maps/gear-icons.mjs` | 57 | The N3/D3 Basic Gear curated icon map: 44 source-agnostic bare-name rows covering Core/Western Reaches gear, including explicit quantity and spelling aliases. Each path is a reviewed native Foundry `icons/**.webp` asset; registration occurs at import time through the A4 discovery seam. |
| `curated-icon-maps/sea-wolf-plunder-icons.mjs` | 38 | The N3 §5.1/D4 Sea Wolf Plunder map: exactly 20 CS3 p68 source-qualified item phrases and reviewed native Foundry `icons/**.webp` paths, keyed without each row's terminal gp price. |
| `curated-icon-maps/weapon-icons.mjs` | 47 | N3's 37 reviewed Foundry-native weapon icons, keyed by source-agnostic normalized final Item name and registered through the A4 discovery seam. |
| `attack-card.mjs` | 107 | Reading a Shadowdark attack card — was it an attack at all (a targeted spell is not), did it land, who was it aimed at, who swung. Shared by Parry and Taunt so the two can never disagree about the target (they once did, silently). |
| `settings.mjs` | 940 | All `game.settings.register` calls + migration-safe defaults. |
| `icons.mjs` | 101 | Centralized icon registry — FontAwesome snippets and vendored SVG references. |
| `i18n.mjs` | 19 | `L(key, data)`: one string from `languages/en.json`, localized, or formatted when there is data; the key itself before Foundry's i18n is mounted and in node tests. The one copy of the helper some 60 files used to define for themselves (as `L` or `t`). |
| `compendium-suite.mjs` | 471 | Find-or-create layer for managed world packs, ownership, sidebar folders, and source folders. |
| `loading-dialog-guard.mjs` | 112 | Guards the system's leaked `LoadingSD` spinner when `ItemSheetSD.getData` throws. |
| `art-utils.mjs` | 164 | Portrait/token image resolution across world + compendium sources. |
| `coins.mjs` | 109 | Pure Shadowdark currency math (10cp=1sp, 10sp=1gp). |
| `esc.mjs` | 16 | HTML-escape helper for safe `innerHTML` interpolation. |
| `chat-cards.mjs` | 80 | Markup builders for the module's chat cards (UI kit `ui-cc` parts). |
| `file-route.mjs` | 16 | Routes a stored file path for fetching; leaves absolute upload URLs (The Forge, S3) untouched instead of handing them to getRoute. |
| `gm-relay.mjs` | 405 | The one authenticated relay channel, both directions. Rides Foundry's user-query transport, where the SERVER stamps the sender from the authenticated socket, so an identity check can no longer be defeated by a payload naming a GM. Owns the shared ownership gate (`authorizeActorFor` / `authorizeActorRequest`), the GM-side entry guard (`refuseQuery`), the player-side `queryActiveGM` / `relayToGM`, and `notifyPlayers` for a GM→players push that the receiver can verify. A query the GM's build cannot answer is itself the stale-tab signal, so the old forgeable ping/pong handshake is gone while its wording (`evaluateHandshake` / `handshakeWarning`) is kept. |
| `token-placement.mjs` | 238 | Click-to-place token placement over a QUEUE of different creatures — a pit-fight row can name two creatures with their own counts, so the loop walks a queue and the notification names what the next click will drop. `worldActorFor` imports a compendium actor once and reuses it by name+type (with a one-shot art repair on copies imported before a community-tokens mapping loaded), `tokenSourceFor` picks the best non-placeholder texture, and `placeTokensByClick` runs the cancellable capture-phase `pointerdown` loop, snapping to the grid. Every actor and texture is resolved BEFORE the first click, so no await sits between a click and its token. |
| `art-provenance.mjs` | 262 | Explicit art provenance for imported Items (pure), replacing the old `img.startsWith("icons/")` guess. Every image the module writes is stamped `flags[MODULE_ID].art = {state, img}`, so the next import compares the stored image against the path it actually wrote: still equal means the recorded state stands (`default` / `imported` / `curated`, all upgradeable), and any divergence is `custom` — the GM's, and never overwritten. The guess it replaces was wrong in both directions: this module's own bundled Shikashi defaults live under `modules/shadowdark-enhancer/assets/` and so failed the `icons/` test and erased hand-picked art, while a deliberate curated `icons/...` pick looked like a default and could never be upgraded. Legacy unmarked documents are classified deterministically and conservatively — an image byte-identical to the module's default pick for that name and type today (or no image at all) is `default`, everything else is `custom` — and the first re-import stamps the verdict so it never drifts. Also carries the structural generated-artifact boundary (`isGeneratedManagedItem`): the explicit `flags[MODULE_ID].generated` marker PLUS membership of the managed Items pack, the one case that stays replace-always, art included (A7/D6). Exactly ONE marker, deliberately — "generated" is not a single policy here. The Monster Spell library also generates documents but preserves hand-edited ones as curated conflicts, and since A1 they share this pack, so recognising its `monsterSpell.generated` bookkeeping would let an ordinary name collision overwrite a spell the GM had curated. Foundry-free, node-tested. |
| `clipboard.mjs` | 46 | `copyText()` — clipboard write that survives insecure origins, where `navigator.clipboard` is undefined; falls back to a hidden textarea + `execCommand`, restores focus, and never throws. |
| `contextual-enricher.mjs` | 198 | The one contextual check/request/roll enricher (A5), pure and Foundry-free. #56 wants an Arctic Sea row's "DC 15 DEX or 2d4 damage" to become a clickable check; #61 wants the identical prose in a monster's stat block to become a GM-side REQUEST instead. Same characters, different button — so the syntax CANNOT be inferred from the text, and this module refuses to try: the caller states a context (`table`/`environment`/`monster`) and an unknown or missing one throws rather than defaulting, because the failure this seam exists to prevent is one syntax silently serving every context. `table` and `environment` share a command today and stay separate names so a later divergence is a one-line change here rather than a caller-side edit. Emitted forms are dictated by the system's own enricher (`systems/shadowdark/src/enrichers.mjs`, `\[\[(check\|request)\s(\d+)\s(\w{3})\]\]`): exactly one space between tokens and a THREE-letter ability key, so "DC 15 Dexterity" must emit `dex` and any spacing variation is dead markup that renders as literal text. Enrichment is a FIXED POINT, and that is why it is a character mask rather than a chain of `String.replace` calls: `[[…]]` macros, `@UUID[…]{…}` labels and HTML tags are masked off before any rule runs, so a second pass returns the same bytes and no rule can rewrite the inside of another's markup — the mask also makes the rules mutually exclusive, so rule ORDER is a policy statement (checks are the more specific reading and win) instead of an accident of replacement order. Conservative by design: only a fully determined expression converts, so a bare "DC 15" or "DC 15 damage" stays prose; nothing is ever deleted or reordered, only wrapped. `enrichDice` is the dice half alone, and `monster-linker.convertDice` delegates to it rather than keeping a second copy — the local rule it replaces guarded only the exact `[[/r ` prefix, so it double-wrapped the second term of `[[/r 2d4+1d6]]` and rewrote dice inside an existing link label. |
| `curated-icon-maps/spell-icons.mjs` | 102 | Reviewed Foundry-native icons for the 77 imported spells that all shared one generic casting hand, keyed by spell name and chosen from each spell's description. Defined, not registered: resolved through a spell-only registry so a spell never inherits an item map's art. |
| `generated-items.mjs` | 650 | Stable identity and replace-always reconciliation for generated managed Items (A7/#57-#59) — the PRODUCER half of the boundary `art-provenance.mjs` defined and left unowned. The invariant is structural and both halves are required: a document is replace-always iff it lives in `world.shadowdark-enhancer--items` AND carries `flags[MODULE_ID].generated === true`. Neither is inferred — not from an image path, a name, a folder, or another pipeline's bookkeeping — and `planGeneratedItems` refuses outright for any other pack rather than reconciling something it has no authority over, which is what stands between an authoritative rerun and editing the system gear compendium. Identity is `flags[MODULE_ID].generatedItem = {id, source, key, fingerprint}` where `id` is FNV-1a/32 over `<canonical source>:<normalized name>`: derived from the definition, so it is identical on every machine and stable across a rerun that changes art, price or prose, and deliberately NOT the world-local document id, the image path (the thing A3 was written to stop reading) or a fuzzy name (the thing #58 was about). Reconciliation indexes on `id` but writes only when the stored canonical `key` also matches; a hash/key mismatch is an `identity-collision` refusal, not a wrong-target update. `name` appears only in the REFUSAL path, where a name already held by a document we do not own — since A1 that can be a generated Monster Spell, whose `monsterSpell.generated` marker means PRESERVE, the opposite thing — is reported, never taken over. Replace-always but not write-always: a rerun is `unchanged` only when the definition has not moved since we last wrote it AND no declared field has been edited since, so hand edits including art are replaced while an idle rerun writes nothing. The two-witness test is what makes a hand edit visible, and the stored document is PROJECTED onto the declared shape recursively — including non-empty ActiveEffects — before comparison so Foundry's own DataModel defaults and embedded ids are not read as an edit. `folder` is excluded — placement is the GM's. Updates carry forward undeclared top-level third-party flag namespaces through both replacement branches. Pure above the divider; the applier below reports create/update/missing-target failures, while a failed recreate deletion remains a visible duplicate requiring GM cleanup (retryable, not transactional). |
| `hover-peek.mjs` | 94 | Hover-to-enlarge for an image grid: one reusable fixed-position preview that flips away from the viewport edge and never takes the pointer. Shared by the character builder's art gallery and the Token Art Manager's image browser, which cannot scale a tile in place because their grids scroll. |
| `module-flags.mjs` | 163 | What this module owns on a document's flags, and what survives a wholesale replacement (pure). `replaceDocument` updates with `recursive: false`, which is right for `system` and wrong for `flags`: a creation payload knows only the bookkeeping ITS pipeline stamps, so replacing the object outright deletes every other pipeline's — including `monsterSpell.libraryId`, the only handle the Monster Spell planner has on a generated spell, whose loss makes the next refresh create a duplicate (A8/#93). `preservedModuleFlags` starts from the stored flags: a namespace the payload never mentions survives whole (another package's automation, `core`), and a namespace both carry is merged key by key — keys the payload declares win, keys it never mentions survive — for this module's and every other package's alike. `replacementFlags` then answers the two replace branches SEPARATELY, because they are not symmetric — an update keeps the document, so a payload declaring no flags correctly omits the key and the stored object is never touched, while a recreate DELETES the original and must therefore carry those blocks itself or lose them (the defect that quietly recreated a Monster Spell without its `libraryId` on any forced fallback or type mismatch). Also carries `isGeneratedMonsterSpell`, read from the library's own `monsterSpell.generated` marker and never from the A7/D6 `flags[MODULE_ID].generated` replace-always marker — the two contracts share the managed Items pack and mean opposite things. Foundry-free, node-tested. |
| `property-note.mjs` | 194 | Stamps and preserves the "no core Shadowdark property" note on imported gear (pure). Also owns which description survives a REPLACE: the GM's own text beats importer output, and importer output is the empty placeholder, the note alone, or — since A8 — a description that merely echoes the document's name, which is exactly what `buildItemData`'s Spell path writes when a paste brings no prose. |
| `setting-groups.mjs` | 190 | Feature groups for Configure Settings — which settings, nested editors, other packages' settings and notes each pop-out shows, in display order, incl. the Modes of Play boxes. Pure data; the docs-contract test imports it. |
| `settings-group-menu.mjs` | 210 | The per-feature settings pop-out (ApplicationV2): builds a DataField per setting the way SettingsConfig does (other packages' settings too), renders nested editor buttons, notes and Modes of Play switches, saves on submit, and mints one registerMenu class per group. |

### 3.3 `scripts/crawl-strip/` — the top strip + movement + combat sync

| File | Lines | Description |
|---|---:|---|
| `crawl-strip.mjs` | 1706 | The core feature: the top strip. Plain DOM (`#shadowdark-enhancer-strip`), not ApplicationV2. |
| `crawl-state.mjs` | 515 | Foundry-coupled state singleton — persistence, sockets, hook emission. |
| `crawl-state-core.mjs` | 414 | Pure reducer/normalizer behind crawl-state. Node-testable. |
| `crawl-lights-core.mjs` | 93 | Pure light-source logic for the strip's flame badges. |
| `crawl-tracker.mjs` | 346 | The out-of-combat tracker as a real sidebar tab (`AbstractSidebarTab`), registered into `Sidebar.TABS` + `CONFIG.ui` beside Combat. Hidden unless a crawl is running; carries the roll-all / advance / reset controls. |
| `crawl-tracker-core.mjs` | 138 | Pure view model for the tracker tab: `buildTrackerRows()` (rolled first, unrolled last, holder flagged), `showOocReset()`, and `parseInitiativeInput()` — which treats a blanked box as "no change" rather than the initiative of 0 that `Number("")` yields. Node-testable. |
| `initiative-manager.mjs` | 137 | Combat/initiative state machine glue for the strip. |
| `hidden-sync.mjs` | 69 | Bidirectional `token.hidden` ↔ `combatant.hidden` sync, GM-only. |
| `turn-skip.mjs` | 163 | Auto-advances past combatants the strip renders no card for (dead enemies). Active-GM gated. Also drives Chaos Mode: queues each held Chaos round (updateCombat) and replays it under the same lock (#259). |
| `turn-skip-core.mjs` | 164 | Pure strip-visibility test shared by the strip and the auto-skip, so the two can't drift. |
| `movement-tracker.mjs` | 817 | Crawl-mode movement budget enforcement + turn-start rollback (`displace` waypoints). |
| `movement-calc.mjs` | 88 | Pure per-segment feet-moved math. |
| `npc-action-menu.mjs` | 633 | Per-combatant hover action HUD. |
| `crawl-turn-core.mjs` | 121 | Pure turn-advance authorization for the crawl strip: `canAdvanceTurn()` (a GM always may; a player only when they own the current combatant and the advance would not roll the round) and `nextTurnWouldRollRound()`, mirroring `Combat#nextTurn`'s real wrap rules. |
| `movement-lock-core.mjs` | 78 | Pure `shouldBlockMovement()` gate for the out-of-turn movement lock — blocks only a non-current combatant of a started combat, matched by (sceneId, tokenId). GMs, non-combatants, non-positional updates, and everything out of combat pass through. |

### 3.4 `scripts/crawl-bar/`

| File | Lines | Description |
|---|---:|---|
| `crawl-bar.mjs` | 784 | GM-only persistent bottom bar above the macro bar (mode toggles, tools, launchers). |
| `crawl-bar-core.mjs` | 131 | The crawl bar's Foundry-free half: which controls each mode shows, the overland badge text, and the Tools panel's sections. |

### 3.5 `scripts/encounter/` — the Encounter Roller

| File | Lines | Description |
|---|---:|---|
| `encounter-roller-app.mjs` | 1351 | The Encounter Roller shell + tabs (Roll Tables / Build / Browse / Creator). |
| `encounter-check.mjs` | 162 | The d6 random-encounter check + chat post. Options (#232): a threshold, the travel hex (its region as the zone), a card label and the recap clock label, for Overland's travel checks. |
| `encounter-result.mjs` | 69 | Distance / Activity / Reaction RAW lookups. |
| `encounter-build.mjs` | 287 | Build-a-table data layer (slots, die formats, save to RollTable). |
| `encounter-browse.mjs` | 217 | Browse-NPCs data layer (sources, loading, cache, filter/sort). |
| `npc-index.mjs` | 263 | NPC actors → compact browse row model. |
| `npc-preview.mjs` | 89 | Hover stat card for a rolled creature (roller rows, result card, clock HUD panel). |
| `encounter-sources.mjs` | 56 | Pure, node-testable core for the Encounter Roller's source list (which tables/monsters feed a roll). |
| `encounter-terrain.mjs` | 618 | The table for the party's hex: the region's printed Encounter Zone column for its terrain (coast the one feature that counts), day/night from the world clock's hour (fixed 18:00-06:00 check halves) and the moon from the time API (worldClock, so New Moon / Full Moon columns resolve), N./S. halves from the region's rows (the regions cached until a crawl entry or scene changes); else the terrain→RollTable mapping and its dialog, else the single active table, which is also where a failing lookup lands. Backs encounter.tableForHex. Also reads the tagged hexes: partyHex, isHexMapScene, and hexReader (a grid offset to {num, terrain, features}, tags decoded once) for Overland's move pricing. |
| `encounter-draw.mjs` | 205 | Drawing an encounter with no window, shared by the Encounter Roller and quiet travel checks (#257): the table's row, a zone table's category and the region's table for it (day or night, then Special), the travel draw's point of interest (#262, #273), the entry (the NPC, its art, number appearing with its formula, distance 1d6, activity 2d6, reaction 2d6), the chain of tables drawn for the panel, a second category kept out of chat when quiet, and postEncounter's chat card. |

### 3.6 `scripts/monster-creator/`

| File | Lines | Description |
|---|---:|---|
| `encounter-creator.mjs` | 1966 | Monster Creator — multi-section NPC authoring tool mounted in the roller. |
| `action-templates.mjs` | 126 | Quick-pick NPC attack/action catalog (FA6 Free glyphs only). |
| `feature-templates.mjs` | 83 | Quick-pick NPC feature catalog. |
| `monster-effect-runtime.mjs` | 547 | Provenance-backed effect overlay engine for the Creator draft. |
| `monster-mechanical-adapters.mjs` | 330 | Sole authority for what mechanics a generator result actually applies. |
| `monster-mutator.mjs` | 142 | Clone an existing NPC and apply imported matrix results. |
| `monster-table-runtime.mjs` | 612 | Reads the GM's own imported Core matrix tables to drive the Generator/Mutator. |
| `core-monster-spell-icons.mjs` | 107 | Curated Foundry-native icon mapping for generated Core and Cursed Scroll monster spells. |
| `monster-spell-library-core.mjs` | 496 | Pure extraction, validation, identity, materialization, and refresh reconciliation for embedded monster spells. |
| `monster-spell-library.mjs` | 506 | Foundry adapter for GM-controlled Monster Spell Library preview, build, and refresh. |
| `monster-spell-pack-migration.mjs` | 473 | One-way consolidation of the retired world.shadowdark-enhancer--monster-spells pack into the managed Items pack, verified before the legacy pack is emptied. |
| `monster-spell-update-gate.mjs` | 254 | The automatic Monster Spell startup worker: legacy consolidation every activation, Core + managed Enhancer Actors refresh once per module version, active GM checked at fire time, version stamp advanced only after a complete successful refresh, and the refresh deferred with a warning while a failed consolidation leaves content in the retired pack. |
| `spell-index.mjs` | 255 | Lightweight Spell index (compendium indices, not documents). |
| `npc-moves.mjs` | 16 | Canonical NPC movement keys with a pre-config fallback. |
| `npc-statblock.mjs` | 143 | Builds the formatted `system.notes` statblock HTML. |
| `level-guidelines-app.mjs` | 224 | GM-facing editor for the per-level monster guidelines — what a level-N monster's stats should look like. |
| `level-guidelines.mjs` | 522 | Pure, node-testable monster level-guideline math (isotonic-smoothed medians over the system's 244 monsters). |
| `quick-adjust-app.mjs` | 472 | Quick stat-adjust dialog — lightweight AC/HP/level/attack swaps on an existing monster (not a generated effect). |

### 3.7 `scripts/loot/`

| File | Lines | Description |
|---|---:|---|
| `loot-generator-app.mjs` | 317 | Roll a loot table, work a running batch, whisper claimable cards. |
| `loot-generator.mjs` | 234 | RollTable → structured loot batch (documents, coins, flavor). |
| `loot-delivery.mjs` | 490 | Shared claimable chat card; first-claim-wins, GM-authoritative over an authenticated relay query. |
| `loot-drops.mjs` | 195 | Auto-drop loot on NPC defeat at combat end. |
| `loot-setup-app.mjs` | 238 | Browsable Loot & Treasure library; rows unlock from the GM's own PDF. |
| `loot-value.mjs` | 68 | gp value → Shadowdark XP quality tiers. |
| `loot-table-catalog.mjs` | 317 | Loot/treasure table catalog + classifier across Core, CS1–6, WR (metadata only). |
| `loot-table-tag.mjs` | 80 | Sidebar context-menu "Mark as Loot Table" toggle. |
| `loot-catalog.mjs` | 110 | Rewrites loot tables so entries become DOCUMENT results, routing the exact Sea Wolf Plunder, Dead Bandit Loot, and Diabolical Treasure tables through their source-qualified generated-item materializers before the generic resolver. |
| `diabolical-treasure.mjs` | 914 | D6/#59's exact CS1 Diabolical Treasure seam: reduces the source's 20×20 Item/Feature expansion to 20 source-qualified Basic/Magic/Treasure/Unidentified Items, puts physical wording on the unidentified face and feature text behind identification, stamps curated art plus A7 replace-always identity, and keeps collisions, failures, and unsafe table writes visible and retryable. |
| `loot-linker.mjs` | 118 | Loot row text → confident compendium item link. |
| `loot-pack.mjs` | 150 | Classify/fabricate treasure entries + world "Loot" pack ops. |
| `dead-bandit-loot.mjs` | 600 | D5/#58's exact CS2 Dead Bandit Loot seam: matches only the published 20 source rows, gives each canonical Item its visible feature remainder and curated A3 provenance, preserves the raw (optionally priced) TableResult, and reports unresolved, ambiguous, rerun, pack-boundary, and safe-writer failures. |
| `sea-wolf-plunder.mjs` | 571 | D4/#57's exact CS3 Sea Wolf Plunder seam: recognizes only the manifest/content identity or exact table name, strips only a terminal `(N gp)` for the generated Item name, stamps curated art plus A7 source-qualified generated identity, and keeps row-level unresolved, ambiguous, or reconciliation failures as raw TEXT with their priced source phrase. A TableResult write failure is a separate outcome: source preservation is guaranteed only when snapshot restoration reports `restored: true`; `restored: false` may require manual recovery. |
| `subroll.mjs` | 95 | Resolve "Meteorite 1d4: 1. lute…" table rows to the object rolled. |
| `treasure-data.mjs` | 15 | Level → tier band boundaries. |
| `item-drops.mjs` | 768 | Drag items to canvas as pickup tokens; TokenHUD pickup; light sources burn. |
| `loot-resolution.mjs` | 243 | Precise loot-row → Item resolution (pure), replacing the containment regex that lived in `loot-linker.mjs`. That matcher asked whether a row CONTAINED any known item name as a word (`\b<name>s?\b`, longest candidate first), which made every generic container, material and body part in the system gear pack a landmine: "Unopened bottle of exceptionally potent Murgazi wine (25 gp)" resolved to the plain system `Bottle` and the GM's 25 gp vintage became a 1 gp empty bottle (#58) — with "A flask of oil" → `Flask` and "Bolt of fine silk" → `Bolt` behind it. The replacement resolves the row AS A NAME in two tiers: `exact` (the priced row, stripped, IS the item's name modulo case and spacing) and `alias` (that name modulo a leading article or count, a trailing parenthetical, and the plural of its FINAL word). Every fold is anchored, so none of them can shorten a phrase to one of its interior words — the containment bug is structurally unreachable, not merely tuned away. A row landing on two distinct items at the same tier is `ambiguous` and resolves to nothing, because picking one by index order is the same bug with extra steps; ambiguity is reachable because the alias fold is looser than `buildItemIndex`'s lowercased-name dedupe. Recall is traded for precision DELIBERATELY (D4/D5 accept "an explicit unresolved case" and put loose generic fallback out of scope): an unresolved row keeps its text and can be fabricated, while a false positive silently hands the player the wrong object and looks like it worked. Also owns `stripPrice`, moved verbatim from `loot-pack.mjs` (which re-exports it) because its output is a fabricated Item's NAME and must not acquire any of the matching folds. Foundry-free, node-tested. |
| `monster-loot-review-app.mjs` | 86 | Monster Loot Overrides window: every world NPC with its loot table and drop chance, edited inline via LootDrops.setOverrides. Opened from the Loot & XP settings pop-out. |

### 3.8 `scripts/magic-forge/`

| File | Lines | Description |
|---|---:|---|
| `magic-forge-app.mjs` | 748 | Magic Item Forge window (weapons/armor with working +N, benefit/curse riders). |
| `magic-forge.mjs` | 286 | Core engine building items that actually function in the system. |
| `magic-table-runtime.mjs` | 733 | Drives forge recipes off the GM's own imported magic-item tables. |

### 3.9 `scripts/merchant/`

| File | Lines | Description |
|---|---:|---|
| `merchant-shop.mjs` | 2793 | Two-mode shop system (compendium global or actor NPC inventory); GM opens for all players. |
| `merchant-defaults.mjs` | 209 | The two shipped merchant configs (Base, Western Reaches). |
| `catalog-stock.mjs` | 37 | What the Catalog tab may sell: gear types with a list price, not loot-table props. |

### 3.10 `scripts/party-xp/`

| File | Lines | Description |
|---|---:|---|
| `party-xp.mjs` | 322 | Award XP to the whole party in one click (ApplicationV2 GM tool). |
| `party-xp-core.mjs` | 52 | Pure XP math + item-XP resolution. |

### 3.11 `scripts/session-recap/`

| File | Lines | Description |
|---|---:|---|
| `session-recap.mjs` | 797 | Session event tracker singleton (loot, sales, XP, combats, per-PC stats). |
| `session-recap-core.mjs` | 424 | Pure data shape, currency math, duration format, Discord-markdown export. |
| `session-recap-app.mjs` | 354 | Recap window: Overview / Combat / Loot / XP / History. |
| `carousing-feed.mjs` | 121 | Explicit legacy SDX result-capture compatibility and native/SDX downtime overlap read. Native outings push one stable Session Recap row directly; no hidden journal watcher or actor-effect replay. |
| `carousing-feed-core.mjs` | 234 | Pure normalizer for both SDX carousing result shapes — original (d8 outcome + one benefit, GM applies) and expanded (d8 → XP + d100 benefit/mishap arrays, self-applying) — detected off the payload, not off SDX's mode setting, so a carouse rolled before the GM flipped it still reads. Also the shared `recapRow`, `carousingSubtotal` and `tierLine` wording the recap window and the Discord export both use. Foundry-free, node-tested. |

### 3.12 `scripts/importer/` — hub + cross-type infrastructure

| File | Lines | Description |
|---|---:|---|
| `importer-hub-app.mjs` | 980 | **The single front door (shell).** ApplicationV2 lifecycle, singleton, instance fields/caches, `_prepareContext`; installs the three method packs below onto the class (split 2026-07-22). |
| `importer-hub-paste.mjs` | 1584 | Paste box, type selector, parse dispatch, per-type preview field/row wiring. |
| `importer-hub-commit.mjs` | 975 | Conflict dialogs, quality gates, magic-bundle plan, all per-type commit flows. |
| `importer-hub-manage.mjs` | 1294 | Manage strip: censuses + caches, manage tree, gap/seed/cull, source-PDF grab/extract. |
| `importer-hub-batch.mjs` | 760 | Batch “Import everything” runner: seeds, grabs, parses and commits each planned entry unattended. |
| `importer-hub-rules.mjs` | 113 | Importer Hub Rules Data step (#299; first in the Manage strip since #311): lists each Western Reaches lookup table with its book, page and filled or empty state, runs the settings window's own import (importAndSave) from the hub, opens the Edit window, and is Import everything's last step when a book is linked. |
| `importer-hub-shared.mjs` | 107 | Hub-shared constants/helpers + `installMethods` (the split's descriptor copier). |
| `importer-hub-news.mjs` | 136 | What a module update added to the import library: snapshots every Manage-tree row once per module version, diffs the new snapshot against the last, and hands the hub the rows this release added but the GM has not imported (the "New" filter and badge) plus a one-time notice. |
| `importer-hub-maintenance.mjs` | 316 | Tools-menu bodies (bundle export/import, source-PDF library). |
| `dump-segmenter.mjs` | 308 | Routes a mixed dump through the recognizer registry: hexcrawl → spell → monster → item → table. |
| `bundle-io.mjs` | 411 | Whole-suite export/import as one JSON; validates, skips existing, never overwrites. |
| `manage-tree.mjs` | 703 | Composes the folder/sub-folder unlock-review tree the Manage strip renders. |
| `batch-import.mjs` | 263 | Pure batch planner: locked tree rows → deduped import jobs, routes, and the run report. |
| `pdf-text-extract.mjs` | 1014 | Clean reading-ordered PDF text via Foundry's bundled PDF.js; column-aware gutter detection. |
| `pdf-text-utils.mjs` | 161 | Shared PDF-text helpers + the HTML-safety contract. |
| `source-pdf-registry.mjs` | 327 | Content source → the user's own uploaded PDF, for page deep-links. |
| `source-pdf-viewer.mjs` | 66 | Singleton ApplicationV2 embedding Foundry's PDF.js viewer at a given page. |
| `char-content/char-content-manifest.mjs` | 1877 | Metadata-only manifest of CS4–6 + WR char-builder content (names/types/sources, no rules text) + `parseCharContent` + census. |
| `char-content/class-parser.mjs` | 1100 | Class section → structured unit (writeup, talents, tables, spellcasting). Pure. |
| `char-content/class-importer-app.mjs` | 803 | Purpose-built single-view class workspace. |
| `char-content/class-unit-importer.mjs` | 1449 | Class unit → real documents in dependency order. |
| `char-content/class-overlays.mjs` | 280 | SDE-original automation not derivable from book text (ActiveEffects, invented names). |
| `char-content/class-quality-gate.mjs` | 111 | The one place computing blocking class-import issues + override dialog. |
| `char-content/class-index.mjs` | 98 | Class name → system Class item UUID. |
| `char-content/language-resolver.mjs` | 16 | Language names → system UUIDs. |
| `spells/spell-parser.mjs` | 290 | Spell blocks → Spell drafts. Pure. |
| `spells/spell-importer-app.mjs` | 477 | Spell workspace organized by class / tier / alignment. |
| `tables/table-importer.mjs` | 3986 | Roll-table text → structure. The big one; includes `repairSharedStartRanges`. |
| `tables/table-shapes.mjs` | 860 | Per-unlock deterministic table SHAPE recipes (prayer/grid/lookup/reflow kinds). |
| `tables/table-registry.mjs` | 202 | Parses live tables into `{source, page, displayName, subCategory}` and groups them. |
| `tables/table-seed-map.mjs` | 240 | Generated table-name → group-id seed map. |
| `tables/table-structure-seeds.mjs` | 2106 | Structure-only seeds (formulas, folders, flags, chain links). |
| `tables/table-folders.mjs` | 426 | Single source of truth for where a table files in `sde-tables` — **owns the Gameplay vs Roll Tables split**. |
| `tables/table-categories.mjs` | 65 | Table-type taxonomy + classifier. |
| `tables/table-enrich.mjs` | 345 | Brings imported tables to "Ruin Encounters" standard; owns the debounced auto-relink sweep. |
| `tables/core-table-groups.mjs` | 289 | Core Rulebook table groups (`section: "gameplay"` vs roll tables) for the Manage tree. |
| `tables/compound-table.mjs` | 92 | Mad-libs generator roll behaviour. |
| `tables/hex-parser.mjs` | 488 | Hex-key dumps → per-hex draft journal pages. Pure. |
| `monsters/statblock-parser.mjs` | 553 | Monster statblock dump → draft objects. Pure. |
| `monsters/monster-importer.mjs` | 233 | Drafts → NPC actors in `sde-actors`. |
| `monsters/monster-importer-app.mjs` | 404 | Paste dump → per-monster preview/edit grid → create. |
| `monsters/monster-census.mjs` | 241 | Pure have/gap/duplicate helpers. |
| `monsters/monster-census-live.mjs` | 463 | Foundry-bound adapter reading `sde-actors`/`sde-tables`. |
| `monsters/monster-backfill.mjs` | 525 | Idempotent upgrade of pre-fidelity-fix imports; auto-runs once per module version. |
| `monsters/managed-actor-backfill.mjs` | 306 | Reusable active-GM, version-gated backfill lifecycle over the managed Actors pack; consumers supply the missing-only transform. |
| `monsters/monster-text-backfill.mjs` | 187 | E2 missing-only monster-context `[[request]]` and inline-roll backfill over managed NPC Actor text; owns its consumer version gate. |
| `monsters/creature-type-map-data.mjs` | 134 | N4 reviewed source/name-scoped creature taxonomy map for managed imported Actors. |
| `monsters/creature-type-backfill.mjs` | 262 | E3 missing-only N4 creature-type flags over managed NPC/Mount Actors, with optional SDX runtime-map gap mirroring and outcome counts. |
| `monsters/actor-migration.mjs` | 419 | World-side imported actors → the managed `sde-actors` pack. |
| `monsters/monster-linker.mjs` | 150 | Table encounter text → clickable `@UUID` monster links. |
| `monsters/monster-pack.mjs` | 48 | Shared pack-identity leaf so importer and linker agree. |
| `items/item-parser.mjs` | 493 | Generic item recognizer (name/cost/slots). Pure. |
| `items/gear-parser.mjs` | 576 | Real Weapon/Armor stat parser (WR letter codes, treasure flags). Pure. |
| `items/wr-property-importer.mjs` | 202 | Foundry-bound shared materializer for canonical Western Reaches Weapon Properties (siege Blast/Exploding and Lance Charge/Devastating/Mounted), with root migration, idempotent reuse and fail-closed preparation. |
| `items/item-importer.mjs` | 1068 | Drafts → Items in `sde-items`, foldered by source. |
| `items/item-builder-app.mjs` | 402 | Guided multi-stage equipment-section workspace. |
| `items/item-builder-gear.mjs` | 299 | Pure stage-①/③ logic for the Item Builder. |
| `items/item-census-live.mjs` | 201 | Items census adapter (same shape as monsters). |
| `items/shikashi-icons.mjs` | 235 | Item name → bundled Shikashi icon matcher (284 icons). |
| `tables/table-manifest.mjs` | 331 | Table manifest logic — the registry of catalogued tables (id, name, source, page) that drives the Manage-tree census. |
| `tables/table-manifest-data.mjs` | 506 | The `TABLE_MANIFEST` data array — every catalogued table's metadata (names/sources/pages; no rules text). |
| `boats/mount-parser.mjs` | 65 | Names-only WR mount manifest + selection of the requested mount from parsed statblock drafts. |
| `boats/mount-importer.mjs` | 174 | Mount drafts → `shadowdark-enhancer.mount` actors in `sde-actors`, reusing the monster import pipeline. |
| `boats/boat-parser.mjs` | 155 | Parses the WR p118 boats table → boat actor drafts (pure); names-only manifest. |
| `boats/boat-importer.mjs` | 50 | Boat drafts → `shadowdark-enhancer.boat` actors in `sde-actors`. |
| `boats/siege-parser.mjs` | 440 | Parses the WR p119 siege-weapons table → Weapon drafts + ammunition (pure). |
| `boats/siege-importer.mjs` | 43 | Materializes Blast/Exploding Property items for the siege weapons in `sde-items`. |
| `adventure/adventure-book-import.mjs` | 271 | A Cursed Scroll's adventures in one pass: each site's pages out of the linked PDF, parsed and filed, one site failing never costing the rest; and who each location names, read from the book when tokens are placed. Page map only; no book text. |
| `adventure/adventure-commit.mjs` | 298 | Parsed locations → one JournalEntry per adventure in sde-journal, one page per location (plus an Introduction page when the book prints one before the first), filed under the adventure flag (not the hex flag, so the tagger never lists a dungeon as a crawl); pure planner plus a two-pass link rewrite, same contract as hex-commit. |
| `adventure/adventure-creatures.mjs` | 196 | Who is in each keyed location (pure): a creature the book sets in bold with a count beside it ("12 unruly Howlers", "Three." after a bold bullet label), matched to the world's bestiary by name (and linked in the filed text: a bold creature name becomes an @UUID link); dice rolls, chances and creatures said to be in another Area place nothing. Reads the GM's own book text at run time; ships none. |
| `adventure/adventure-journal.mjs` | 330 | An adventure's overview in the Lost Citadel quickstart's layout (pure): an Overview page with an H2 a section and a page for what holds in every area (danger level, light, the random encounters), the PDF's flattened numbered rows back as tables (rumors with no header row, d-tables with one), bullets as nested lists, run-in names bold, and dice and DC checks as inline rolls and requests. |
| `adventure/adventure-layouts.mjs` | 362 | Where each adventure's room numbers sit on its map, as fractions of the map (positions only; no art, no book text), so a scene can place its pins without the GM clicking each one; plus the pure helpers that turn a placed scene into a layout to paste here and a layout into placement points; also where the book's map marks creatures (a letter per kind), as positions only. |
| `adventure/adventure-manifest.mjs` | 162 | Where each Cursed Scroll adventure's numbered key is: per site (a dungeon, a mini-adventure, a city district) its title, printed pages, the numbers the book prints, the heading style, and the map's printed grid. Page numbers and titles only; no book text, no art. |
| `adventure/adventure-pack.mjs` | 233 | Packs a built adventure (its scene, journal and the creature actors its tokens use, with their folders) into one Adventure in the Adventures compendium, and removes the world copies afterwards: only the ids a run made, and never an actor another scene still uses. Reads only until told to remove. |
| `adventure/adventure-parser.mjs` | 310 | Numbered-location parser for printed adventures (pure): "12. METEORITE ROOM" and "12. Meteorite Room. Body" headings, a run rule that keeps a numbered list inside a room out of the key, missing-number reports, page HTML with bullets and "Area 12" links. |
| `adventure/adventure-placer.mjs` | 434 | The keyed-location placer (AppV2): lists a map's locations and turns the canvas into a one-click target, dropping each numbered Note and arming the next; skip and clear per location, resumable. |
| `adventure/adventure-scene.mjs` | 581 | A filed adventure as a map Scene: scene sized from the GM's image and the book's printed grid, the journal deployed into the world, and the pure rules for which locations are placed, skipped or still to do (remembered on the scene's notes and flag); also the hidden tokens for the creatures the book's map marks and the ones each location's text names, spread on free squares around its pin. |
| `adventure/adventure-traps.mjs` | 163 | Where an adventure's traps sit on its map (positions only, no book text): which printed trap line of which area, how far it reaches, and the planning that turns them into Region shapes. |
| `adventure/adventure-treasure.mjs` | 184 | An adventure's treasure as items, the way the Lost Citadel quickstart has them (pure): each thing the key prices ("a blue pearl (40 gp)", "20 meteorite chunks (30 gp each)") becomes a Gem or treasure item worth that, a spell scroll the key names becomes a scroll item pointing at its spell; read at import time from the GM's own book, never shipped. |
| `adventure/adventure-walls.mjs` | 2847 | The walls, doors and solid furniture of each adventure's map as positions (fractions of the map picture), made ahead of time and checked by a leak test; the pure planner that turns them into Wall documents. No map art or book text. |
| `adventure/map-detect.mjs` | 57 | Which adventure a map image is of (pure): the file name's words, minus sizes and version words, matched against each site's title and map names, the longest name winning and a tie meaning the GM is asked. |
| `adventure/map-labels.mjs` | 48 | Where the book puts each room number on its own map (pure): the page reads of a keyed map (one picture per page, numbers as text over it, two pages for a spread) stitched into one point per number as a fraction of the map, plus the shape check against the GM's image. No coordinates ship; they come from the GM's own PDF. |
| `chapter-journal.mjs` | 377 | Chapter to journal (#194): a printed page range of a linked book → one JournalEntry in the journals pack, split at ALL-CAPS headings (or a preset's sections, e.g. the GM Guide's City-States) and reflowed, with page furniture dropped. Identity by flag, so a re-import updates in place and keeps GM pages; pages naming a key location link to its hex page and back. Presets are page numbers only. |
| `hex/hex-book-import.mjs` | 152 | A book's whole hex key in one pass: per region, the keyed-location table and the pages of write-ups after it → one crawl entry per region. Page map only; no book text. |
| `hex/hex-commit.mjs` | 232 | Hex-key drafts → JournalEntry pages in sde-journal (one entry per crawl, one page per hex); pure planner + two-pass link rewrite. |
| `hex/hex-dataset.mjs` | 349 | Drafts + summary rows + tags → the Shadowdark Extras hexcrawl dataset (numbers only at the boundary); river, path and coast as record features, merged by id with what Extras holds. Pure. |
| `hex/hex-handoff.mjs` | 384 | Crawl entry → dataset; puts it on the tagged print through Extras (adoptHexcrawl), merging each hex's features into the record Extras holds, builds a painted Extras scene, or downloads JSON. |
| `hex/hex-summary.mjs` | 174 | Keyed hex summary rows (number, region, terrain, name) → structured rows; zone/terrain split decided by the table. Pure. |
| `importer-hub-adventures.mjs` | 186 | Hub Tools → Adventures (file a Cursed Scroll's adventures as journals) and Adventure map (build the scene from the GM's image and open the placer); installed onto the hub class. |
| `items/record-boundary.mjs` | 208 | Where one pasted description record ends and the next begins. Pure. |
| `session-pdf.mjs` | 61 | Source PDFs given from the GM's own computer for one session, for hosts that refuse a book-sized upload (The Forge): the picked files, the `session-pdf:` pseudo-path they resolve to, and the Forge check. Never uploaded or saved; released when the import is done. |
| `tables/cursed-scroll-tables.mjs` | 190 | The Cursed Scrolls' hexcrawl and adventure tables (rumors, region and site encounters, weather, points of interest, NPC rosters, d20 treasure lists): one entry per Manage row with its catalogue id, page cite and recipe, read by the shape registry, the Manage tree and the catalogue's names. The regions are named as the key-location entries are, so a CS hex finds its zone tables. Structure only. |
| `tables/patron-items.mjs` | 223 | Patron Items for the imported WR boon tables (#167): find-or-create in `patrons-and-deities`, plus the ready-time rename/link backfill. |
| `wizard/map-master.mjs` | 81 | Master list of the books' own maps: each map's measured pixel shape, which names a file must or must not carry to be it (not a GM's overlay, a later copy or a stitched whole), and which of two shipped copies to prefer. Pure data. |
| `wizard/wizard-app.mjs` | 259 | Import wizard window: an ApplicationV2 around the controller that draws its pages, hands clicks and drops back, and supplies the Foundry parts (uploads, the PDF reader, the hub's quiet batch import, adventure scenes). Also wizardFirst(), which says whether a world still needs its first import. |
| `wizard/wizard-check.mjs` | 136 | Import wizard Check page: makes sure each picked book opens (and uploads, when kept) and each map opens, has the right shape and is uploaded; a problem carries a plain reason and its fixes. Foundry calls come in as env. |
| `wizard/wizard-controller.mjs` | 463 | Import wizard controller: owns the state, answers clicks and file drops, and describes the current page as plain data for the template. The Foundry window and the browser preview both drive it. |
| `wizard/wizard-core.mjs` | 280 | Import wizard brain, pure: the page flow and its guards, which book or map a picked file is (from the module's own manifests), and the catalogue of everything the wizard asks for. |
| `wizard/wizard-dom.mjs` | 80 | Import wizard browser wiring: the file dialog, drop zones and click delegation, shared by the Foundry window and the preview. |
| `wizard/wizard-run.mjs` | 145 | Import wizard Import page: runs the library, then each book's adventures, then each adventure map's scene, and reports what was imported, what was already there and what needs the GM. Foundry parts come in as deps, so Node tests the flow. |
| `wizard/zip-reader.mjs` | 103 | Reads a downloaded .zip in the browser with no library (the browser's own DecompressionStream): lists the files in it and inflates only the books and maps the wizard wants, so a new user never unzips anything. |
| `world-folders.mjs` | 94 | Files what an import makes in the world (adventure and hex-crawl journals, their scenes, the hex records) into folders for their books, touching only the module's own documents that are not in a folder yet. |

### 3.13 `scripts/actors/` — Mount, Warband & Boat sub-types

| File | Lines | Description |
|---|---:|---|
| `register-actors.mjs` | 114 | Registers `shadowdark-enhancer.mount` / `.warband` / `.boat` (models + sheets, in `i18nInit`): the warband's NpcSD subclass with fixed HP, its linked-token and commander-cleared create hook, and Make a Warband. |
| `boat-data-model.mjs` | 115 | Boat data model — WR vessel rules. |
| `boat-sheet.mjs` | 142 | Boat sheet: Overview / Passengers & Crew / Cargo / Description. |
| `npc-stat-sheet.mjs` | 273 | The NPC stat block as an ApplicationV2 actor sheet, shared by the Mount and the Warband: header and tabs, HP/AC/level, attacks, specials, features, spells, description, effects and the system's own data-action names (item-attack, roll-hp, cast-npc-spell...) mapped to V2 actions, tab handling and emulateItemDrop. Markup in templates/actors/npc-stat/. |
| `mount-sheet.mjs` | 351 | Mount sheet — an ApplicationV2 actor sheet over the NPC data model: stats, riders, gear, mount rules, spells, notes, effects. |
| `mount-scores-core.mjs` | 13 | Pure mount full-score defaults, uncapped modifier conversion, separate damage and effective scores. |
| `mount-scores.mjs` | 40 | Mount-only NPC model extension and once-only creation/adoption of persisted full scores; native checks derive effective modifiers. |
| `warband-core.mjs` | 265 | Warband rules, pure (#200, #202, #204): the 18 upgrades, a commander's allowance by hit die tier (2/2, 4/3, 6/4), the command and upgrade refusals, and a creature made into a warband (level doubled, 8 HP a level plus CON, one attack, +1 attack a level gained, damage dice tripled). |
| `warband-sheet.mjs` | 198 | The Warband unit sheet (#200), an ApplicationV2 actor sheet: the Mount's NPC stat block (npc-stat-sheet.mjs) plus a Warband tab for the commander (a PC dropped on it), the allowance across that commander's warbands, the upgrade checklist, the garrison, the commander's CHA for morale and the GM's upkeep buttons. Every change goes to the warband writer; it writes no flag itself. |
| `warband-npc-sheet.mjs` | 199 | A Warband's state and its writer (#200, #204): `warbandState`, the commander's tier and other warbands, and the one queue the active GM runs every commander, upgrade, garrison and upkeep change through (the single `warband` flag written whole via replaceModuleFlag, allowance checked on that GM). The sheet that sends them is warband-sheet.mjs; this file keeps its old name because combat, upkeep and recruiting import from it. |
| `make-warband.mjs` | 120 | Make a Warband (#202): the GM's Actors-directory context entry on a level 1-5 NPC, a before/after preview, and a new warband actor from a copy (the stat block in its notes rebuilt as Quick Adjust does). |
| `warband-upkeep.mjs` | 454 | Warband upkeep and healing on the world clock (#204): on timeAdvanced (active GM, queued), month and week starts in order over a move's last 366 days (clockEvents, last-month and last-week markers against rewinds): each month start charges 10 gp a level per commanded warband from the commander's coins, in one card; arrears check morale each week start (at most 8 rolling weeks a move) and desert on a failure (marked, never deleted); every day heals 1d4 (Hardy 2d6); the GM's Charge a Month, Pay Arrears and Return to Service. |
| `warband-garrison.mjs` | 22 | The bastion a warband is garrisoned at: its name and which of the Granary and Barracks it has finished while it stands, for warband upkeep, healing and the Warband tab. |
| `warband-combat.mjs` | 138 | Warbands in mass combat (#203): a warband's combatant takes its commander's initiative (on join and whenever either changes, Chaos rerolls included); automatic morale on the active GM from a per-client HP cache (falling to half, every hit below it; d20 + commander CHA vs 15/Loyal 9, advantage when leading), a 3-in-6 (Withdraw 1-in-6) rout that marks it defeated; the attack card's area note; the retraining warning on attack. |
| `warband-upgrades.mjs` | 126 | What a warband's upgrades do (#201): Armor Upgrade, Tough, Training and Weapons Upgrade written into the stored fields they change in the same update as the tick, and taken off by the same amount (marked attacks only); each upgrade's book text read once from the Player's Guide p.250 into the warbandUpgradeText world setting for the sheet's hovers. |
| `vehicle-sheet.mjs` | 457 | Shared party-like container base (ApplicationV2). |
| `vehicle-rolls.mjs` | 81 | Shared helper-roll button handlers. |

### 3.14 `scripts/char-builder/` — guided character creation

| File | Lines | Description |
|---|---:|---|
| `char-builder-app.mjs` | 406 | `ShadowdarkCharBuilder` ApplicationV2 shell; drives the step lifecycle. |
| `state.mjs` | 158 | `CharBuilderState` — the in-progress character. |
| `constants.mjs` | 160 | Shared constants; hands off to the system's `CharacterGeneratorSD`. |
| `data.mjs` | 325 | Thin wrappers over the system's compendium loaders. |
| `commit.mjs` | 304 | `commitCharacter` — final actor creation + `coinsAfterGear`. |
| `item-source.mjs` | 19 | `stampSource` — records the compendium link on items the builder creates. |
| `hydrate.mjs` | 259 | Existing actor -> builder state (reads `_source` only); `describeActor` console dry run. |
| `commit-plan.mjs` | 265 | `planCommit` — pure three-way plan (baseline, builder, live) of what Finish changes on an existing actor. |
| `commit-apply.mjs` | 209 | `applyPlan` — resumable executor for a merge-aware plan: creates, item updates, one actor update, deletes last, each read back so a write rejected after saving is not repeated. |
| `before-image.mjs` | 178 | `takeBeforeImage` / `restoreBeforeImage` — one actor flag holding the builder-writable fields and every item's source, and a restore that puts the character back with the executor's write discipline. |
| `existing-finish.mjs` | 218 | The builder on an existing character: `hydrateActor`, `finishExisting` (diff dialog, before-image, `applyPlan`, then re-hydrate from the live actor) and `undoLastSave`. |
| `level-up.mjs` | 66 | Level up an existing character, one level (pure): `canLevelUp` (XP or GM), `startLevelUp`, `cancelLevelUp`, the odd-level talent rule, the spells-known delta and the picked talent. |
| `entry-points.mjs` | 38 | Ways into the builder on an existing character: the Player sheet header button and the Actor directory's Edit in Character Builder entry. |
| `art.mjs` | 77 | Ancestry/class NAME → local portrait manifest. |
| `art-gallery.mjs` | 526 | GM-curated portrait gallery (avoids granting players `FILES_BROWSE`). |
| `class-ability-uses.mjs` | 113 | Per-day/roll uses for Class Ability items. |
| `gear-editor-app.mjs` | 152 | `ExtraGearEditor` sub-window. |
| `steps/base-step.mjs` | 68 | Base class for character-builder wizard steps (shared lifecycle, render and validation). |
| `steps/list-step.mjs` | 216 | Base class for the list/detail/aside steps (Ancestry, Class, Background, Deity). |
| `steps/alignment-step.mjs` | 68 | Step — Alignment. Three choice cards (Lawful / Neutral / Chaotic). |
| `steps/ancestry-step.mjs` | 256 | Step — Ancestry. List/detail pick contributing ancestry talents and languages. |
| `steps/background-step.mjs` | 40 | Step — Background. A simple list/detail pick. |
| `steps/class-step.mjs` | 985 | Step — Class. List/detail pick; parses the class writeup, talent table and spellcasting. |
| `steps/deity-step.mjs` | 77 | Step — Deity. Optional list/detail pick showing the deity's detail. |
| `steps/gear-step.mjs` | 345 | Step — Gear. A shop: browse purchasable equipment and buy against starting gold. |
| `steps/gold-step.mjs` | 98 | Step — Gold. Roll 2d6×5 gp, or use the GM's fixed starting-gold setting. |
| `steps/hp-gold-step.mjs` | 52 | Step — Hit Points & Gold on one tab (both are single dice rolls). |
| `steps/hp-step.mjs` | 173 | Step — Hit Points. Level-1 HP = class hit die + CON modifier (minimum 1). |
| `steps/languages-step.mjs` | 147 | Step — Languages (runs after Class, so ancestry and class both contribute). |
| `steps/origins-step.mjs` | 63 | Step — Origins: Background + Alignment + Deity on one tab. |
| `steps/preview-step.mjs` | 332 | Step — Preview. Final character-sheet preview before creation. |
| `steps/stats-step.mjs` | 400 | Step — Abilities. Roll or assign the six ability scores. |

### 3.15 `scripts/monster-art/`

| File | Lines | Description |
|---|---:|---|
| `imported-monster-art.mjs` | 829 | N6's exact source-aware curated art map and F4's Foundry-free pick-state planner; missing rows stay available to Browse. |
| `monster-token-art.mjs` | 727 | Applies licensed art to monsters **by path reference**, never bundled. |
| `token-art-catalog.mjs` | 1163 | Name→art matching catalog. |
| `token-art-manager-app.mjs` | 715 | GM window to review/apply matches. |
| `token-art-manager-state.mjs` | 79 | Normalizes the persistent Token Art Manager state and named Browse folders. |

### 3.16 `scripts/pdf-export/`

| File | Lines | Description |
|---|---:|---|
| `pdf-sheet-export.mjs` | 426 | "Export to PDF" header button; fills the bundled form-fillable sheet from SD data-model getters. |

### 3.17 `scripts/character-sheet/` — Shadowdark sheet injections

| File | Lines | Description |
|---|---:|---|
| `prayer-roll.mjs` | 183 | Prayer icon beside the sheet's Deity header; rolls that deity's `<Deity> Prayers` table (world first, then compendiums). |

### 3.18 `scripts/downtime/` — between-crawls downtime activities

| File | Lines | Description |
|---|---:|---|
| `downtime-skeleton.mjs` | 196 | Shipped downtime metadata: 25 slots across four activities with names, compressed labels, DCs, paid flags, keyword matchers and renown/XP deltas. Carries no rules text. |
| `downtime-parser.mjs` | 367 | Parses a pasted downtime page into per-slot outcome text; segment-scoped DC + keyword matching with a rescue pass for column-interleaved PDF copies. Unmatched lines are reported back, never guessed at. |
| `downtime-core.mjs` | 211 | Pure downtime rules math: the DC step-down ladder, per-attempt cost by source, the martial-training hit-die tier and caster-list gates, and the stored unlock record shape. |
| `downtime-effects-core.mjs` | 264 | Pure decision layer for downtime outcomes: the slot-to-plan table (auto / choice / narrative), the per-weapon martial-training limit counters and damage-die ladder, the one-shot extortion math, and the XP level-up threshold. Ships item names only, no rules text. |
| `downtime-effects.mjs` | 804 | Applies a successful downtime outcome for real — renown, XP, weapon-training Active Effects, damage-die steps, fabricated scrolls/wands/potions, spell trades, advantage reminders and the merchant extortion flag. Enumerates the concrete choices first; GM-side execution only. |
| `downtime-log-core.mjs` | 201 | Pure downtime-log formatting: the recap headline row, the escaped journal `<li>`, and the newest-first grouping that splices a row under its `data-sde-day` heading. Shared by the recap window, the Discord export and the journal so all three phrase an attempt identically. |
| `downtime-log.mjs` | 177 | `recordDowntime(entry)` — one call, two sinks: the Session Recap's Downtime section and a persistent flagged "Downtime Log" world JournalEntry appended under a heading per real-world day. Queued read-modify-write; never throws outward. GM-side only. |
| `downtime-warnings.mjs` | 156 | Shared prose for the downtime parser's warning codes; splits info notes (a two-column paste always emits them) from real problems, so every unlock surface reports a parse identically. |
| `downtime-recruit-core.mjs` | 115 | Pure rules of Recruit a warband (#205): the `recruit:<id>` slot key, DC 10 plus the warband's level, the party's settlement (the GM's choice, else the keyed hex's), what a settlement supplies from the recruiting limits, and which warbands a character is offered. |
| `downtime-recruit.mjs` | 186 | Recruit a warband in the world (#205): reads the party's hex, the actors pack and the world's uncommanded warbands, checks the commander's allowance with the warband unit's own checks, and makes a copy under the character's command on the warband queue. GM-side; a player's window asks the session for the offers. |
| `downtime-app.mjs` | 1536 | The `sde-downtime` ApplicationV2 in three modes: GM solo (pay-before-roll attempts, renown / XP apply buttons), the GM session control panel (picks overview, lock/release, roll-for), and the player view (own actors only, choose then roll). Locked books render as a title-only card; unlocking happens in the Importer Hub. |
| `downtime-session.mjs` | 1196 | Table-wide downtime session: world-setting state model, the authenticated downtime query protocol (the raw socket carries only the payload-free re-read nudge), and the GM-authoritative handlers that recompute DC, cost and gating from the skeleton, derive the requester from the server-supplied sender, and spend a per-attempt roll token so a roll settles once. Players pick and roll; the GM settles. |

Ships the skeleton only (activity names, slot labels, DCs, paid flags, renown/XP deltas). Every outcome sentence is pasted by the GM from their own book and stored in the `downtimeContent` world setting, never in the repo.

### 3.19 `scripts/renown/` — the renown fame track

| File | Lines | Description |
|---|---:|---|
| `renown-core.mjs` | 338 | Pure band ladder and phrasing: `renownBand`/`renownBonus` (≤3 / 4–7 / 8–11 / 12+ → +0/+1/+2/+3), `startingRenown` (the CHA modifier), the shared `recapRow`/`renownChangeLine` wording, the short trigger labels, `isDoubleOnes` — a raw 2d6 total of 2 can only be 1+1 — and `authorizeRenownAward`, the GM-only rule both the direct call and the query handler check. Also the two rules the automatic writes turn on: `shouldSeedStartingRenown` (a character is owed its one starting seed only while the flag is unspent, renown is 0 AND the ledger is empty) and the ledger helpers `appendRenownHistory` (capped, non-mutating), `historyRow` and `groupHistoryByPlayer`. Foundry-free, node-tested. |
| `renown.mjs` | 748 | The single write path for `system.renown`. `Renown.award` updates the actor, logs to the Session Recap and posts a chat card; downtime and the level-up watcher both route through it. Because the write is read-add-write, it is also the single WRITER: an award made on a GM client that is not `game.users.activeGM` is forwarded there over the `sde.renown` query (the delta travels, never a computed total), and on that client awards run one at a time through `_txQueue`, each re-reading the actor inside its turn — two GMs, or two overlapping awards on one, would otherwise lose one of them. Also the party readers the Encounter Roller uses, and the two automatic triggers, each settings-gated and active-GM-gated: the `renownOnLevelUp` `updateActor` watcher, and `renownOnCreate`'s `maybeSeedFromCha`, attempted on `createActor` and again on the first CHA change (an actor made through Create Actor starts on the model's default 10s, so a +0 seed does not spend the flag). Every award also writes a permanent per-character ledger to the `renownLog` flag IN THE SAME `actor.update` as the number, because `SessionRecap.logRenown` returns early with no session running; `history`/`historyByPlayer` read it back. An `updateActor` watcher also logs any renown change this module did NOT make (the Shadowdark sheet input, a macro, shadowdark-extras carousing calling `applyRenownDelta`) as `source: "external"`, told apart from our own writes by the ledger flag riding in the same update. GM-side only. |
| `renown-award-dialog.mjs` | 237 | The GM's award / dock DialogV2. Party roster (renown, band, meaning, bonus) on top, then character + change + reason with the book's triggers as suggestions, then the collapsed per-player **Renown log** (native `<details>`, since DialogV2 does not re-render its content), plus a "Start at CHA mod" seed that forces past both the setting and the once-only rule. GM-only; every write goes through `Renown.award`. |

The number itself is the SYSTEM's field (`system.renown` on PlayerSD). This folder adds the band ladder, the single logged write path every renown change goes through, and the GM's award dialog. Band thresholds and bonus numbers are mechanics; the one-line band meanings are the module's own wording, not the book's.

### 3.20 `scripts/pit-fighting/` — Cursed Scroll 2 pit fighting bouts

| File | Lines | Description |
|---|---:|---|
| `pit-fighting-core.mjs` | 290 | Pure bout set-up: the stakes ladder (APL + 1d6 → 2-5 / 6-10 / 11-13 / 14+), `averagePartyLevel` (rounds half up, ignores unreadable levels rather than counting them as level 0), the 2d6 venue rows, the 2d6 twist bands as machine-readable effects (`extra-danger` and its 1d4 sub-roll, `none`, `stakes-up-1`, `boon`), the three danger levels, `encounterTableName` (High and Epic share one encounter tier, so four stakes tiers map to three table tiers) and `buildBout`. `suggestedDanger` derives from the stakes only — the book hands the GM the venue too and then says the GM decides, and no venue risk rating exists to read. Rolls no dice and holds no text. Foundry-free, node-tested. |
| `foe-resolver-core.mjs` | 180 | Pure reader for a drawn CS2 encounter row (`"2 hero* \| 2 lion \| 30' deep pits"`). `parseFoeCell` strips a leading count (kept as a STRING because one cell is `2d4`), the pg. 39 footnote star, a trailing parenthetical that is a stage direction rather than part of the name (`Wyvern (chained)`), and the book's `Gt.` abbreviation; it singularises only when a count made the plural. `nameCandidates` adds the system's inverted `Family, Variant` form, which is what resolves `Gt. centipede` to *Centipede, Giant* without a lookup table. `parseFoeRow` reads creatures by COLUMN POSITION so the complication is never mistaken for a monster. Shared with the monster census, so the census and the Place button agree on what a row names. Foundry-free, node-tested. |
| `arena-maps.mjs` | 260 | The arena map library: the twelve bundled 2-Minute Tabletop battle maps (CC BY-NC 4.0; see CREDITS), ordered by the CS2 Venue row each stands in for. Every entry carries its id, the 2MT product `label`, the `venueLabel` the GM actually reads, the `venueRows` it suits, an image path, pixel width/height and a per-map grid aligned to the printed squares (72px / 70px / 44px) at 5 ft a square. Grids must be INTEGERS: Foundry's `grid.size` is a NumberField with `integer: true`, so a fractional cell is rounded on write with no error — Greybanner Coliseum shipped as 43.75, silently became 44 and drifted a quarter-square off its own art, and is now re-encoded to 1936x1408 for a whole 44px cell. `getArenaMap(id)` looks one up, `mapsForVenueRow(row)` splits the library into the rolled venue's maps and the rest (it reorders, never filters), and `DEFAULT_ARENA_MAP_ID` names the fallback. Plain data, no Foundry dependency. |
| `arena-scene.mjs` | 212 | Builds any of the module's arena maps as a playable scene: the map on a grid sized to its own printed squares, night darkness, and — unlike the old drawn arena — no synthetic torch lights, because these maps bring their own painted lighting. Per-map idempotent: a scene is matched on the `arenaMap` flag with its map id first so a rename survives, so pressing the same map again returns the one the GM already dressed. VIEWED, never activated: activating would drag every connected player onto the map. **v14 note:** the background lives on the new `Level` embedded document (`scene.levels[].background.src`); `Scene#background` is a read-only v13 shim, and writing the old shape is discarded silently by schema cleaning, leaving a grey scene and no error. |
| `pit-fighting-app.mjs` | 1072 | The bout roller: the `sde-pit-fighting` ApplicationV2 plus the `PitFighting` logic object. Picks the fighters (their count decides solo vs group, their average level sets the stakes), rolls venue / stakes / twist, offers the danger level as an override that redraws the foe from the newly selected encounter table, holds the twist back until Reveal, draws the prize, and awards the fame through `Renown.award`. `findBoutTable` resolves tables by book name and tolerates the suite's `Source - Name` prefix; a table that is missing is NAMED in the window with a link to the importer, never substituted with text of its own. Reads TableResult `name \|\| description` — never `text`, which still fires the v13 deprecation getter. GM-only. |

Structure and thresholds only. Venue descriptions, twist details, what each stakes tier is fought for and the foes themselves all live in the RollTables you import from your own book — this folder holds dice ranges and mechanics, the same class of bare numbers as the reaction bands. The book leaves the danger level and the foe to the GM, so the module suggests and never decides.

### 3.21 `scripts/forge-loot/` — pure Forge & Loot policy

| File | Lines | Description |
|---|---:|---|
| `class-idiom.mjs` | 1228 | Foundry-free G6a class-idiom and legal-choice layer: derives explainable ability signals from imported class/talent metadata, resolves every supported Character Builder choice through snapshots and an injected RNG, preserves exact talent-count and class-permission parity, and returns a stable value/signals/fallback or enumerated unsupported result without class-name branches. |
| `advancement-engine.mjs` | 936 | Foundry-free G6b advancement engine: clones a complete level-one Player plan, rolls HP and bounded level-3/5 talent graphs through G6a, fills caster spell-grid deltas, resolves every supported replacement effect, records duplicate/recursion caps and level history, and returns a deterministic complete plan or diagnostic failure without persistence. |
| `class-readiness.mjs` | 753 | Foundry-free G3 class automation-readiness evaluator, stable blocker/warning vocabulary, G6a mappings, and bounded importer defect queue. |
| `class-readiness-adapter.mjs` | 302 | Read-only Foundry adapter that inventories Core and importer-managed Classes, resolves talent evidence, invokes the existing via classifier, and feeds the pure readiness report. |
| `forge-loot-app.mjs` | 278 | The `sde-forge-loot` ApplicationV2 shell: generator selection, declared adapter inputs, preview/report rendering, and thin Generate Preview/Reroll/Cancel/Approve controls. It contains no NPC or Rival Crawler rules and delegates all persistence to the core adapter contract. |
| `forge-loot-core.mjs` | 826 | Foundry-free G4 state machine and adapter boundary for the shared Forge & Loot tool: deterministic seeds, immutable previews, explicit reroll/cancel/approve transitions, missing/exclusion/warning diagnostics, active-GM/source-drift gates, and a synchronous in-flight commit guard. G5/G7 supply generator rules and sole commit adapters; this file performs no world writes. |
| `forge-loot-rng.mjs` | 80 | Foundry-free deterministic mulberry32-style PRNG for Forge & Loot. A fresh seeded function is created for each preview lifecycle, with helpers for bounded integers and snapshot picks; commit adapters receive no RNG and planners never call Foundry RollTable methods. |
| `rival-class-table.mjs` | 250 | Foundry-free G2 policy for selecting eligible Core/importer-managed classes with Level-0 filtering and Core-wins canonical deduplication, then building deterministic equal-probability RollTable payloads with replacement warning and content fingerprint. |
| `rival-class-table-adapter.mjs` | 435 | Foundry adapter for the generated Rival Crawler Classes table: flag-only managed-pack lookup, GM-gated create/replace reconciliation with manual-edit warnings, source freshness checks, and debounced ClassIndex invalidation wiring. |
| `supporting-tables.mjs` | 800 | Foundry-free G8 logical-role registry for NPC/Rival supporting tables: exact manifest/source identities, ancestry/alignment dynamic child resolution, Signature Tactics matrix identities, pure row selection, and a read-only managed-pack adapter that fails closed on missing, foreign, duplicate, or name-only tables. |

The report and idiom seams are pure data policy. Foundry adapters must translate documents into snapshots and keep reads separate from later generator/commit work.

### 3.22 `scripts/quests/` — the Quest Log

| File | Lines | Description |
|---|---:|---|
| `quest-core.mjs` | 363 | The Quest Log's rules, pure: the quest flag's one shape, status changes and the ownership each status gives, who a player may see, objectives, when rewards are paid (once, on the way into Completed) and to whom, list filters, which trainer tasks a character has taken, which map pin to jump to, and the player page's HTML. |
| `quests.mjs` | 568 | The Quest Log's data and public API: one world JournalEntry per quest in a flagged Quests folder, with a player page rewritten from the flag and a GM notes page left alone. GM-only writes serialized per client through replaceModuleFlag; the payout confirmation and payout through Party XP, the renown ledger and item copies; Shadowdark Extras parties read from its flags behind a feature check; jump to pin; the Ctrl+Q keybinding, the Journal sidebar button and the debounced questsChanged hook. |
| `quest-log-app.mjs` | 272 | The Quest Log window (AppV2): a tab per status (Hidden for the GM only), filters by character, party and source, the quest list and the chosen quest. The GM edits in place (objectives, rewards with items dropped on, characters, party, hex); players get the same quest read-only. |

One world JournalEntry per quest, its state one flag on the entry. World journals rather than the managed journal pack, because a compendium has one ownership for the whole pack and a quest's visibility is per quest. Every write is the GM's.

### 3.23 `scripts/bastion/` — the Bastion actor

| File | Lines | Description |
|---|---:|---|
| `bastion-core.mjs` | 380 | The rules, pure: the four types and twenty upgrades with their costs and caps, building a week at a time, repairs, the monthly disaster, and the state the actor stores. |
| `bastion-plan.mjs` | 315 | The plan, pure: SVG markup for a bastion from outside (buildings round the main one) or in (one connected compound of rooms, with roofs), each upgrade keeping the place it took. |
| `bastion-funding.mjs` | 57 | The party link and paying into the treasury, pure: which actors are parties, who can pay, and the purse arithmetic for paying gold in and out. Extras' own party coins are never read or written. |
| `bastion-art.mjs` | 33 | The actor type id, where the bastion art files are (assets/bastion/art), and the one-time load of the sprite sheet the plan and the panel draw from. |
| `bastion-data-model.mjs` | 53 | The Bastion actor's data model: type, build weeks, hit points, treasury, upgrades and their places, repair, log. |
| `bastion-sheet.mjs` | 331 | The Bastion actor sheet (ApplicationV2): Overview, Upgrades, Plan (exterior and interior, roofs, zoom, room card, SVG and PNG export) and Log. The GM edits. |
| `register-bastion.mjs` | 92 | Registers the `shadowdark-enhancer.bastion` actor type, its sheet and art defaults, and builds `game.shadowdarkEnhancer.bastion`. |
| `bastion-text.mjs` | 34 | Words the sheet and the panel share: the localizers, why a rules call said no, and a log line turned into words. |
| `bastion-writes.mjs` | 209 | Writing a bastion and paying into it, the GM's: a state written back as one update (the type's art follows a retype), and gold moved between a character's purse and the treasury with each write read back and the first put back if the second is refused. |
| `bastion-panel-core.mjs` | 44 | What the panel shows, pure: the bastions a user can see (optionally one party's) and the card for each: art, type, week, hit points, treasury, upgrades built and building. |
| `bastion-panel.mjs` | 108 | The Bastion panel window (ApplicationV2): a card per bastion with Open, and for the GM Pay in, Pay out and New bastion. Redraws as bastions change. |
| `bastion-entry-points.mjs` | 33 | The ways into the panel: a Bastions entry in the Actors directory's right-click menu on a party actor (the GM always; a player when the party owns a bastion they can see). |
| `bastion-income.mjs` | 99 | The Casino's income on the world clock: 2d20 gp into the treasury of a standing bastion with a finished Casino at each month start, each month paid once (marked on the bastion), read back, and a payment that did not save told to the GMs. |
| `bastion-library.mjs` | 32 | The Library's +1 on the learning downtime checks (martial training, magical research) for the members of the party that owns a standing bastion with a finished Library; two don't stack. |
| `bastion-members.mjs` | 20 | The characters a bastion's party covers: the linked party's members when Extras lists any, otherwise every player character; no link, no one. |
| `bastion-trophies.mjs` | 34 | The Trophy Room's XP: a trophy placed is written first, then 1 XP goes to each party member through Party XP; a refused award takes the trophy back out. |
| `bastion-vault-core.mjs` | 31 | The Vault's slot rules (pure): 100 gear slots, a stack's slots as on a character, which items may be stored. |
| `bastion-vault.mjs` | 61 | Moving gear into and out of the Vault: a copy first and a delete second, each read back, a copy whose original stayed is taken out again. |
| `bastion-aviary.mjs` | 30 | The Aviary's pigeon: one message a world-clock day, the day marked on the bastion before the message is posted and put back if it can't be. |
| `bastion-shop-core.mjs` | 50 | The bastion shops' rules (pure): the Armorer, Blacksmith and Trading Post, which gear each sells, the 10% markup and a purchase's price. |
| `bastion-shop.mjs` | 73 | Buying at a bastion shop: the Catalog's ordinary gear for a kind, the purse paid and the item made, each read back, the gold returned if the item can't be made. |
| `bastion-shop-app.mjs` | 106 | The bastion shop window: pick a character of the party, search the stock, buy; opened from the Shops box on the Bastion sheet (GM). |

A place the party owns: the four types and twenty upgrades, built a week at a time, drawn from outside or in. The art is assets/bastion, generated by tools/bastion-art.
<!-- inventory:scripts:end -->
---

## 4. `templates/` — 41 Handlebars templates

`importer-hub.hbs` (939) · `encounter-creator.hbs` (856) · `merchant-shop.hbs` (476) ·
`encounter-roller.hbs` (457) · `downtime.hbs` (422) · `class-importer.hbs` (235) ·
`session-recap.hbs` (205) · `magic-forge.hbs` (187) ·
`quick-adjust.hbs` (180) · `monster-importer.hbs` (146) · `level-guidelines.hbs` (109) ·
`token-art-manager.hbs` (107) · `loot-setup.hbs` (97) · `item-builder.hbs` (82) ·
`spell-importer.hbs` (81) · `party-xp.hbs` (71) · `loot-generator.hbs` (52)

- `templates/char-builder/` — shell, gear-editor, `partials/list.hbs`, 11 step bodies.
- `templates/actors/` — `boat-sheet.hbs`, `mount-sheet.hbs`.
- `templates/chat/` — encounter-check, encounter-flavor, encounter-result, loot-card.
- `templates/partials/` — `census.hbs`, `tree-node.hbs`.

## 5. `styles/`

`shadowdark-enhancer.css` — **9,456 lines**, the single stylesheet. (Foundry does not refetch module CSS on reload; hard refresh needed.)

## 6. `languages/`

`en.json` — the only localization file.

## 7. `test/` — 67 node `--test` suites (~11,500 lines, flat by design)

Parsers: `statblock-parser`, `gear-parser`, `ancestry-parser`, `hex-parser`, `background-parser`, `boat-parser`, `siege-parser`, `class-parser-talent-layout`, `pdf-text-normalize`, `pdf-extract-crop`, `pdf-extract-gutter`, `pdf-grab-warnings`, `parser-review-regressions`.
Tables: `table-shapes`, `table-name-source-match`, `table-shared-names`, `table-warning-summary`, `carousing-event-shape`, `carousing-outcome-shape`, `traps-hazards-shape`, `core-generator-shapes`, `subroll`.
Class pipeline: `class-quality-gate`, `class-reimport-diff`, `class-borrowed-spell-list`, `class-ability-uses`, `spell-relink`, `spell-relink-persist`.
Monsters: `monster-effect-runtime`, `monster-mechanical-adapters`, `monster-mutator-apply`, `monster-table-runtime`, `monster-table-seed`, `monster-matrix-import`, `monster-generator-integration`, `monster-generator-layout`, `level-guidelines`, `manage-tree-monsters`.
Magic/loot: `magic-forge`, `magic-table-runtime`, `magic-bundle-import`, `magic-bundle-persist`, `magic-loot-handoff`.
Crawl/movement: `crawl-state-core`, `crawl-state-integration`, `crawl-lights-core`, `movement-calc`.
Downtime: `downtime-core`, `downtime-parser`, `downtime-effects`, `downtime-log`, `downtime-affordability`.
Contracts: `docs-contract`, `inventory-contract`.
Multi-client: `gm-relay-handshake`.
Other: `content-registry`, `coins`, `party-xp-core`, `session-recap-core`, `pdf-export`, `source-pdf-registry`, `tokenart-catalog`, `item-builder-gear`, `html-safety`, `loading-dialog-guard`, `encounter-sources`, `importer-hub-cache-invalidation`.

## 8. `assets/` + `icons/` (shipped art)

| Path | Contents |
|---|---|
| `assets/icons/shikashi/` | 284 `.webp` item icons + `manifest.json`. Credited in CREDITS.md. |
| `assets/ancestries/` | 7 ancestry portraits (WebP, ≤1024 px). |
| `assets/pdf/` | Form-fillable character sheet + field map JSON. |
| `assets/portraits/README.md` | Gallery folder usage note. |
| `icons/game-icons/classes/` | 25 recolored game-icons.net class emblems (fill baked in). |
| `icons/game-icons/` | 8 shared SVGs. |
| `icons/` root | `dragon-head.svg`, `light-sabers.svg`, `shamrock.svg`. |

## 9. Tracked-but-not-shipped, and local-only

**Tracked in git but excluded from module.zip** (release.yml allowlist):
`test/`, `package.json`, `eslint.config.mjs`, `.github/`, `tools/` (the
`npm run inventory` generator that maintains this page), `docs/wiki/` (the
manual) and this `docs/FILE-INVENTORY.md`. Of `docs/`, only `API.md` ships.

**Gitignored / local-only** (never published):
- `data/` — `monster-art-mapping.json` (install-specific), `bestiary-reference.json` (third-party scrape; deliberately kept out).
- `dev/` — probes, fixtures, `dev/tests/` content-contract suite, generators, e2e drivers + dumps, `real-pastes/`, `pdf-sheet/` sandbox, page renders, backups, `reorg-2026-07/` (the folder-reorg migration scripts).
- `docs/` except `wiki/`, `API.md`, `FILE-INVENTORY.md` — internal audits, review reports, sweep dumps, the promo plan and `superpowers/` plans/specs; kept on disk, out of git.
- `.planning/` — STATUS, ROADMAP, REQUIREMENTS, playbooks, phases, seeds, sessions, wr-scrape.
- `.claude/`, `.gemini/`, `.superpowers/`, `.hermes/`, `.playwright-mcp/`, `node_modules/`, `package-lock.json`, agent docs. (`verify.sh` is tracked but stays out of the release zip, which is allowlist-based.)
- `training-android/`, `training-app/` — untracked and NOT gitignored; unrelated to the module. Decide: ignore, remove, or move out.
