# Downtime

[← Wiki home](Home.md)

What the party does between crawls. Pick a character, pick an activity, pay for
it, roll the check, read the result.

![The Downtime window with Cursed Scroll 6 unlocked and a character selected: the
source, character and Roll with pickers across the header, then Spiritualism,
Skulduggery, Martial Training and Magical Research, each row showing its ability
chip, DC, fee and an Attempt button](images/downtime.png)

---

## Opening it

| Route | How |
|---|---|
| **Forge & Loot menu** | Click **Forge & Loot** on the crawl bar, then **Downtime** |
| **API** | `game.shadowdarkEnhancer.downtime.open()` |

A GM can open it whenever they like. **A player can open it only while a session
is running**, and outside one they get `There's no downtime session running right
now.` During a session they also get an **Open Downtime** button on the
announcement card in chat.

A player's window lists only the characters they own. The GM's lists the whole
party.

---

## You unlock it with your own book

The module ships the **skeleton** and nothing else: activity names, compressed
slot labels, DC numbers, which slots cost gold, and the renown or XP a success is
worth. The sentences that say what actually happens are in your book. They stay
there until you import them.

That is the same [bring your own books](Compendium-Packs.md) rule the rest of the
suite follows. What is unusual is where it lands. Downtime text is not a
compendium item or a roll table, so the import writes a **world setting** rather
than creating documents.

> **A book you haven't imported shows nothing but its own title.** No activity
> list, no slot labels, no DCs, no costs. An outline of a book's tables is still
> a reading of that book's tables, so the window won't print one and grey it out.

### A locked book

Open the window with nothing imported and the body is one card per book. Each
card carries the title, a page chip reading `pg 26-27`, this line:

> This book's downtime activities aren't included with the module. Import them
> from your own copy to use them here.

and an **Unlock via Importer** button. Until at least one book is in, there is no
header, no character picker and no footer either.

![The Downtime window with nothing imported: one dashed card per book, each with
its title, a page chip, the line explaining the activities are not included, and
an Unlock via Importer button](images/downtime-locked.png)

### Unlocking, in the Importer

**Unlock via Importer** opens the [Importer Hub](Importer-Hub.md) with the type
and the book already chosen. If the book's PDF is registered in the source
library, the paste box fills itself from the cited pages and a notification
says so. You review the text and click **Parse**. Without a registered PDF the
box stays empty and you paste the pages yourself. By hand it is four steps:

1. Set **Importing** to **Downtime**.
2. Pick the **Book**. Switching books clears the parse, so pick it first.
3. Paste the pages from your own copy, then **Parse**.
4. Press **Unlock outcomes**. That button only appears once something matched.

The preview reports `Matched 25 of 25 slots.` with a tick when a paste lands
cleanly, and a warning triangle with a smaller number when it doesn't. The commit
confirms in a notification, for example
`Downtime (Cursed Scroll 6): 25 of 25 entries unlocked.`

Two lists sit under that count. **Still unfilled:** names the slots that got no
text. **Lines nothing claimed:** shows the pasted lines, with their DC, that the
parser refused to guess at. Nothing is ever assigned by resemblance. A line it
cannot place is handed back to you instead.

Above those sit the parser's notes, with real problems flagged and the quieter
recovery notes left plain. A two-column PDF paste almost always produces a
handful of the quiet ones, because interleaved columns are exactly what the
rescue pass is built to survive. A clean unlock can still be noisy.

One note is worth reading properly. Cursed Scroll 6 names the **City Guard**
where the Western Reaches says **authorities**, so a warning about the wrong name
usually means the paste came from the other book.

> **Auto-detect will not find a downtime page.** The type has to be picked, or
> seeded for you. Left on **Auto-detect**, a downtime paste lands in **Skipped**.

### From the Manage tree

The hub's Manage tree carries a **Downtime** node with one row per book. Each row
shows the book, its pages, and a state chip: `Unlocked (25/25)`,
`Partial (12/25)` or `Locked`. Counts only. The tree never lists what a book
holds, imported or not.

A row's **Unlock** button seeds the paste flow exactly as the window's button
does. Double-clicking a row that is already unlocked opens the Downtime window
instead.

### Partial and stale imports

A partial unlock saves and works. Whatever came through is usable, and a single
line at the foot of the window says how much didn't:

