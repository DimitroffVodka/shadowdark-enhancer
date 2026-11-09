// Release smoke check: a fresh world with only this module on must start clean for a GM and for a player, and every
// window the module's API can open must open. Run in a throwaway Foundry by foundry-mcp-live's ui_test
// (or: node <foundry-mcp-live>/tools/ui-test/run.mjs --module .). Not part of npm test: hosted CI has no Foundry licence.
import { test, expect, loginAs, disableTour } from "@foundry-mcp-live/ui-test";

const MODULE = "shadowdark-enhancer";
const PLAYER = "Smoke Player";

// Join by hand: the harness's own login runs before a test can listen, and the errors that matter happen at load.
test.use({ user: null });

/** Every uncaught error, console error and failed request the page produces from now on. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => {
    const stack = e.stack ?? e.message;
    // No http frame means a script the test harness injected (its tour suppressor throws before <head> exists), not Foundry's.
    if (stack.includes("http")) errors.push(`uncaught: ${stack.split("\n").slice(0, 4).join(" | ")}`);
  });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} (${m.location().url})`); });
  return errors;
}

const ready = (page) => page.waitForFunction(() => globalThis.game?.ready === true);

async function join(page, user) {
  const errors = watchErrors(page);
  await loginAs(page, user);
  await disableTour(page);
  await ready(page);
  return errors;
}

// The module's start-up goes on after ready. 2.5 s later it shows what's new (to a browser that has not seen this
// version, in a world the module has run in before), reads the import library, then asks the GM of a world that has
// imported nothing to run the wizard, once per version, stamping the version just before it asks. On the first GM
// page of a fresh world, that stamp and the prompt after it are the end of start-up, and waiting for them keeps the
// test below from ending while start-up is still running. On any later page the stamp is already there and this
// returns at once: such a page's start-up is NOT waited for, and its dialogs can arrive at any time. That is why the
// window test never credits a window to an opener for arriving: it has to be that opener's own window.
async function firstStartUpOver(page) {
  const asked = (id) => game.settings.get(id, "importerWizardAsked") === game.modules.get(id).version;
  const earlier = await page.evaluate(asked, MODULE);
  await page.waitForFunction(asked, MODULE, { timeout: 60_000 });
  if (!earlier) await page.waitForFunction(() => [...foundry.applications.instances.values()].some((a) => a.hasFrame && a.rendered));
}

test("a GM's fresh world starts clean", async ({ page }) => {
  const errors = await join(page, "Gamemaster");
  await firstStartUpOver(page);
  const mod = await page.evaluate((id) => ({ active: game.modules.get(id)?.active, api: typeof game.shadowdarkEnhancer }), MODULE);
  expect(mod).toEqual({ active: true, api: "object" });
  expect(errors).toEqual([]);
});

// Every `open…` function on game.shadowdarkEnhancer is in one of the two lists below; one in neither fails the test.
//
// OPENS: the window the opener must put on screen, by the application's class, with an optional selector that must be
// inside it. Only a NEW, drawn window of that class counts. Any other window that turns up meanwhile (what's new, the
// first-import prompt, another feature's window) is never credited to the opener.
const OPENS = {
  "charBuilder.open": "ShadowdarkCharBuilder",
  "bastion.openPanel": "BastionPanel",
  "encounter.openRoller": "EncounterRollerApp",
  // The creator mounts into the Encounter window after that window draws, and the opener does not await the mount.
  "monsterCreator.open": "EncounterRollerApp #sde-monster-creator-host > *",
  "tokenArt.openManager": "TokenArtManagerApp",
  // A plain dialog, the same class as the start-up prompts: told apart by its own checkbox.
  "tokenArt.open": "DialogV2 input[name='portraits']",
  "monsters.openImporter": "ImporterHubApp",
  "loot.open": "LootGeneratorApp",
  "loot.openSetup": "LootSetupApp",
  "forgeLoot.open": "ForgeLootApp",
  "forge.open": "MagicForgeApp",
  "partyXp.open": "PartyXpApp",
  "party.open": "PartyApp",
  "camping.open": "PartyApp",
  "carousing.open": "PartyApp",
  "tables.openImporter": "ImportWizardApp",
  "tables.openWizard": "ImportWizardApp",
  "tables.openHub": "ImporterHubApp",
  "tables.openClassImporter": "ClassImporterApp",
  "tables.openSpellImporter": "SpellImporterApp",
  "merchant.open": "MerchantShopApp",
  "merchant.openLocally": "MerchantShopApp",
  "recap.open": "SessionRecapApp",
  "downtime.open": "DowntimeApp",
  "pitFighting.open": "PitFightingApp",
  "training.open": "TrainingApp",
  "hexMaps.openTagger": "HexTaggerApp",
  "quests.open": "QuestLogApp",
};

// NEEDS_SETUP: openers with nothing to show in an empty world, and why. They are still called and must not throw or
// log an error, but they are not counted as opened. One that does open a window fails, so the list cannot go stale.
// A plain DialogV2 is not held against them: the start-up prompts are plain dialogs and can arrive during any call.
const NEEDS_SETUP = {
  "bastion.open": "opens one bastion's sheet, and there is no bastion",
  "encounter.openCodex": "opens the Encounters Met journal, which exists once an encounter has been logged",
  "encounterMaps.open": "stages a battle for an encounter, and none is passed",
  "renown.open": "the award dialog lists player characters, and there are none",
};

const WINDOW_WAIT_MS = 15_000;

/** Calls the openers (all of them, or just `only`) and reports which put their own window on screen. */
function callOpeners(page, only = null) {
  return page.evaluate(async ({ opens, needsSetup, limit, only }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, ms) => {
      for (const end = performance.now() + ms; performance.now() < end; await wait(100)) if (test()) return true;
      return Boolean(test());
    };
    // A window is a framed ApplicationV2 or an ApplicationV1 pop-out; core's sidebar, hotbar and the like have no frame.
    const windows = () => [...foundry.applications.instances.values()].filter((a) => a.hasFrame).concat(Object.values(ui.windows));
    const root = (a) => (a.element instanceof HTMLElement ? a.element : a.element?.[0]);
    const drawn = (a) => a.rendered && document.body.contains(root(a));
    const label = (a) => `${a.constructor.name} "${a.title ?? ""}"`;
    // Resolves to "" once no window is left, else to the names of the ones still up. Each window is asked once, and
    // one that shows up while the others are closing is asked too.
    const closeAll = async () => {
      const asked = new Set();
      await until(() => {
        for (const app of windows()) {
          if (asked.has(app)) continue;
          asked.add(app);
          Promise.resolve().then(() => app.close({ force: true })).catch(() => {});
        }
        return windows().length === 0;
      }, limit);
      return windows().map(label).join(", ");
    };

    const calls = [];
    for (const [key, value] of Object.entries(game.shadowdarkEnhancer)) {
      if (typeof value === "function" && key.startsWith("open")) calls.push([key, value, game.shadowdarkEnhancer]);
      else if (value && typeof value === "object") {
        for (const [k, fn] of Object.entries(value)) if (typeof fn === "function" && k.startsWith("open")) calls.push([`${key}.${k}`, fn, value]);
      }
    }
    const opened = [];
    const skipped = [];
    const failed = [...Object.keys(opens), ...Object.keys(needsSetup)]
      .filter((n) => !calls.some(([name]) => name === n))
      .map((n) => `${n}: listed in the spec but not in the API`);
    const atStart = await closeAll();
    if (atStart) failed.push(`start: would not close: ${atStart}`);

    for (const [name, fn, owner] of calls) {
      if (only && !only.includes(name)) continue;
      if (!(name in opens) && !(name in needsSetup)) {
        failed.push(`${name}: not listed. Add it to OPENS with the window it opens, or to NEEDS_SETUP with the reason`);
        continue;
      }
      const stale = new Set(windows());
      const fresh = () => windows().filter((a) => !stale.has(a) && drawn(a));
      const call = { done: false, threw: null };
      // Not awaited: a dialog's promise settles only when the dialog closes.
      Promise.resolve().then(() => fn.call(owner)).then(() => { call.done = true; }, (err) => { call.threw = err?.message ?? String(err); });

      if (name in opens) {
        const [type, ...rest] = opens[name].split(" ");
        const selector = rest.join(" ");
        const saw = new Set();
        const own = () => fresh().some((a) => {
          saw.add(label(a));
          return a.constructor.name === type && (!selector || root(a).querySelector(selector) !== null);
        });
        if (await until(() => call.threw || own(), limit) && !call.threw) opened.push(name);
        else if (!call.threw) failed.push(`${name}: no ${opens[name]} window within ${limit / 1000} s (saw: ${[...saw].join(", ") || "nothing"})`);
      } else {
        await until(() => call.done || call.threw, 3000);
        const theirs = fresh().filter((a) => a.constructor.name !== "DialogV2").map(label);
        if (theirs.length) failed.push(`${name}: opened ${theirs.join(", ")}, so move it from NEEDS_SETUP to OPENS`);
        else skipped.push(name);
      }
      if (call.threw) failed.push(`${name}: threw ${call.threw}`);

      // Leave a bare table, so the next opener's window is its own and a modal cannot block it.
      const left = await closeAll();
      if (left) failed.push(`${name}: would not close: ${left}`);
    }
    return { opened, skipped, failed };
  }, { opens: OPENS, needsSetup: NEEDS_SETUP, limit: WINDOW_WAIT_MS, only });
}

