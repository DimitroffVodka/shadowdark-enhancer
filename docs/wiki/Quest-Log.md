# Quest Log

[← Wiki home](index.md)

One place for "what are we doing", whether the job came from a rumor, a
trouble, a trainer or you. You run it; your players read it.

---

## Opening the Quest Log

| Route | How |
|---|---|
| **Keyboard** | **Alt+Q** (change it under *Configure Controls*) |
| **Journal sidebar** | **Quest Log** at the foot of the Journal tab |
| **API** | `game.shadowdarkEnhancer.quests.open()` |

Everyone can open it. Players get it read-only; only the GM edits.

> The key is Alt+Q rather than Ctrl+Q because browsers on Linux quit on
> Ctrl+Q before Foundry sees the key. To use another key: **Game Settings →
> Configure Controls → Shadowdark Enhancer → Open the Quest Log**, then set
> the key you want. Each player sets their own.

---

## Quests are journal entries

Each quest is a journal entry in a **Quests** folder of the Journal sidebar,
with two pages:

- **Quest**: the description, the objectives and the rewards. The Quest Log
  writes this page every time the quest changes, so edit those parts in the
  Quest Log, not on the page.
- **GM notes**: yours. Players never see this page, and the Quest Log never
  touches it after making it.

You can rename a quest or its folder freely: the log finds its entries by a
flag, not by name. Deleting a quest's journal entry deletes the quest.

---

## Statuses

| Status | Who can read it | Meant for |
|---|---|---|
| **Hidden** | GM only | A quest the players don't know about yet, such as an undiscovered trouble. New quests start here. |
| **Available** | Everyone | Known but not taken: a rumor heard, a trainer's task on offer. |
| **Active** | Everyone | What the party is doing. |
| **Completed** | Everyone | Done. Completing a quest pays its rewards (below). |
| **Failed** | Everyone | Over, and not in the party's favour. |

A Hidden quest stays invisible to players, in the Quest Log and the Journal
sidebar, until you change its status. Players can read any other quest but
never edit it.

---

## Making and editing a quest

1. Press **New quest**. It is made Hidden and opened for you.
2. Name it, and type the description players will read. Drag an NPC from the
   sidebar onto **Given by** to say who gave the quest; players see their name
   and portrait. Press the small x to clear it.
3. Add objectives: type one and press **Enter**. Tick them off as the party
   gets them done; only you can.
   - **Sub-steps:** press the small arrow on a step to add a sub-step under it
     (one level only). Deleting a step deletes its sub-steps; ticking a step
     does not tick them.
   - **Secret steps:** the eye on a step hides it from players until you press
     it again; making a step secret does the same to its sub-steps. The box beside the **+**
     lets you create a step already secret, so a twist never shows early.
     You still see secret steps, dimmed and marked **Secret**.
   - **Players see:** choose **Only the next step** to show the steps already
     done plus the first one left. Players get no progress count on such a quest.
4. Set the rewards:
   - **XP each**, **Gold each**, **Silver each**, **Copper each** and **Renown each**,
     paid in full to every character you pick.
   - **Other rewards**: type a line for anything the log does not hand out
     ("free lodging at the lighthouse") and press **Enter**. Players see these
     lines with the rewards, but nothing is paid for them, so a quest with only
     these asks for no payout. When you complete a quest that pays something
     else, the confirmation lists them as a reminder to hand out yourself.
   - **Items**: drag them from the sidebar, a compendium or a sheet onto the
     rewards box.
   - **Training benefit**: a trainer whose benefit roll follows completion.
5. Open **When** to give the quest dates (below), if it needs them.
6. Pick the **characters** the quest is personal to, if any, and its native
   [Party](Party.md). Extras is optional.
7. Set the status to **Available** or **Active** when the players should see it.

Every change saves as you make it.

### Dates on a quest

