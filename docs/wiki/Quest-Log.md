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
2. Name it, and type the description players will read.
3. Add objectives: type one and press **Enter**. Tick them off as the party
   gets them done; only you can.
4. Set the rewards:
   - **XP each** and **Renown each**, paid in full to every character you pick.
   - **Items**: drag them from the sidebar, a compendium or a sheet onto the
     rewards box.
   - **Training benefit**: a trainer whose benefit roll follows completion.
5. Pick the **characters** the quest is personal to, if any, and its **party**
   if you use Shadowdark Extras.
6. Set the status to **Available** or **Active** when the players should see it.

Every change saves as you make it.

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

Rewards are paid **once**. Setting a completed quest back to Active and
completing it again pays nothing more. To complete a quest whose rewards you
handed out yourself, untick everyone and set every item and training choice
to *Nobody*.

---

## Trainer tasks

Each task in the Regional Training window has an **Add to Quest Log** button
(GM only). Choose the character in the window's **Character** list first; until
then the button is greyed out. It adds an **Available** quest personal
to that character, with the task as its one objective and the trainer's
benefit as its reward. The task then shows **Taken**, and **Done** once the
quest is completed.

Completing the quest offers to open Regional Training on that trainer for
that character. The benefit roll and the book's "once each" rule work exactly
as before. A failed task can be taken again.

---

## Parties (Shadowdark Extras)

With Shadowdark Extras installed, a quest can be assigned to one of its party
actors, and the Quest Log can be filtered by party. Filtering by a party shows
the quests assigned to it **and** the personal quests of its members. Without
Extras the party picker is simply not there.

Shadowdark Extras reads these quests for its own party-sheet Quests tab
through the API below.

---

## Jump to pin

A quest's **Jump to pin** button appears when it has somewhere to go:

- a map note placed for the quest itself: drag the quest's journal entry onto
  a scene; or
- the pin the Hex Tagger placed for the quest's **Hex** (set it under
  *Location*). This covers settlements and keyed hexes.

The GM is taken to the pin's scene. A player is panned to it only on the scene
they are viewing.

---

## For module authors

`game.shadowdarkEnhancer.quests` offers `open`, `list`, `get`, `create` and
`setStatus`, and `shadowdark-enhancer.questsChanged` fires on every client
after any change. A rumor ledger or a trouble tracker creates its quest with a
`source` of its own. See [the API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#quests--the-quest-log).