> N entries did not unlock. Re-run the unlock from the Importer with a cleaner
> paste.

It never names them, for the same reason the locked card doesn't. An **Open
Importer** button sits beside it.

Re-running the unlock **replaces** that book's stored text rather than topping it
up, so paste the whole run of pages, not just the part that went missing. The
other book is left alone either way.

If a later module version adds entries, an already-imported book keeps working
and grows a banner offering **Re-import**. Your existing text is untouched.

---

## The two sources

Once at least one is imported, a **Source** dropdown appears at the top left. A
book you haven't imported is still listed there, with `(locked)` after its name.

| Source | Pages | An attempt costs |
|---|---|---|
| **Cursed Scroll 6** | 26-27 | `10 gp × the character's level` |
| **Western Reaches Players Guide** | 234-235 | `50 gp` flat |

The two books print the same 25 activities and disagree in one place: committing
a minor crime is a paid activity in Cursed Scroll 6 and free in the Western
Reaches. Free slots are free in both.

> **The fee is charged per attempt, win or lose.** Coin comes out of the purse
> **before** the die is rolled, so a failure can never leave a character
> un-charged. A character who can't cover it is refused and keeps their money.

**A slot you cannot pay for cannot be chosen.** Its row is dimmed and says so,
for example `Costs 50 gp per attempt — you're 19 gp 9 sp short`, and the
**Choose** button is dead. Free slots stay available at any purse. The block
lifts by itself the moment the character has the coin, with no need to reopen
the window. There is no GM override on any of this, including picking or rolling
for an absent player. If a character should be able to attempt something, give
them the gold on their sheet.

The same check runs again at the roll, because a purse can empty between
choosing and rolling. Failing it there costs nothing and keeps the pick, so the
character can roll once they can pay.

Every payment is mirrored into the [Session Recap](Session-Recap.md) as
`Downtime: <slot label>`, so downtime spending lands in the session's totals
alongside shop purchases.

---

## The activities

Four sections, in book order, shown for an imported book only.

**Every row names its own ability and DC**, as a chip reading `CHA DC 9` or
`INT/STR/DEX DC 15`. The section header gives the ability and that character's
modifier, but the header alone can't speak for Skulduggery, which mixes CHA and
DEX rows in one activity, so the answer sits on the row you are about to press.

### Spiritualism

Rolls WIS throughout.

| Slot | Row reads | Cost |
|---|---|---|
| Gain favor with church | `WIS DC 9` | free, worth **+1 renown** |
| Spiritual strengthening | `WIS DC 12` | free, worth **+2 XP** |
| Reroll a talent roll | `WIS DC 15` | paid |
| End one curse | `WIS DC 18` | paid |

### Skulduggery

Two abilities in one activity. The confidence tricks roll CHA and the crimes
roll DEX.

| Slot | Row reads | Cost |
|---|---|---|
| Start a rumor | `CHA DC 9` | free, worth **±1 renown** |
| Lay low (minor crime) | `CHA DC 12` | free |
| Extortion: 25% price swing | `CHA DC 15` | free |
| Hide out (major crime) | `CHA DC 18` | free |
| Commit a minor crime | `DEX DC 15` | paid in Cursed Scroll 6, free in the Western Reaches |
| Commit a major crime | `DEX DC 18` | paid |

### Martial Training

Tiered by **class hit die**. d8, d10 and d12 classes all share the d8+ tier.
Every slot here is paid, and every row reads `INT/STR/DEX`.

A **Training tier** dropdown at the top of the section offers **d4**, **d6** and
**d8+**. The character's own tier is selected by default and labelled, reading
`d4 — this character`.

| Tier | Slot | Row reads |
|---|---|---|
| d4 | +1 hit or damage | `INT/STR/DEX DC 15` |
| d4 | New weapon (d6 max) | `INT/STR/DEX DC 18` |
| d6 | +1 hit and damage | `INT/STR/DEX DC 12` |
| d6 | New weapon or armor step | `INT/STR/DEX DC 15` |
| d8+ | New armor or weapon | `INT/STR/DEX DC 9` |
| d8+ | +1 hit and damage | `INT/STR/DEX DC 12` |
| d8+ | Step up damage die | `INT/STR/DEX DC 15` |

