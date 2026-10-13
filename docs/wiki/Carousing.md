# Carousing

[← Wiki home](index.md) · [Party](Party.md)

Open the Carousing tab of the Party, even without a token/map or Shadowdark Extras.
A Party owner starts/resumes. The Party owner picks one tier for the whole party. Each PC owner confirms only their own participation.
The tier cost is a group total split between the joining characters in whole gp (the remainder goes one gp at a time to the first in list order). Each pays their share from personal coins: no Party purse subsidy and
no covering another character's shortfall.

## Configure before spending

The GM selects imported Core or custom world event/outcome tables. Missing
tables are reported before any charge; the module never invents missing results
or ships sourcebook prose. A manual settlement is allowed; settlement limits,
active downtime exclusion and each PC's
14-real-day cooldown apply without a map.

The whole outing is preflighted: chosen participants, every share affordable,
and tables resolving. One shortfall refuses the outing before charging anyone.
Declining or canceling during setup costs nothing. First commitment freezes
inputs, charges once, and saves actual rolls/outcomes.

## Basic and expanded rules

The **Outcomes** table you pick decides the rules.

A Core outcome table is basic carousing: one d8 roll plus the tier bonus reads one result line.

A Western Reaches or Cursed Scroll #6 outcome table is expanded carousing. Its rows are a matrix of Mishaps, Benefits,
% modifier and XP. Pick that outcome table and the Event, Benefit and Mishap tables of the same book follow it; each of
the four dropdowns can still be set by hand. For each character the tab:

1. rolls d8 plus the tier bonus, the holiday event bonus and the renown bonus, and reads the matrix row;
2. rolls one d100 for every benefit and every mishap the row lists, adds the row's % modifier (the result stays between
   1 and 100) and reads the Benefit or Mishap table;
3. follows a row that says to re-roll it as a mishap (or as a benefit) by rolling on the other table, up to four times;
4. awards the row's XP and any positive XP, Luck or signed renown the rolled texts state in the same plain wording
   basic carousing automates. Losses, gear, debt and every other effect stay in the saved result for the GM.

A holiday adds its extra benefit and extra mishap rolls, advantage on benefit rolls and its benefit bonus; its chance
events stay with the GM. The Benefit and Mishap tables must cover 1 to 100, or the outing is refused before anyone pays.

The table dropdowns list every RollTable whose name has "carousing" in it first.

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
