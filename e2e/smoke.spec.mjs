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

test("every window the API can open, opens", async ({ page }) => {
  test.setTimeout(300_000); // some thirty windows at a few seconds each in a headless browser
  const errors = await join(page, "Gamemaster");
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const base = new Set(foundry.applications.instances.keys());
    const opened = [];
    const failed = [];
    // Close what a call left open, so the next call starts from a bare table and a modal can't block it.
    const closeNew = async () => {
      for (const [id, app] of foundry.applications.instances) if (!base.has(id)) await app.close({ force: true }).catch(() => {});
      for (const app of Object.values(ui.windows)) await app.close({ force: true }).catch(() => {});
    };
    await closeNew();
    const api = game.shadowdarkEnhancer;
    const calls = [];
    for (const [key, value] of Object.entries(api)) {
      if (typeof value === "function" && key.startsWith("open")) calls.push([key, value, api]);
      else if (value && typeof value === "object") {
        for (const [k, fn] of Object.entries(value)) if (typeof fn === "function" && k.startsWith("open")) calls.push([`${key}.${k}`, fn, value]);
      }
    }
    for (const [name, fn, owner] of calls) {
      try {
        // A dialog's promise settles only when it closes: three seconds is long enough for a window to draw.
        await Promise.race([fn.call(owner), wait(3000)]);
        await wait(100);
        opened.push(name);
      } catch (err) {
        failed.push(`${name}: ${err?.message ?? err}`);
      }
      await Promise.race([closeNew(), wait(3000)]);
    }
    return { opened, failed };
  });
  expect(result.failed).toEqual([]);
  expect(result.opened.length).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("a player's client starts clean", async ({ page, browser }) => {
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