test("every window the API can open, opens", async ({ page }) => {
  test.setTimeout(600_000); // some thirty openers; one that shows nothing costs the full wait
  const errors = await join(page, "Gamemaster");
  const result = await callOpeners(page);
  // Soft, so one run reports the windows that failed and the errors they logged together.
  expect.soft(result.failed).toEqual([]);
  expect.soft(result.skipped.sort()).toEqual(Object.keys(NEEDS_SETUP).sort());
  expect.soft(result.opened.sort()).toEqual(Object.keys(OPENS).sort());
  expect(errors).toEqual([]);
});

// The check on the check. A start-up dialog that arrives while a dead opener is being waited for must not pass for
// that opener's window: PR 577's review got a green run exactly that way.
test("a dead opener is not excused by a start-up dialog", async ({ page }) => {
  test.setTimeout(180_000);
  await join(page, "Gamemaster");
  // What's new shows to a browser that has not seen this version, in a world the module has run in before. The join
  // above makes this such a world; forgetting the version makes this such a browser; and holding the changelog back
  // lands the dialog in the middle of the wait.
  await page.waitForFunction((id) => Boolean(game.settings.get(id, "backfillVersion")), MODULE);
  await page.evaluate((id) => game.settings.set(id, "whatsNewSeen", ""), MODULE);
  await page.route("**/CHANGELOG.md", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });
  await page.reload();
  await ready(page);
  await disableTour(page);
  await page.evaluate(() => { game.shadowdarkEnhancer.charBuilder.open = () => undefined; });

  const result = await callOpeners(page, ["charBuilder.open"]);
  expect(result.opened).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).toMatch(/^charBuilder\.open: no ShadowdarkCharBuilder window within 15 s/);
  expect(result.failed[0], "no dialog arrived during the wait, so this run proved nothing about one that does").toMatch(/saw: .*DialogV2/);
});

test("a player's client starts clean", async ({ page, browser }) => {
  test.setTimeout(180_000); // two joins: measured at 35 to 75 s, too close to the 90 s default
  await join(page, "Gamemaster");
  await page.evaluate(async (name) => { if (!game.users.getName(name)) await User.create({ name, role: CONST.USER_ROLES.PLAYER }); }, PLAYER);

  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    const errors = await join(player, PLAYER);
    expect(await player.evaluate(() => game.user.isGM)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await page.evaluate((name) => game.users.getName(name)?.delete(), PLAYER);
  }
});