**Anyone may switch the dropdown to read another tier.** A GM may also attempt
one, which is the point: house rules and one-off rulings happen. For a player the
foreign tier's buttons are dead, with the reason on hover naming their own tier,
so browsing never turns into taking.

When the class hit die can't be read at all, the module still refuses to guess.
Every tier shows, all of it dead, with the note saying why.

A **Roll with** dropdown picks the ability. It offers INT, STR and DEX with each
modifier shown, and starts on whichever is highest.

### Magical Research

Hidden entirely for anyone the system doesn't consider a spellcaster. Everyone
else gets **both of the book's subsections, printed under their real headings**,
the way the page does it:

- **INT or CHA Spellcasters**
- **WIS or CHA Spellcasters**

The one that applies to this character is live. The other stays visible but dead,
with the reason beside its heading naming the list they actually cast from.
Seeing the half you don't get is the point. It's what the book shows you.

| Subsection | Slot | Row reads | Cost |
|---|---|---|---|
| INT or CHA | ADV on next scroll check | `Spellcasting DC 12` | free |
| INT or CHA | Create scroll (tier ≤3) | `Spellcasting DC 15` | paid |
| INT or CHA | Create a listed potion | `Spellcasting DC 15` | paid |
| INT or CHA | Create wand (tier ≤3) | `Spellcasting DC 20` | paid |
| WIS or CHA | ADV on next three spells | `Spellcasting DC 12` | free |
| WIS or CHA | Create scroll (tier ≤3) | `Spellcasting DC 15` | paid |
| WIS or CHA | Trade a known spell | `Spellcasting DC 15` | paid |
| WIS or CHA | Create Potion of Healing | `Spellcasting DC 18` | paid |

**A CHA caster belongs to both**, which is exactly why the book names the
subsections that way, so the module won't pick for you. That character gets a
`Spell list:` row with **Arcane** and **Divine** buttons, and **that toggle is
what decides which subsection is live**. It is remembered on the actor and
defaults to Arcane.

---

## Running it as a table

The window has two modes. On your own, a GM works through the party one character
at a time. In a **session**, everybody picks their own activity and rolls their
own dice.

### Starting one

With a book imported and no session running, the GM's window carries a banner:

> Run downtime as a table: everyone picks their own activity and rolls their own
> dice.

Press **Start session**. Whichever book is selected in **Source** is the one the
session runs on, and it stays pinned there for everyone until the session ends.
Only books you have imported can be picked.

Starting posts a card to chat headed **Downtime**, naming the book, with an
**Open Downtime** button. That is the players' way in.

### Choose, then lock, then roll

A session runs in two phases, and the GM controls the switch.

1. **Choosing.** Every slot row grows a **Choose** button instead of **Attempt**,
   and each row now prints its **full unlocked outcome text** underneath. Players
   read what an activity actually does before committing to it. Picking one marks
   it **Chosen**, and a player gets exactly one pick.
2. **Rolling.** The GM presses **Lock & unlock dice**. Picks freeze, and every
   player's window swaps in a **Roll it** button.

Before it is pressed, a player who has picked sees
`waiting for the GM to unlock the dice`. The GM can go back with **Re-open
picks** at any time.

