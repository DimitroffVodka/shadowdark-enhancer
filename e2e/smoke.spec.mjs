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

async function join(page, user) {
  const errors = watchErrors(page);
  await loginAs(page, user);
  await disableTour(page);
  await page.waitForFunction(() => globalThis.game?.ready === true);
  return errors;
}

test("a GM's fresh world starts clean", async ({ page }) => {
  const errors = await join(page, "Gamemaster");
  const mod = await page.evaluate((id) => ({ active: game.modules.get(id)?.active, api: typeof game.shadowdarkEnhancer }), MODULE);
  expect(mod).toEqual({ active: true, api: "object" });
  expect(errors).toEqual([]);
});

// Openers with nothing to show in an empty world, and why. They are still called and must not throw or log an error,
// but they are not counted as opened. Any opener NOT listed here must put a drawn window on screen, so a new one
// cannot pass by doing nothing; one listed here that does open a window fails too, so the list cannot go stale.
const NEEDS_SETUP = {
  "bastion.open": "opens one bastion's sheet, and there is no bastion",
  "encounter.openCodex": "opens the Encounters Met journal, which exists once an encounter has been logged",
  "encounterMaps.open": "stages a battle for an encounter, and none is passed",
  "renown.open": "the award dialog lists player characters, and there are none",
};

// Where the window alone is not the proof: this must be on screen as well before the opener counts as opened.
const ALSO_DRAWS = {
  "monsterCreator.open": "#sde-monster-creator-host > *", // the creator mounts into the Encounter window after it draws
};

const WINDOW_WAIT_MS = 15_000;

test("every window the API can open, opens", async ({ page }) => {
  test.setTimeout(600_000); // some thirty openers; one that shows nothing costs the full wait
  const errors = await join(page, "Gamemaster");
  const result = await page.evaluate(async ({ needsSetup, alsoDraws, limit }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, ms) => {
      for (const end = performance.now() + ms; performance.now() < end; await wait(100)) if (test()) return true;
      return Boolean(test());
    };
    // A window is a framed ApplicationV2 or an ApplicationV1 pop-out; core's sidebar, hotbar and the like have no frame.
    const windows = () => [...foundry.applications.instances.values()].filter((a) => a.hasFrame).concat(Object.values(ui.windows));
    const drawn = (a) => a.rendered && document.body.contains(a.element instanceof HTMLElement ? a.element : a.element?.[0]);
    const closeAll = async () => {
      for (const app of windows()) Promise.resolve(app.close({ force: true })).catch(() => {});
      return until(() => windows().length === 0, limit);
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
    const failed = Object.keys(needsSetup).filter((n) => !calls.some(([name]) => name === n)).map((n) => `${n}: listed in NEEDS_SETUP but not in the API`);
    if (!(await closeAll())) failed.push("start: a window would not close");

    for (const [name, fn, owner] of calls) {
      const stale = new Set(windows());
      const call = { done: false, threw: null };
      // Not awaited: a dialog's promise settles only when the dialog closes.
      Promise.resolve().then(() => fn.call(owner)).then(() => { call.done = true; }, (err) => { call.threw = err?.message ?? String(err); });
      const shown = () => windows().some((a) => !stale.has(a) && drawn(a)) && (!alsoDraws[name] || document.querySelector(alsoDraws[name]) !== null);

      if (name in needsSetup) {
        await until(() => call.done || call.threw, 3000);
        if (shown()) failed.push(`${name}: opened a window, so take it off NEEDS_SETUP`);
        else skipped.push(name);
      } else if (await until(() => call.threw || shown(), limit) && !call.threw) opened.push(name);
      else if (!call.threw) failed.push(`${name}: no drawn window within ${limit / 1000} s`);
      if (call.threw) failed.push(`${name}: threw ${call.threw}`);

      // Leave a bare table, so the next opener's window is its own and a modal cannot block it.
      if (!(await closeAll())) failed.push(`${name}: its window would not close`);
    }
    return { opened, skipped, failed };
  }, { needsSetup: NEEDS_SETUP, alsoDraws: ALSO_DRAWS, limit: WINDOW_WAIT_MS });
  // Soft, so one run reports the windows that failed and the errors they logged together.
  expect.soft(result.failed).toEqual([]);
  expect.soft(result.skipped.sort()).toEqual(Object.keys(NEEDS_SETUP).sort());
  expect.soft(result.opened.length).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("a player's client starts clean", async ({ page, browser }) => {
  test.setTimeout(180_000); // two joins: measured at 44 to 75 s, too close to the 90 s default
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
