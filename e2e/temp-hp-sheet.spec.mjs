// Browser-level test, run in a throwaway Foundry by foundry-mcp-live's ui_test
// (or: node <foundry-mcp-live>/tools/ui-test/run.mjs --module .). Not part of npm test.
import { test, expect } from "@foundry-mcp-live/ui-test";

test("Temp HP field: one per Player sheet, saves to the actor, survives re-render and tab switches", async ({ page, foundry }) => {
  const name = `Temp HP ${Date.now()}`;
  await foundry.state.createTestActor(name);
  await page.evaluate((n) => game.actors.getName(n).sheet.render(true), name);

  const sheet = page.locator(".window-app").filter({ has: page.locator('input[name="system.attributes.hp.value"]') });
  const field = sheet.locator(".sde-temp-hp input");
  await expect(field).toHaveCount(1);

  await field.fill("5");
  await field.press("Tab");
  await expect.poll(() => page.evaluate((n) => game.actors.getName(n).flags["shadowdark-enhancer"]?.tempHp?.value, name)).toBe(5);

  // The flag update re-renders the sheet; the injection must rebuild one field from the pool, not stack a second.
  await expect(field).toHaveCount(1);
  await expect(field).toHaveValue("5");

  await sheet.locator('.navigation-tab[data-tab="tab-inventory"]').click();
  await expect(field).toBeHidden();
  await sheet.locator('.navigation-tab[data-tab="tab-abilities"]').click();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("5");
});
