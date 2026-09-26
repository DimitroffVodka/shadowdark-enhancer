# Regional Training

[← Wiki home](index.md)

The Game Master's Guide to the Western Reaches prints 21 trainers across its
regions. Each has four tasks and four benefits: complete a task, and the
trainer teaches you a technique. Each technique can be learned **once**.

The Regional Training window runs that for you. Pick a character and a
trainer, roll the trainer's d4, and the benefit lands on the character's sheet
as a Talent.

There is no DC and no cost. The gate is the task, which is an adventure you
run at the table.

---

## Opening it

| Route | How |
|---|---|
| **Forge & Loot menu** | Click **Forge & Loot** on the crawl bar, then **Regional Training** |
| **Quest Log** | Completing a quest with a training reward offers to open it (see [Quest Log](Quest-Log.md#trainer-tasks)) |
| **API** | `game.shadowdarkEnhancer.training.open()` |

It opens on your own character, or else on the token you have selected.

---

## What you need from your books

The module ships no book text. Two things come from your own copy of the GM
Guide, and the window works without either of them:

- **The benefits tables.** Import the 21 *\<Topic\> Training Benefits* tables
  from the [Importer Hub](Importer-Hub.md), like any other roll table. They file
  under the GM Guide's *Training* folder in the Roll Tables pack. Without a
  trainer's table, the window says it is missing and shows the module's own
  short summary of each benefit instead of the book's words.
- **The trainer journals.** These hold each trainer's description and four
  tasks. Register your GM Guide PDF under **Tools → Source PDFs** first, then
  press **Import trainer journals** in the window. It reads all 21 trainer
  pages and files one journal entry per trainer in the Journals pack, under
  *Regional Training*, in a folder per region. A page that did not read cleanly
  is reported, and the console names it.

Importing the journals again updates them in place. An entry you renamed keeps
its name, and pages you added to it are left alone.

---

## The window

- **Character**: the characters you own. The GM sees every character.
- **Trainer**: grouped by region. Three trainers the book places at a hex
  rather than in a region are under *Elsewhere in the Reaches*.
- **N of 4 left**: how many benefits this trainer still has for this
  character.

Below that is the trainer, with the page in the GM Guide, then two lists.

**Tasks** come from the trainer's journal entry. **Open this trainer's journal
entry** opens it. Each task has an **Add to Quest Log** button, greyed out until
you choose a character, which turns it into a quest for that character (see
[Quest Log](Quest-Log.md#trainer-tasks)). A task already on the log shows
**Taken**, or **Done** once the quest is completed.

**Benefits** shows all four faces of the d4, each with a tag:

| Tag | Meaning |
|---|---|
| **Taught** | This character already has it. It is struck through. |
| **Applied for you** | The module puts its effect on the sheet. |
| **At the table** | Recorded on the sheet, but you apply it yourself. A line under it says what is left to do. |

---

## Rolling for a benefit

Press **Roll d4**. It is greyed out until you choose a character, and when the
trainer has nothing left to teach them.

1. The d4 is rolled to chat.
2. If the character already has that face, the roll moves up to the next face
   they don't have, wrapping from 4 to 1. Every roll teaches something.
3. A benefit that offers a choice ("this or that") asks **Which benefit?**.
   Closing that window teaches nothing.
4. The benefit is added to the character as a Talent named after the trainer's
   topic, and a chat card names it and says what else was done.

The Talent carries the book's line for that benefit (or the module's summary),
who taught it and the GM Guide page, and an **At the table** line when
something is left for you to do.

### What is applied for you

Of the 84 benefits, 27 do something on the sheet by themselves. The rest are
recorded on the sheet for the table to honour.

- **Lasting bonuses** go on the Talent as Active Effects, such as a bonus to
  hit with certain weapons, AC or initiative, or a change to the dying rules.
  They last as long as the Talent does.
- **One-time changes** happen once, when the benefit is taught: extra maximum
  HP (current HP rises with it), renown through the [Renown](Renown.md) ledger,
  an ability score rolled again, or a weapon or item the character now owns.

The Gladiator's **+1 to death timer rolls**, the Heath Witch's stabilize DC 12
and the Ancient Ritual's *Survive 0 CON* work with
[Dying and Death Timers](Dying-and-Death-Timers.md#modifiers).

### If something goes wrong

The Talent is written first. If it cannot be created, nothing else is written
and the benefit is still there to learn. If a one-time change fails after that,
the benefit counts as taught, and the chat card says what could not be applied
so you can apply it by hand. A benefit is never paid twice.

---

## Once each

The module knows which benefits a character has from the Talents on their
sheet. Delete a training Talent and that benefit can be learned again.

---

## For module authors

`game.shadowdarkEnhancer.training` offers `open`, `grant` and `taught`. See
[the API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md#training--the-western-reaches-regional-trainers).
