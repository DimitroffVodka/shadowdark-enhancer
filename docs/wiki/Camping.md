# Camping

[← Wiki home](index.md) · [Party](Party.md)

Open Camp from the native Party or Overland. A Party owner starts/resumes;
each PC owner chooses their own participation and at most one optional task.
Hirelings and mounts have no PC task slots; listed mounts still need food.

## Setup and fire

Tasks are Bed Down, Cook, Craft, Entertain, Firewood, Hunt, Keep Watch and
Predict. Several PCs may choose the same task. Default DC is 12; the GM can
adjust it. Task descriptions are available on hover/focus. Craft output/repair,
Entertain recipient and Keep Watch half are chosen before rolling. First roll
locks choices; Cancel before that spends nothing.

Firewood resolves first. Success gives fire without torches. Failure offers
explicit torch fallback: three torches, shared Party stacks first, then only
consenting PC contributors in saved order. Insufficient fuel never partly
charges. Declining means no fire, not a blocked camp. Bed Down, Cook, Craft,
Entertain and Keep Watch then roll at disadvantage; Firewood/Hunt/Predict do not.
Fire gives near light for eight hours while a PC remains nearby; it is owned
and expires without touching other lights. Persistent results survive reload.

## Daily food and eligible rest

Normal conditions require one ration per PC/mount/day. Imported harsh-climate
conditions can require two per PC and non-grazing mount. Own inventory is used
first. **Use Party rations** is explicit per PC/per camp, and per mount; only
the actual current shortfall is taken, never another PC's food or a stale preview.
Hunt and existing daily foraging remain separate, with personal food rewards.

Actor/day records prevent another meal charge, starvation hit or rest when
reopened or used by another Party. An unfed actor takes full-score CON damage
once/day and receives no successful-rest recovery; food does not heal that
starvation during the same rest. Persistent shortage warnings allow an explicit
hungry night. Fed PCs rest individually; interrupted rest uses saved CON checks.
Mount full-score nutrition/death/check behavior is in [Mounts & Boats](Mounts-and-Boats.md).

Cook applies only after eligible full rest: 3/3 HP becomes 5/3, maximum unchanged.
Damage spends surplus first (5/3 → 4/3); healing does not recreate spent bonus.
After one world day only remaining over-max surplus expires, never subtracting
another two from an injured PC. Resume/reload does not grant another bonus.

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
