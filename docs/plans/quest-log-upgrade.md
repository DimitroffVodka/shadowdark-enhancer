# Quest Log upgrade: plan

Status: built on feat/quest-log-upgrade (commits 33707fa2 to the review-fix commits); this is the design record. Revision 2, 2026-10-17: folds in the first independent review (Opus, section 1a).
Base: `master` 2702afdd plus `feat/rumor-quests` 81c71b9c (Hidden quests drafted from rumors, already committed, unpushed).
Working copy: `/home/patricks/git/.worktrees/rumor-quests` (a fresh clone; the main checkout has no `.git`).

## 1. Where this came from

Patrick pasted a transcript of a YouTube comparison of six Foundry quest modules (Forien's Quest Log, Monk's Enhanced
Journal, Simple Quest, Quest System, Phil's Quest Tracker, Mythic's Simpler Quests) and asked what would improve the
Enhancer's Quest Log. An earlier pass listed eight gaps; he decided each. No code is copied from any of those modules;
only the ideas.

| # | Gap | Patrick's decision |
|---|---|---|
| 1 | Players are not told when a quest changes | Wants it, and asked "how would they know a quest failed?" Answered in F5. |
| 2 | Secret steps, and "show only the next step" | Yes |
| 3 | Quest giver, free-text reward, silver and copper boxes | Yes |
| 4 | Time on quests, with an option to fail automatically at a date | Yes ("quests need time associated with them") |
| 5 | Players press Accept, the GM approves | Yes |
| 6 | Sub-steps | Yes |
| 7 | Players' disabled checkboxes shown as plain marks | No |
| 8 | Always-on quest tracker (Crawl Strip) | No |
| - | Quests from rumors, automatic, GM-only | Done already (feat/rumor-quests) |

## 1a. Review record (first review, Opus, 2026-10-17: "build after these changes")

Every finding below is folded into the sections that follow. "Verified" means the reviewer saw it in the code or in
Foundry's own source; the rest is its reasoning from the plan.

