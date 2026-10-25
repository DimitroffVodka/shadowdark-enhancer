# Camping

[← Wiki home](index.md) · [Party](Party.md)

Open Camp from the native Party or Overland. A Party owner starts/resumes;
every PC takes part, and each PC owner chooses at most one optional task.
Hirelings and mounts have no PC task slots; listed mounts still need food.

The GM also gets **Show camp picture** (see [Camp picture](#camp-picture)), which
covers the map for everyone with a picture of the camp.

## Setup and fire

Tasks are Bed Down, Cook, Craft, Entertain, Firewood, Hunt, Keep Watch and
Predict. Several PCs may choose the same task. Default DC is 12; the GM can
adjust it. Each task's description is always shown. Craft output/repair,
Entertain recipient and Keep Watch half are chosen before rolling. First roll
locks choices; Cancel before that spends nothing. A new camp starts from last
night's choices (fire source, each PC's task, ability, craft output, watch half
and Entertain recipient); anything that no longer fits is left blank, and a
repair that was done falls back to a torch.

Firewood resolves first. Success gives fire without torches. Failure offers
explicit torch fallback: three torches, the Party's own stacks first, then the
PC holding the most, so one pack empties before another is touched. No one is
asked to consent. Choosing Existing torches as the fire source spends them when
choices lock. Insufficient fuel never partly charges. Declining means no fire,
not a blocked camp. Bed Down, Cook, Craft,
Entertain and Keep Watch then roll at disadvantage; Firewood/Hunt/Predict do not.
Fire gives near light for eight hours while a PC remains nearby; it is owned
and expires without touching other lights. Persistent results survive reload.
Every task roll posts its own chat card with the DC and result; a success also
says what it did (a hot meal, a torch crafted, who gains a luck token, which
watch is kept), and Hunt and Craft cards add the yield found.

## Daily food and eligible rest

Normal conditions require one ration per PC/mount/day. Imported harsh-climate
conditions can require two per PC and non-grazing mount. Own inventory is used
first, then the Party's rations are used automatically for any shortfall; never
another PC's food or a stale preview.
Hunt and existing daily foraging remain separate, with personal food rewards.

Actor/day records prevent another meal charge, starvation hit or rest when
reopened or used by another Party. An unfed actor takes full-score CON damage
once/day and receives no successful-rest recovery; food does not heal that
starvation during the same rest. Persistent shortage warnings allow an explicit
hungry night. Fed PCs rest individually; interrupted rest uses saved CON checks.
Mount full-score nutrition/death/check behavior is in [Mounts & Boats](Mounts-and-Boats.md).

With [Grinder](Modes-of-Play.md#grinder) on, an eligible rest rolls hit dice for
HP, brings back 1d4 lost spells (the player picks which when more are lost) and
heals 1 point of each damaged ability, instead of filling HP, returning every spell and clearing the
damage. The choice is made when the rest begins and is kept with it.

Cook applies only after an eligible full rest: the meal gives two [temporary hit
points](Dying-and-Death-Timers.md#temporary-hit-points) for one world day. HP and its
maximum are untouched (3/3 HP with 2 temp HP). Damage spends the temp HP first and
healing does not recreate spent ones. After one world day any that are left expire.
Temp HP do not stack, so a character who already has more keeps them. Resume/reload
does not grant another meal.

## Automatic camps

When the party travels with **Auto** on (see [Overland travel](Crawl-Strip-and-Crawl-Bar.md#automatic-travel-one-click-to-a-far-destination)),
each evening's camp runs by itself with the last camp's tasks, stats and fire
choice, and the night starts at once. The camp window opens only when a choice
is needed: rations short, too few torches for the fire, a Repair item that is
gone, Hunt in a storm on harsh ground (impossible by the rules, so Hunt is
greyed out and the camp says why), or an Entertain with nobody left who can
gain luck. A character added to the party while a camp is being set up joins
it; one removed drops out. **Camp choices** in the Travel panel opens the
window to change the saved tasks ahead of time.

## Resume and Overland

Reopen shows saved choices/results and Resume/Review. After commitment there is
no automatic refund. Resume completes outstanding tasks/effects/food/rest only;
a missing summary is retried without repeating rewards or time. Overland owns
night time, weather and encounters; the task executor does not advance the
clock independently. Already-pending Extras camps retain their original executor.

Native Parties use the native executor even when Extras is installed. An
already-pending Extras camp retains its saved provider path; it is not
rerouted into native tasks or rest. This is executor selection, not a global
Extras camping-disable setting or a claimed external ownership guard.
Enhancer does not change Extras settings. See [Hex Maps](Hex-Maps.md).

## Camp picture

**Show camp picture** (GM only, in the Camping window and in the Party sheet's
copy of it) covers the map for every player with a full-screen picture of the
camp: the camp version of the battle map for the party's terrain (Forest woods
when the terrain is unknown, water, or has no camp picture of its own). While it
is up, selected tokens are released so the arrow keys do not move tokens on the
hidden map. A reload or a late joiner sees it too.

A camp never raises it by itself. The button then reads **Hide camp picture**
and takes it down. It also goes when:

- the camp it was raised for ends or is cancelled (a picture raised with no camp
  running stays until you hide it, unless a camp for that party begins while it is up), or
- you [bring the table](Encounter-Battle-Maps.md#bring-the-table) to a battle map.
