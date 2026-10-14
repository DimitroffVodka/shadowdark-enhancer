# Carousing

[← Wiki home](index.md) · [Party](Party.md)

Open the Carousing tab of the Party, even without a token/map or Shadowdark Extras.
A Party owner starts/resumes. The Party owner picks one tier for the whole party. Each PC owner confirms only their own participation.
The tier cost is a group total split between the joining characters in whole gp (the remainder goes one gp at a time to the first in list order). Each pays their share from personal coins: no Party purse subsidy and
no covering another character's shortfall.

## Configure before spending

The GM's setup asks two things, both under "GM setup":

- **Carousing rules**: Core Rulebook, Western Reaches or Cursed Scroll #6, listing only the books whose carousing tables
  you imported. With one book imported nothing is asked. Nothing picked means the first imported book.
- **Settlement** (optional): the list reads "Village, up to 300 gp", "City-state, no limit" or "limit not set", from the
  carousing limits in Rules Data. A tier above the chosen settlement's limit is greyed out in the tier list. A settlement
  name or holiday place can be typed beside it.

Missing tables are reported before any charge; the module never invents missing results
or ships sourcebook prose. Settlement limits, active downtime exclusion and each PC's
14-day wait between outings apply without a map. The wait is 14 days of the game calendar, so moving the calendar
ahead ends it. Anyone joining who is inside it is named in the tab with a warning, and the GM has an "Allow it for this
outing" switch beside the warning; without it Start refuses.

The whole outing is preflighted: chosen participants, every share affordable,
and tables resolving. One shortfall refuses the outing before charging anyone.
Declining or canceling during setup costs nothing. First commitment freezes
inputs, charges once, and saves actual rolls/outcomes.

## Basic and expanded rules

The **Carousing rules** you pick decide the rules.

Core is basic carousing: one d8 roll plus the tier bonus reads one result line.

Western Reaches and Cursed Scroll #6 are expanded carousing. Their rows are a matrix of Mishaps, Benefits,
% modifier and XP, and the Event, Benefit and Mishap tables of the same book go with them. For each character the tab:

1. rolls d8 plus the tier bonus, the holiday event bonus and the renown bonus, and reads the matrix row;
2. rolls one d100 for every benefit and every mishap the row lists, adds the row's % modifier (the result stays between
   1 and 100) and reads the Benefit or Mishap table; each line in the tab shows it, for example "d100: 6 - 20 = 1";
3. follows a row that says to re-roll it as a mishap (or as a benefit) by rolling on the other table, up to four times;
4. awards the row's XP and any positive XP, Luck or signed renown the rolled texts state in the same plain wording
   basic carousing automates. Losses, gear, debt and every other effect stay in the saved result for the GM.

A holiday adds its extra benefit and extra mishap rolls, advantage on benefit rolls and its benefit bonus; its chance
events stay with the GM. The Benefit and Mishap tables must cover 1 to 100, or the outing is refused before anyone pays.

A world that already saved tables of its own keeps them, shown as "Your own tables". The API's `configure` still takes
RollTable UUIDs.

## Results, Resume and history

Concrete supported unconditional XP/Luck gains and renown deltas use the real
award helpers. Narrative/custom results, losses/negated effects and non-coin
wealth stay visible GM actions, not pretend automation. Saved recipient progress
protects each applied effect; reopening shows the same results. Resume completes
only outstanding effects/reporting and never rerolls, recharges or reawards.
Chat/notification failure cannot turn a successful award into another payment.

Party history is independent of Session Recap; a stable log identity adds one
recap row per outing. Explicitly imported legacy Extras logs are history-only,
never new unpaid outings or back-pay. The native feed does not watch Extras'
hidden session journal. Party UUID and legacy history remain intact.

With both modules active the native Carousing is the one that runs: Extras
switches its own Carousing off while the Enhancer is present, and the Enhancer
never toggles Extras settings. Carousing here will not begin, and a night still
being set up will not start, while a carouse is under way in Extras, so the same
characters are never charged in both; finish or reset the Extras carouse first.
Map authoring/unrelated Extras features remain available. See [Hex Maps](Hex-Maps.md#standing-on-its-own-optional-extras-seams).