| Finding | What changed |
|---|---|
| A new step is public (saved, on the player page, popped up) before the GM can click its eye | The eye is on the add-step and add-sub-step rows, so a step can be created secret (F2). |
| Reopening an auto-failed quest fails it again at once | Fail-at-deadline fires once and switches itself off in the same pass (F4). |
| Three date boxes save one at a time; with `questsChanged` as a clock trigger a half-typed past date could reveal or fail a quest | The clock never acts on an edit: only when the world clock crosses midnight, and on load (F4). Open question 1 changed. |
| Accept as a button is dead in the Party sheet for a player who only observes the party (verified: the sheet disables form controls for non-editors) | Accept is a link, not a button (F6); a lane test with an observer-only player. |
| "Waiting for the GM" never clears after Not now | No waiting state; a "Sent to the GM" toast (F6). |
| Chat lines from the active GM's snapshot diff would name a quest players never saw, and depend on load timing | The chat line is posted from `setStatus`, only when the old status was Available or Active (F5). Pop-ups are players only. |
| Section 3 secrecy claim was wrong (verified: the server sends every journal to every client) | Section 3 rewritten; the Accept handler gives one generic refusal. |
| `dateToTime` returns null for 31 Dec 1347 and 29 Feb 1348 and shows 1 Jan 1348 twice (verified against core's conversion) | The date box never says "invalid"; a test sweeps 1348 to 1352; month-grid picking is the fallback (F4). |
| `questsChanged` ignores page writes (verified, `quests.mjs` 571-574) | Section 2 and F5 corrected. |
| The Party sheet has no list of forwarded actions to extend (verified: `party-app.mjs` ~359 rewrites every `data-action`) | F1 and F6 corrected. |
| `test/gm-relay.test.mjs` scans `git ls-files` only | New files are `git add`-ed before that test is trusted (Section 7). |
| "No pop-ups for a GM's own changes" cannot be built (`questsChanged` carries ids only) | GMs get no pop-ups (F5). |
| Other rewards would be hidden from players by `hasRewards` | A separate `hasNotes` display check (F3). |
| The Overdue chip goes stale while the clock runs | Redraw when the day changes (F4). |
| Pop-up floods | One-second debounce; more than three events become one summary line (F5). |
| An old GM tab (old code) would strip the new fields and make secret steps public | `normalizeQuest` carries unknown keys through from now on; the changelog tells GMs to reload open tabs (Section 4). |
| Sub-step order, i18n key clashes, unescaped names in the GM prompt | Added to F1, F6 and the tests. |
| A Hidden quest already overdue when its date arrives | It stays Hidden, with an Overdue chip for the GM (F4). Open question 9 changed. |

## 2. What exists today (verified in the code)

- `scripts/quests/quest-core.mjs` (376 lines): pure rules, node-testable. `normalizeQuest` (builds the flag from known keys
  only, quest-core.mjs:121-140), `mergeQuest` (status, source and paid never move through it), `planStatusChange`,
  `payoutPlan`, `playerPageHtml`, `objectiveProgress`, `canSee`.
  Flag shape: `status, source, characters, party, description, objectives [{id,text,done}], rewards {xp, coins, renown,
  items, training}, hex, hexScene, paid, payout`.
- `scripts/quests/quests.mjs` (575 lines): one world JournalEntry per quest in a Quests folder, state in
  `flags.shadowdark-enhancer.quest`. `writeQuest` replaces the whole flag through `replaceModuleFlag`, then updates the
  entry's ownership and rewrites the player page from the flag. Every write goes through one per-client queue
  (`serialize`). `toSummary(entry)` returns the flag to anyone who may read the entry, with no per-user filtering.
  Header comment: "Every write is the GM's ... so there is no relay."
- Players hold Observer on a non-Hidden quest entry: they read, never write. Hidden is ownership None.
- `Quests.list/get` feed the Quest Log window (`quest-log-app.mjs`, `templates/quest-log.hbs`), the Party sheet's Quests
  tab (the same `QuestLogApp` hosted inline through `party-app.mjs _questController`; the sheet rewrites every
  `data-action` of the inline log, so a new action needs no registration there) and the public API.
- `shadowdark-enhancer.questsChanged` fires on every client once per burst of JournalEntry create, update and delete
  (`quests.mjs` 571-574). It does not fire for page writes. It carries ids only, not what changed. A status change is
  two writes (the flag, then the entry's ownership), so a player's client sees two bursts.
- `shadowdark-enhancer.timeAdvanced` (`scripts/time/time.mjs`) fires on the active GM only, `{from, to, dt, crossed}`, and
  fires every second while the system's real-time light tracking runs. `crossed.days` counts midnights crossed
  (`time-core.mjs crossings`). Bastion income (`bastion-income.mjs` 60) and warband upkeep (`warband-upkeep.mjs` 451)
  already act only when `crossed.days > 0`.
- `scripts/shared/gm-relay.mjs`: `registerQuery`, `refuseQuery`, `queryActiveGM`, `relayToGM`, `isActiveGM`. Players reach the
  active GM over an authenticated user query; identity comes from the server-stamped `context.user`, never the payload.
  The query's answer window is 20 s. `scripts/modes-of-play/pulp.mjs` is the model (a player button calls `relayToGM`, the
  handler calls `refuseQuery` first). `test/gm-relay.test.mjs` fails any query not registered through `registerQuery`,
  but scans only files git tracks (`git ls-files scripts`).
- Coin payout already handles gp, sp and cp (`quests.mjs pay`: `Object.entries(plan.coins.amount)`); only the editor has a gp box.
- `dateToTime(cal, {year, month, day, hour, minute})` (`scripts/overland/hud-core.mjs`) turns a calendar date into a
  worldTime; `dateParts(cal, t)` (`time-core.mjs`) goes back; `secondsPerDay(cal)` is in `time-core.mjs`. Against core's own
  conversion, `dateToTime` returns null for 31 Dec 1347 and 29 Feb 1348 and resolves 1 Jan 1348 to the first of two
  matching days (reviewer's scratch run). `monthGrid` (`hud-core.mjs` 242) reads each day back from core.
- Contracts a change must satisfy: `docs/API.md` and `apiVersion` (1.31.0, pinned by `test/generated-item-api.test.mjs`
  and `test/forge-loot.test.mjs`), every `SDE.*` key written out in full in `languages/en.json` (no key built from
  pieces, and no key that is both a string and a group: `SDE.quests.rewards` and `SDE.quests.objectives` are strings, so
  nothing may be added under them; `test/i18n-keys.test.mjs`), `STYLESHEET_REV` in the entry script is hand-kept (sha256 of
  the css, first 12) and pinned by `test/monster-generator-layout.test.mjs`, `npm run inventory` for new files and the
  build stamp. Every flag write goes through `replaceModuleFlag` (via `writeQuest`); no flag key contains a dot.

## 3. Constraints that shape the design

- Foundry's server sends every JournalEntry, Hidden quests and GM-notes pages included, to every client, and every client
  applies every broadcast write (reviewer, verified in Foundry's server and client source). So "Hidden" and "secret" are
  table-level: the window, the API and the player page never show them, but a player who opens the browser console can
  read them, and moving text to the GM-notes page would not change that. Decided: acceptable at a table of friends, as
  Hidden quests already are. A consequence: Accept cannot leak a Hidden quest's existence, so one generic refusal is enough.
- Players cannot write documents. Anything a player does that changes the log has to be a request the GM's client performs.
- Other GMs use this module (Enhancer alone, Extras alone, both). New fields are additive; an old quest loads unchanged;
  nothing is removed.
- Patrick runs the table: the UI speaks in table terms (quest, step, deadline), not in flags. No console macros or buttons
  outside the Quest Log window. Where a rare corner needs a choice, take the simple default and say so; never add a
  refusal for it. Every user-facing string is an `en.json` key.
- Foundry v14 only (verified on 14.369): v14 APIs freely, no v13 fallbacks.
- Both themes (dark and light) are checked for every window change; the Party sheet's inline Quests tab is a second host.

## 4. Data changes (all in the quest flag, all optional)

| Field | Shape | Notes |
|---|---|---|
| `objectives[].parent` | step id or `null` | One level only. Must name an earlier top-level step of the same quest (checked after empty steps are dropped), else `null`. |
| `objectives[].secret` | boolean | GM sees it, the window, API and page do not show it to players, until the GM clears it. |
| `reveal` | `"all"` or `"next"` | `"next"`: players see the done top-level steps and the first undone one. |
| `giver` | `{uuid, name, img}` or `null` | A snapshot, so players need no permission on the actor. |
| `rewards.notes` | `string[]` | Rewards the log does not pay ("free lodging at the lighthouse"). Shown to players. |
| `startsAt` | worldTime or `null` | First second of the chosen day. GM only. Cleared once it fires. |
| `deadline` | worldTime or `null` | First second of the chosen day; the quest runs through the end of that day. |
| `autoFail` | boolean | Only meaningful with a deadline. Switched off once it has failed the quest. |

`normalizeQuest` fills every default, so a quest saved before this change reads as `parent: null, secret: false,
reveal: "all", giver: null, notes: [], startsAt: null, deadline: null, autoFail: false`. From commit 1 it also carries
unknown top-level keys through unchanged, so a later build's fields survive a GM tab on this build; an open GM tab on the
OLD build would still strip the new fields and make secret steps public, so the changelog says to reload GM tabs after
updating. `mergeQuest` keeps working because the new fields ride in the patch like `description` does.

New pure rules, in `quest-core.mjs`, each with node tests:

- `playerView(quest)`: what a player may see: secret steps (and their children) removed, `reveal: "next"` applied,
  `startsAt` stripped. Used by `toSummary` for any non-GM, by `playerPageHtml`, and therefore by the window and the API.
- `addObjective` and `addSubStep` (both can create a step already secret), `removeObjective` (a parent takes its children
  with it), the depth cap in `normalizeObjective`.
- `hasNotes(rewards)`, separate from `hasRewards`.
- `deadlineState(quest, now, spd)`: `none`, `open` or `overdue`.
- `dueChanges(quests, now, spd)`: the status moves the clock calls for (F4).
- `questEvents(prev, next)`: what changed between two snapshots, for the players' pop-ups (F5).

## 5. The features

### F1. Sub-steps (commit 1)

- GM: each top-level step row gets an "add sub-step" control; sub-steps are indented, tick and edit like any step.
  Removing a parent removes its sub-steps. Ticking a parent does not tick its children, and the reverse.
- `addSubStep` inserts after the parent's last child, so a sub-step never renders under the wrong parent.
- Progress counts every step the viewer can see (parents and sub-steps equally).
- Player page and window show the nesting; the page renders nested lists.
- Files: `quest-core.mjs`, `quest-log-app.mjs` (new action `qlAddSubStep`; it works in the Party sheet's inline host with no
  registration, see section 2), `quest-log.hbs`, css, `en.json`.

### F2. Secret steps and "next step only" (commit 1, same objective model)

- GM: an eye toggle on each step, and on the add-step and add-sub-step rows so a step can be created secret (otherwise it
  would be saved, written to the page and popped up before the GM could hide it). Secret steps are dimmed with a marker in
  the GM's view. A quest-level select, "Players see: all steps / only the next step".
- A secret parent hides its sub-steps. `"next"` counts top-level steps; the visible sub-steps of a shown parent show.
- Players never get a progress count on a `"next"` quest (a count would give away how long the chain is).
- Clearing a step's secret flag reveals it. With the pop-ups (F5) players see "New step" on a quest they already know.
- API: `quests.list/get` return the player view for non-GMs, so a macro cannot read secret text by accident.
- `apiVersion` goes 1.31.0 to 1.32.0 in this commit (additive fields); the two pinned tests move with it.

### F3. Giver, other rewards, silver and copper (commit 2)

- GM drops an NPC actor on a "Given by" box; players see the name and portrait as a chip and a "Given by" line on the page.
  Clearing it removes it. The snapshot is taken at drop time.
- "Other rewards": a short list of typed lines under Rewards. Players see them. They pay nothing: `hasRewards` and
  `shouldPay` ignore them, so a quest with only these opens no payout dialog. The player template and `playerPageHtml`
  show the Rewards section when `hasRewards` or `hasNotes`. The payout confirmation lists the notes as a reminder
  ("hand out yourself") when something else is being paid.
- Rewards row gets Silver and Copper boxes beside Gold (`_onField` already has the `gp` case; add `sp` and `cp`).

### F4. Time on quests (commit 3)

GM-facing: a "When" block in the quest editor.

- **Appears on** a date: a Hidden quest becomes Available when the world clock reaches the first second of that day.
- **Deadline** a date, shown to players, with a checkbox **Fail the quest at the deadline**.
- A date is entered as day, month (the calendar's own month names) and year and converted with `dateToTime`. If the
  calendar has no such day (`null`) the box keeps the old value and says "The world calendar has no such day", never
  "invalid". A test sweeps every day of 1348 to 1352 through `dateToTime` and core's own conversion (the existing
  `quirkyGregorian` in `test/gregorian-calendar.mjs`). If a day inside the campaign (from 12 March 1348) fails the
  round trip, the date is picked from `monthGrid` instead of typed.
- A line under a date that has already passed says what will happen and when ("this fails at the next midnight, or when
  the world loads").

Rules (pure, tested at the boundaries):

- Reveal: status `hidden`, `startsAt` set, `now >= startsAt`, and the deadline (if any) not yet passed, gives status
  `available`, then `startsAt` cleared. The status is written first and the clear second, so a failure between them
  cannot lose the reveal. A Hidden quest whose deadline has already passed stays Hidden, with an Overdue chip for the GM
  only: no pop-up, chat line or Failed entry for a quest players never saw.
- Fail: status `available` or `active`, `deadline` set, `autoFail`, `now >= deadline + secondsPerDay` gives `failed`, then
  `autoFail` is switched off. A GM who reopens the quest (Failed back to Active) therefore does not see it fail again;
  to enforce a new deadline they set it and tick the box again.
- Without `autoFail`, a passed deadline just shows an "Overdue" chip to everyone; the GM decides.
- Failing goes through `Quests.setStatus(id, "failed")`, so the one status path is unchanged. A failed quest pays nothing.

Where it runs: `scripts/quests/quest-clock.mjs`, on the active GM only (`isActiveGM()`), on one queue: on
`timeAdvanced` when `crossed.days > 0` (the bastion and warband precedent), and on `ready`. Never on an edit and never on
`questsChanged`: a date typed in three boxes, or set in the past, acts at the next midnight crossing or at load. Two tabs
of one GM can both run the load check before the browser lock answers (`gm-relay.mjs` 232); warband upkeep has the same
exposure today and it is accepted.

The window and the Party sheet redraw on `updateWorldTime` when the day changes, so the Overdue chip and the date line
do not go stale while the clock runs (today they redraw only on `questsChanged`: `quest-log-app.mjs` 83 and
`party-app.mjs` 538).

Not done: no calendar entries are written for quests (the calendar's entries stay the GM's notes and the module's log).
A quest's date is on the quest.

### F5. Telling players (commit 4)

Answer to "how would they know a quest failed?" Four layers, none of which needs a player to open the log:

1. **A pop-up on every connected player's screen** the moment the status changes: "Quest failed: The drowned bell".
2. **A chat line**, posted by `Quests.setStatus` after it writes the status, when a quest goes from Available or Active to
   Completed or Failed ("Quest failed: X (due 14 March 1348)", the due date only when the quest had one that passed). The
   client that runs `setStatus` posts it (the active GM's client for a deadline failure), so there is exactly one line, a
   completion retry posts none (the old status is already Completed), and a Hidden quest moved straight to Failed posts
   none. It is the record for a player who was away.
3. The quest moves to the **Failed** tab, which carries a count.
4. A deadline failure uses the same `setStatus` path as a GM's manual failure, so there is one behaviour, not two.

Pop-ups are for players only (`questsChanged` carries ids only, so a GM's own changes cannot be told apart; GMs get none).
A player gets one for: a quest becoming visible ("New quest"), Active, Completed, Failed, a step ticked, a step newly
revealed. One pop-up per quest per burst (priority: failed or completed, then active, then new quest, then steps). Failed
uses the warning style. The notices wait about a second after the last change; more than three events in that window
become one line ("Several quests were updated") so a big clock jump or a GM ticking steps cannot flood the screen.

Mechanism: `scripts/quests/quest-notices.mjs`. A player's client keeps a snapshot of `Quests.list()` (what this user may
see: id, status, visible steps with done flags), taken silently on `ready`. On every `questsChanged` the new list is diffed
against it by the pure `questEvents(prev, next)`, then the snapshot is replaced. Diffing the whole list, not the ids, is
what makes it robust: a status change is two writes (flag, then ownership) and a quest simply becomes "new" on the burst
in which it first becomes readable.

No new setting: there is no way for a player to switch the pop-ups off (open question 3).

### F6. Accept quest, GM approves (commit 5)

- Player: a quest in Available shows **Accept quest**, as a link (`<a data-action>`), not a button: the Party sheet is a
  form sheet that disables every button and field for a viewer who cannot edit the party, which would kill a button for
  a player who only observes it. Pressing it sends the request and shows a "Sent to the GM" toast. There is no waiting
  state: after Not now the quest stays Available, and a second press is allowed (the GM side drops duplicates).
- GM: the active GM's client shows a confirm: "{player} wants to take on {quest}. Approve?" with Approve and Not now
  (player and quest names escaped). Approve moves the quest to Active, only if it is still Available. Not now, or closing
  the prompt, whispers the player one line ("The GM isn't ready for you to take {quest}"). The Active change reaches
  everyone through F5's pop-up.
- Eligibility: any player who can read the quest and sees it Available. No check against assigned characters (the GM is
  approving anyway).
- Relay: `QUEST_QUERY` registered through `registerQuery` in `registerQuests`; handler `handleQuestQuery(data, user)` opens
  with `refuseQuery(user, "quest requests")`, takes the sender only from `user`, and gives one generic refusal for an
  unknown quest, a quest that is not Available, or a sender who cannot read it (Hidden quests are already readable from a
  client, section 3, so the refusal need not hide anything). It returns `{ok:true}` at once and opens the prompt without
  awaiting it (the answer window is 20 s, the GM may take longer). One prompt per quest at a time; a second request while one
  is open is dropped. The handler lives in `quests.mjs`, not a new file.
- With no GM connected, `relayToGM` already warns the player; nothing is queued.
- The Party sheet's Quests tab shows the same link with no extra registration.
- The `quests.mjs` header ("no relay") is rewritten: this is the first player request.

## 6. Delivery

One themed PR on one branch (`feat/quest-log-upgrade`), stacked on the rumor commit, one commit per step:

1. Steps: sub-steps, secrets (created secret too), "next only", `playerView`, `normalizeQuest` carrying unknown keys,
   API bump 1.32.0.
2. Giver, other rewards (`hasNotes`), silver and copper.
3. Time: `startsAt`, `deadline`, `autoFail` (fires once), `quest-clock.mjs`, the day-change redraw.
4. Telling players: `quest-notices.mjs` (players' pop-ups) and the chat line inside `setStatus`.
5. Accept quest: the query and link, in `quests.mjs`.

Order reasons: 1 changes the shape every later piece reads; 4 comes after 1 and 3 so events cover revealed steps and
deadline failures; 5 comes last because its result is announced by 4.
Each commit carries its own tests, docs (`docs/wiki/Quest-Log.md`, `docs/API.md`), changelog line (Unreleased, Added) and a
passing `npm test`, `npm run lint`, `npm run inventory:check`. The changelog says to reload open GM tabs after updating.
Commits have no co-author trailer; the PR has no AI footer. Expect merge conflicts on `en.json`, the main stylesheet,
`STYLESHEET_REV` and the build stamps with open PRs 522 and 524. Nothing is pushed or put into Patrick's module folder
without his yes.

## 7. Test plan

Node (`npm test`, the suite is 5853 tests today). Any new file is `git add`-ed before `test/gm-relay.test.mjs` is trusted,
because that test scans only tracked files.

- `test/quest-core.test.mjs` additions: normalize defaults and the old-quest round trip; unknown keys carried through;
  parent validation, depth cap and sub-step order (after the parent's last child; parents checked after empty steps
  drop); `removeObjective` cascade; a step created secret on a live quest; `playerView` for secret, secret parent,
  `next`, nesting, giver, `startsAt` stripped, and the player page carries no secret text; `hasRewards`/`shouldPay`
  ignore notes while `hasNotes` shows them to players; `deadlineState`; `dueChanges` at `deadline + spd - 1` and
  `+ spd`, hidden never fails, a Hidden quest already overdue stays Hidden, `startsAt` cleared after a reveal, `autoFail`
  switched off after a fail, a reopened quest stays open, completed and failed untouched.
- A date test: every day of 1348 to 1352 through `dateToTime` against core's conversion (`quirkyGregorian`).
- `questEvents` tests (in `test/quest-core.test.mjs`; the pop-up queue is in `test/quest-notices.test.mjs`, the chat line in
  `test/quest-chat-line.test.mjs`): each status, step done, step revealed, un-tick ignored, hidden to available is "new",
  jump straight to failed, priority collapse to one event per quest, the more-than-three summary, empty diff.
- `test/quest-accept.test.mjs` and `test/quest-clock.test.mjs`, in the stubbed-Foundry style of
  `test/rumor-quests.test.mjs`: the handler refuses without an active GM, and gives the one generic refusal for an unknown
  quest, one not Available, or a sender who cannot read it; dedupe; approve calls `setStatus` only while Available;
  decline whispers; names escaped; the clock acts only on the active GM, only when a midnight was crossed or on load, writes
  status before clearing; `setStatus` posts one chat line for Available or Active to Completed or Failed, none for
  Hidden to Failed, none on a completion retry.
- Mutation checks for each commit: break the rule, see a test fail, restore.

Browser (design harness, `tools/design-harness`): GM and player views, the Party inline fixture
(`audit-quest-inline.mjs`), dark, light and 520 px, for the sub-step rows, the eye toggles (including on the add rows), the
When block, the giver box, the Overdue chip and the Accept link.

Live (a disposable lane with a GM and Player users; never his real world first):

- Pop-ups on the player's client for each event; one chat line per completion or failure with two GMs connected.
- Accept: player presses, GM prompt, approve then decline; no GM connected; and in the Party sheet as a player who
  only observes the party (the harness cannot show a disabled control).
- Deadline: advance the world clock past a deadline with and without Fail; reveal on a date; a clock move back; reopen a
  failed quest; type a date in the three boxes without anything acting.
- The player's `game.shadowdarkEnhancer.quests.get` shows no secret step, and the journal page text shows none.
- Then, on Patrick's yes, his real world through the usual marks-patch way, including the way back.

## 8. Open questions (each has a default; the review agreed with all but 1 and 9, which changed)

1. Changed after review: the clock never acts on an edit. A date set in the past acts at the next midnight crossing or
   at load, with a warning line under the date saying so.
2. Players get a pop-up for a quest "personal" to someone else's character, because every player can read every
   non-Hidden quest today. Default: yes.
3. No setting to mute the pop-ups. Default: none. Alternative: a per-user client setting (needs `Settings-Reference.md`
   and the docs contract).
4. A chat line for Completed as well as Failed, only when the quest was Available or Active, so a retry or a Hidden jump
   posts none. Completed with rewards already posts XP and renown cards. Default: both.
5. Accept is open to any player who can read the quest. Default: yes. Alternative: owners of the quest's characters or
   party members only.
6. Closing the GM's prompt counts as Not now. Default: yes.
7. Deadlines are always shown to players. Default: yes. A GM-only deadline (a hidden cult ritual) is not planned.
8. Dates are whole days; a deadline of 14 March fails when the clock reaches 15 March. Default: yes. (A "1 January 1348"
   deadline goes overdue while the clock still shows 1 January, because of the calendar's duplicate day.)
9. Changed after review: a Hidden quest whose deadline has already passed when its date arrives stays Hidden, with an
   Overdue chip for the GM only.
10. Two GMs editing one quest at the same moment can still race (the queue is per client). Unchanged from today; the date
    check runs on the active GM only.
11. The API gains new fields and `apiVersion` moves to 1.32.0 in commit 1; other open PRs may also touch the version line.
12. Players who were offline for a pop-up have only the chat line and the Failed tab. No persistent inbox is planned.

## 9. Not in this plan

- The disabled-checkbox look for players (decided no).
- An always-on quest tracker in the Crawl Strip (decided no).
- Players ticking steps, or marking a step done for the GM to approve.
- Failed steps (a step marked failed) and deeper than one level of sub-steps.
- GM-only deadlines, real-time timers, kill-count objectives, themed popups, and writing calendar entries for quests.
- True secrecy for secret or Hidden content (not possible in Foundry; section 3).
- Pop-ups for GMs, a waiting state on Accept, and any clock trigger on an edit.
- Reordering steps by drag.

## 10. What a second review should attack

- The pop-up diff on a player's client: a missed or doubled pop-up, the one-second debounce, an ordering slip when the
  flag and ownership writes land in separate bursts.
- The clock: a quest typed in the past, time moving backwards, a very large jump, an interrupted reveal, two tabs of
  one GM at load.
- The chat line in `setStatus`: every route into a status change (the window, the Party sheet, the API, the clock, the
  payout retry, Troubles' completion listener) posts the right number of lines.
- The Accept link: any way a player can approve their own request or flood the GM.
- The player view: every path that returns a quest to a non-GM (`Quests.list/get`, the window, the page text, the Party tab,
  `questsChanged` listeners such as the Trouble tracker) goes through `playerView`.
- Backwards compatibility of `normalizeQuest` for quests saved by 0.19.0 and by other GMs' worlds, including the
  unknown-key carry-through.
- Anything here that quietly adds an edge-case refusal Patrick said he does not want.