Open **When** at the foot of the quest. Each date is a day, a month (from the
world calendar's own months) and a year; the quest saves the date once all
three are filled in, and the small x clears it. If the calendar has no such day,
the date is not saved and you are told so.

- **Appears on**: a Hidden quest becomes Available on that day. Only you see
  this date.
- **Deadline**: players see it as a **Due** line on the quest and on its
  journal page. The quest runs through the end of that day. Once the day is
  over, an **Overdue** chip shows on an Available or Active quest, to everyone
  (on a Hidden quest, to you only), and nothing else happens.
- **Fail the quest at the deadline**: tick it and the quest moves to Failed by
  itself once the deadline's day is over. It fires once: if you move the quest
  back to Active, it stays open until you set a new deadline and tick the box
  again. A Hidden quest whose deadline has already passed when its date
  arrives stays Hidden.

The world clock acts when it passes midnight, and once when the world loads;
never while you are typing. A date already in the past therefore takes effect
at the next midnight, or the next time the world loads, and the window says so
under the date. The Quest Log and the Party sheet redraw when the day changes.

**From rumors.** Giving [Rumors](Rumors.md) already drafts a Hidden quest for
each one. The **From rumors** button in the header drafts them for rumors you
gave before that, then shows them on the Hidden tab.

---

## How players find out

- **A pop-up** on each player's screen when a quest they can see appears, starts,
  is completed or failed, or gets a step ticked or a new step shown. Failed
  quests use the warning style. Several changes at once become one line,
  "Several quests were updated". There is no way for a player to turn them off.
- **A chat line** for everyone when a quest that players could see goes from
  Available or Active to Completed or Failed ("Quest failed: The drowned bell
  (due 14 March 1348)"; the date appears when the deadline had passed). It is
  the record for a player who was away. A Hidden quest moved straight to Failed
  posts nothing, since players never saw it.
- **The Failed tab** keeps the quest, with its count.

GMs get no pop-ups; the chat line is posted by whoever changes the status (for a
deadline failure, the GM whose game runs the clock), so it appears once.

---

## Accepting a quest

A player who sees an **Available** quest gets an **Accept quest** link beside the
quest's source. It is a link, not a button, so it also works for a player who only
looks at the party in the Party sheet's Quests tab. GMs never see it, and neither
does a quest in any other status.

- **The player** presses it and sees "Sent to the GM". Nothing else changes on their
  side: there is no waiting mark, and they can press it again later.
- **The GM** sees a prompt, "Ava wants to take on The drowned bell. Approve?", with
  **Approve** and **Not now**. A second press for the same quest while the prompt
  is open is ignored, so a player cannot flood the GM.
- **Approve** moves the quest to Active, if it is still Available, and the players
  get the usual "quest started" pop-up.
- **Not now**, or closing the prompt, whispers the player one line, "The GM isn't
  ready for you to take The drowned bell". The quest stays Available.
- **No GM connected:** the player is told so, and nothing is queued.
- A quest that has moved on, or that the player cannot see, gets one plain refusal.

---

## Completing a quest

Set the status to **Completed**. If the quest has rewards that have not been
paid, a confirmation lists them first:

- **XP and renown go in full to each character ticked.** Shadowdark does not
  split quest XP. The quest's own characters are ticked by default, else its
  party's members, else the whole party.
- **Each item goes to the character you pick** for it, or to nobody.
- **Training**: pick a character to open Regional Training on that trainer
  for them, so the benefit roll follows.

**Complete and pay** hands everything out: XP through [Party XP](Party-XP.md)
(with its usual chat card), renown through the [Renown](Renown.md) ledger
(tagged *Quest reward*), and a copy of each item onto the character's sheet.
**Cancel** leaves the quest as it was.

Rewards are paid **once**, per character and effect. Confirmed recipients and
amounts are frozen before payout. **Paid** appears only after all selected
effects succeed. On failure, set the quest to Active and then Completed again:
it finishes the saved unpaid effects without another confirmation or repeating
XP, coins, items or renown. Reload retains progress; editing reward fields does
not change an interrupted payout's saved plan. Failed XP and renown chat cards
remain pending separately from Paid: the same retry posts only missing cards,
using the saved award totals, without repeating rewards or successful cards.
Notification failure cannot repeat awards. Restore missing recipients/items
before retrying. Old Paid quests without saved reports do not invent reports.

An empty recipient selection is refused for XP, coins or renown: it never means
everyone. For manually paid rewards, remove those rewards before completion.
Old Paid quests stay paid, without historical back-pay. Items set to Nobody
are deliberately omitted from the plan.

---

## Trainer tasks

Each task in the [Regional Training](Regional-Training.md) window has an **Add to Quest Log** button
(GM only). Choose the character in the window's **Character** list first; until
then the button is greyed out. It adds an **Available** quest personal
to that character, with the task as its one objective and the trainer's
benefit as its reward. The task then shows **Taken**, and **Done** once the
quest is completed.

Completing the quest offers to open Regional Training on that trainer for
that character. The benefit roll and the book's "once each" rule work exactly
as before. A failed task can be taken again.

---

## Parties and optional Shadowdark Extras

Native Parties supply explicit rosters with or without Extras. Filtering by
party shows assigned quests and members' personal quests. Supported legacy
Extras party readers remain available. SDX Party documents are not converted.

Shadowdark Extras reads these quests for its own party-sheet Quests tab
through the API below.

---

## Jump to pin

A quest's **Jump to pin** button appears when it has somewhere to go:

- a map note placed for the quest itself: drag the quest's journal entry onto
  a scene; or
- the pin the Hex Tagger placed for the quest's **Hex** (set it under
  *Location*), or the note Shadowdark Extras placed for that keyed hex on a map it
  painted. This covers settlements and keyed hexes.
  A **Hex** typed there matches that number on any map. To tie a quest to one
  map's hex, open that hex in Hex Data (double click) and link it under
  **Quests here**; typing a number in *Location* afterwards drops that scene.

The GM is taken to the pin's scene. A player is panned to it only on the scene
they are viewing.

---

## For module authors

`game.shadowdarkEnhancer.quests` offers `open`, `list`, `get`, `create` and
`setStatus`, and `shadowdark-enhancer.questsChanged` fires on every client
after any change. A rumor ledger or a trouble tracker creates its quest with a
`source` of its own. See [the API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#quests--the-quest-log).