![A player's window mid-session: their own character only, every row carrying a
Choose button and its outcome text, the chosen row marked Chosen, and a status
strip reading "You chose Spiritual strengthening (Advantage) — waiting for the GM
to unlock the dice"](images/downtime-session.png)

**Advantage is declared at pick time**, not at roll time. Set **Roll with**
before pressing **Choose** and the pick records it, so the GM can see who claimed
what before the dice come out. The options name their own dice, reading
`Advantage (2d20 keep highest)`, `Normal (1d20)` and
`Disadvantage (2d20 keep lowest)`.

> **The dice are the player's own.** The roll runs on their client, under their
> speaker, so their dice colours and their roll history are the ones that show
> up. Only the message id travels back. The GM's side then re-reads the total off
> that chat message and recomputes the DC, the cost and the gating from the
> skeleton, so a player's client is never trusted for a number.

### The GM control panel

While a session runs, the GM's window grows a panel headed
`Session — <book>` with a live count reading `2 chosen · 1 rolled`. Under it is
one row per character showing the pick, the declared advantage in brackets, and
the result once it lands.

| Control | What it does |
|---|---|
| **Lock & unlock dice** | Ends picking, lets players roll |
| **Re-open picks** | Goes back to choosing |
| **Clear** | Drops one character's pick so they can choose again |
| **Roll for** | Rolls on behalf of an absent player |
| **End session** | Closes it for everyone |

**Roll for** exists for the player who didn't make it. The chat card is marked
`(rolled by the GM)` so the log stays honest about who pressed the button.

Ending a session greys out the old announcement card, which then reads
**Downtime ended** and won't reopen anything.

---

## Attempting an activity on your own

Outside a session, a GM drives the whole thing from one window. This is the
original flow and it is unchanged.

Set **Roll with** if you want it rolled at Advantage or Disadvantage. Each
option names its dice, so `Advantage (2d20 keep highest)`, `Normal (1d20)` and
`Disadvantage (2d20 keep lowest)`. It applies to the next attempt only, then you
are back to Normal.

Press **Attempt** on a row. In order: the fee is taken, the die is rolled, the
DC ladder is updated, and a chat card is posted.

The card carries the activity and slot as its heading, the character with the
ability and modifier used, the total against the DC, a `SUCCESS` or `FAILURE`
verdict, and the line `Paid N gp (per attempt, win or lose)` when there was a
fee. A success prints the unlocked outcome text. A failure prints the DC the
next attempt will face.

Every card ends with the same footer:

> Luck tokens cannot be spent on downtime checks.

That's a rule, not a suggestion. The module offers no way around it, and the
line is on the card so nobody at the table has to remember it.

The result also appears in the window itself, with a **Dismiss** button and,
after a success, the follow-up buttons below.

### Failure walks the DC down

Every printed DC sits on one shared ladder:

`9 · 12 · 15 · 18 · 20`

**A failed attempt drops that slot one rung for the next try. A success puts it
straight back to the printed number.** The row shows the current DC with the
original in brackets, so a DC 18 slot failed twice reads `DC 12 (was 18)`.

Progress is tracked per character and per slot, not globally, and it survives a
reload. A DC 9 slot has nowhere to fall, so it never moves.

Once any slot has stepped down, a **Clear DC progress** button appears in the
header. It wipes the whole ladder for the selected character and nothing else.

### Setting the credit by hand

A GM also gets a **−** and **+** pair beside every row's DC. **Players never see
it.**

- **−** lowers the DC one rung, granting a step of credit.
- **+** raises it back, taking one away.

Both clamp to the same ladder the automatic walk uses, so a hand-set DC can never
end up off it. At the printed DC the **+** is dead. At the bottom rung the **−**
is. Either way the row keeps reading `DC 15 (was 18)`, so the credit is always
visible rather than hidden in a flag.

This exists because not every attempt happens in the tool. A character who tried
and failed in play, or during a session you ran from the book, should still walk
the ladder down. A ruling you want to take back should be reversible without
wiping that character's whole history with **Clear DC progress**.

### Renown and XP, on your own

Working solo, nothing is applied behind your back. Three slots pay out something
mechanical on a success, and a button appears on the result card so you decide.

| Slot | Button | Writes |
|---|---|---|
| Gain favor with church | **Apply** | `system.renown` **+1** |
| Spiritual strengthening | **Apply** | `system.level.xp` **+2** |
| Start a rumor | **+1** or **−1** | `system.renown`, on the character you pick |

A rumor cuts both ways, so instead of one Apply it offers the signed pair plus a
dropdown of party members, because a rumor a character starts is usually about
somebody else. The buttons disable after one use so the same result can't be
banked twice.

XP written here is the raw value only. It never touches `system.level.value`,
matching how [Party XP](Party-XP.md) behaves.

---

## What a success actually does

> **This is session behaviour.** Inside a session a success is *applied*, not
> just described. Working solo, outside a session, you still get the manual
> **Apply** buttons above.

Every outcome falls into one of three shapes.

**Applied on the spot.** Nothing to pick, so the result card just reports what
happened.

| Slot | What lands |
|---|---|
| Gain favor with church | +1 renown |
| Start a rumor | ±1 renown, on the character the picker names |
| Spiritual strengthening | +2 XP. At the threshold it also raises Shadowdark's own level-up prompt, so the sheet says `Level-up is ready` |
| Extortion: 25% price swing | A one-shot swing armed on that character. See below |
| ADV on next scroll check | An Active Effect named `Downtime Research: next scroll` |
| ADV on next three spells | The same, named `Downtime Research: next three spells`, carrying 3 uses |
| Create Potion of Healing | The potion, made. There is only one legal answer, so nothing is asked |

The two advantage buffs are real Active Effects, so the bonus genuinely applies.
Nothing decrements them. The summary says to delete the effect once it has been
used, and that stays a deliberate act.

**Applied after you choose.** The result card asks a question and the options
appear as buttons. An option you can't take is **greyed out with its reason on
hover** rather than hidden, so a player can see what they just missed.

| Slot | What it asks |
|---|---|
| +1 hit or damage | Which weapon, and which of the two |
| +1 hit and damage | Which weapon |
| Step up damage die | Which weapon. It edits the weapon itself, capped at d12, twice per weapon |
| New weapon (d6 max) / New weapon or armor step / New armor or weapon | What you trained with. Free text is allowed |
| Create scroll (tier ≤3) / Create wand (tier ≤3) | Which known spell to bind |
| Create a listed potion | Which potion was brewed |
| Trade a known spell | Which spell to give up, then its same-tier replacement, in one click |
| End one curse | Which curse, when the character carries one that is flagged as such |

Weapon training writes real attack and damage effects onto the chosen weapon and
records what it granted, so the book's limits hold. The same award can't land on
the same weapon twice. Training with something new creates a Talent called
`Training: <name>`, because Shadowdark has no proficiency field to set, and the
Talent says as much on its own description. A wand is refused while an unbroken
one of that spell is already carried.

**Left to the table.** Some outcomes have no mechanical shape in Shadowdark at
all. Lay low, hide out, both crimes, the talent reroll, and a cleansing on a
character with no flagged curse all print a note saying the GM adjudicates it.
Nothing is written and nothing is faked.

### The extortion swing, in the shop

A successful **Extortion: 25% price swing** arms one character. It is spent on
the **next** transaction that character makes in the
[Merchant Shop](Merchant-Shop.md), whichever comes first:

- a purchase costs **25% less**, or
- a sale earns **25% more**.

It is per character, not shop-wide, so one character's leverage never reprices
the shop for the party. Both the charged price and the transaction's chat card
name it, and it is only consumed once the transaction actually lands. A purchase
refused for want of funds leaves it armed.

---

## The downtime log

Every resolved attempt is written down twice, in two places that answer different
questions.

### In the Session Recap

The [Session Recap](Session-Recap.md) has a **Downtime** tab. Attempts are
grouped by the controlling player, newest first, each group carrying a subtotal
of how many landed and what it cost, reading `2/3 · 30 gp`. A row names the
character, the activity and slot, the check, the verdict and the fee, with the
applied effect underneath in italics. It exports with the rest of the recap under
a **Downtime** heading in the Discord markdown.

> **A paid attempt appears twice on purpose.** The fee still mirrors into
> **Purchases** as `Downtime: <slot label>`, because Purchases is the money
> ledger and feeds the party spend totals. The Downtime section is the narrative
> record of what was tried and what came of it. Drop either one and the other
> view goes wrong.

### In a journal that outlives the session

A world JournalEntry called **Downtime Log** collects the same attempts
permanently. It sits at the root of the Journal sidebar with no folder, and the
GM's client creates it the first time something is recorded.

Rows are grouped under a heading per real-world day, **newest day first, and
newest row first inside a day**, so the top of the page is always the last thing
that happened. Each row carries the time, the character, the activity and slot,
the check, the verdict, the fee, the book it came from, and a `GM` marker when
the GM rolled on someone's behalf.

The module finds the journal by an internal flag rather than by its name, so
renaming it is safe and a journal you happen to call "Downtime Log" yourself is
never adopted and appended to. **Deleting it is safe too.** The next recorded
attempt simply makes a fresh one. You lose the old rows, not the feature.

Two details worth knowing. Logging happens **after** the result is committed, so
a logging failure can never cost somebody a paid roll. And an attempt still owing
a choice is logged as it rolled, with no effect summary, rather than waiting on a
pick that might never come. It is not backfilled later.

---

## Where the data lives

| What | Where |
|---|---|
| Unlocked outcome text | The `downtimeContent` world setting, per source |
| The live session (book, phase, picks, results) | The `downtimeSession` world setting |
| DC ladder progress | `flags["shadowdark-enhancer"].downtime.steps` on the actor |
| The arcane / divine pick for a CHA caster | `flags["shadowdark-enhancer"].downtime.casterList` |
| A pending extortion swing | `flags["shadowdark-enhancer"].downtimeExtortion` on the actor |
| What a weapon has already been trained for | `flags["shadowdark-enhancer"].downtimeTraining` on the weapon |
| The permanent attempt log | A flagged **Downtime Log** JournalEntry at the Journal root |

The DC ladder flag is the one a GM writes by hand, through the **−** and **+**
stepper beside each row.

Nothing here is written to a compendium, and disabling the module leaves the
coins, renown, XP, items and effects it wrote exactly as they are.

---

## Troubleshooting

**"Downtime is a GM tool."**
The window is GM-only. It debits purses and writes to sheets, so it is not
something a player runs for themselves.

**"No player characters found."**
The character list is Player-type actors that have an owner. An NPC-type actor,
or a PC with no assigned player, won't be listed.

**"Your GM's Foundry tab needs a reload before downtime actions can land."**
Player actions are routed to the **active GM's** client, which does the real
work. A GM who has had a tab open since before the module was updated is running
the old code, and a player's pick would land in a client with no listener for it.
Nothing would throw. The button would simply do nothing.

So the module checks first. Before a player's action is sent, it pings the active
GM and compares module versions. A stale tab, or no GM online at all, and the
player is told rather than left guessing. **The fix is always the same: have the
GM reload their Foundry tab.** If a session ever seems to be ignoring the
players, try that before anything else.

**"There's no downtime session running right now."**
A player opened the window outside a session. Only a GM can open it cold. Start a
session and they get an **Open Downtime** button in chat.

**A player has no Roll it button.**
The GM hasn't pressed **Lock & unlock dice** yet. Until then a player who has
chosen sees `waiting for the GM to unlock the dice`.

**Somebody missed the session.**
Use **Roll for** on their row in the GM panel. The chat card is marked
`(rolled by the GM)` so the log stays honest.

**A choice button is greyed out.**
That option isn't legal for this character right now, and the reason is on hover.
The usual causes are a training award already applied to that weapon, a damage
die at d12 or already stepped twice, or a wand of that spell already carried.

**The window is just a card or two with a padlock on it.**
Nothing has been imported yet. That is the whole locked state, by design. Press
**Unlock via Importer** on the book you own.

**An activity I know is in the book isn't listed.**
Its line never matched during parsing. The count line at the foot of the window
says how many are missing. Go back to the Importer, parse the page again, and
read **Still unfilled:** and **Lines nothing claimed:** in the preview, which is
the one place those labels are shown.

**My downtime paste ended up in Skipped.**
**Importing** was left on **Auto-detect**, which does not recognise downtime
pages. Pick **Downtime** in the type selector and parse again.

**"Only a GM can unlock downtime outcomes."**
The hub's commit is GM-gated like every other one.

**Martial Training lists every tier at once and won't roll.**
The class hit die couldn't be read off the actor, and the module refuses to
guess a tier. Check that the character actually has a Class item.

**Magical Research isn't there.**
The system doesn't consider that character a spellcaster. If they should be, the
class import is the thing to look at, not this window. See
[Class & Spell Importers](Class-and-Spell-Importers.md).

**A warning says the text names the wrong authority.**
Cursed Scroll 6 says City Guard where the Western Reaches says authorities. You
almost certainly have the right paste under the wrong **Book**.

**The paste only matched some of the slots.**
Two-column PDF copies interleave. The parser has a rescue pass for exactly that
and usually recovers everything, but a badly shredded copy can defeat it. Paste
the whole run of pages again in one go rather than a block at a time, because a
second unlock **replaces** that book's stored text rather than topping it up.

**A character paid and then failed.**
Working as intended. The fee is per attempt, win or lose, and it comes out
before the roll.

**A DC is lower than the book prints.**
That character has failed there before. The row shows the original in brackets.
**Clear DC progress** resets it.

---

**Related:** [Importer Hub](Importer-Hub.md) ·
[Merchant Shop](Merchant-Shop.md) ·
[Session Recap](Session-Recap.md) ·
[Party XP](Party-XP.md) ·
[Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md)
