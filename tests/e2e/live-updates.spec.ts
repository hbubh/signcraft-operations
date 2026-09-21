import { test, expect, type Page } from "@playwright/test";

async function observe(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  const events: string[] = [];
  session.on("Network.eventSourceMessageReceived", (event) => {
    events.push(event.eventName);
  });
  return events;
}

test("Manager and Vendor SSE connections rotate and reconnect without database polling", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(100000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  try {
    const sessions = await Promise.all(
      contexts.map(async (context, index) => {
        const page = await context.newPage();
        const events = await observe(page);
        await page.goto("/login");
        await page
          .getByLabel("Email address")
          .fill(`${index === 0 ? "manager" : "vendor1"}@signcraft.demo`);
        await page.getByLabel("Password").fill("SignCraft!2026");
        await page
          .getByRole("button", { name: "Sign in to workspace" })
          .click();
        await expect(page).toHaveURL("/");
        await expect
          .poll(() => events.filter((event) => event === "ready").length)
          .toBe(1);
        await expect(page.locator(".loading-list")).toHaveCount(0);
        return { page, events };
      }),
    );
    // Let initial query invalidations settle, then observe a quiet interval.
    await sessions[0].page.waitForTimeout(2000);
    const reads: string[] = [];
    for (const { page } of sessions) {
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (
          request.method() === "GET" &&
          /^\/api\/(orders|install-jobs|vendors|me)(\/|$)/.test(path)
        )
          reads.push(path);
      });
    }
    await sessions[0].page.waitForTimeout(20000);
    expect(reads).toEqual([]);
    for (const { page, events } of sessions) {
      await expect
        .poll(() => events.filter((event) => event === "ready").length, {
          timeout: 65000,
        })
        .toBeGreaterThanOrEqual(2);
      await expect(
        page.getByText("Live updates", { exact: true }),
      ).toBeVisible();
      expect(events.filter((event) => event === "unavailable")).toEqual([]);
    }
    expect(reads.length).toBeGreaterThan(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
