import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, account: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(`${account}@signcraft.demo`);
  await page.getByLabel("Password").fill("SignCraft!2026");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL("/");
}
test("complete manager/vendor/installer workflow and responsive layout", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "manager");
  await expect(
    page.getByRole("heading", { name: "Your operations, at a glance." }),
  ).toBeVisible();
  await expect(page.locator(".loading-list")).toHaveCount(0);
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  const title = `Browser workflow ${Date.now()}`;
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  await page.getByLabel("Order title").fill(title);
  await page.getByLabel("Business name").fill("Browser Test Studio");
  await page.getByLabel("Contact name").fill("Test Person");
  await page.getByLabel("Contact email").fill("browser@example.com");
  await page
    .getByLabel("Signage description")
    .fill("A complete browser-tested storefront sign.");
  await page
    .getByLabel("Installation address")
    .fill("100 Test Street, Portland");
  await page.getByLabel("Job value (USD cents)").fill("175000");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByLabel("Choose production asset").setInputFiles({
    name: "browser-artwork.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 simulated artwork"),
  });
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByText("Simulation complete. No file bytes were stored.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close order details" }).click();
  const context = await browser.newContext();
  const vendor = await context.newPage();
  await login(vendor, "vendor1");
  await vendor.getByRole("button", { name: title, exact: true }).click();
  for (const action of ["Accept order", "Start production", "Mark ready"]) {
    await vendor.getByRole("button", { name: action, exact: true }).click();
    await vendor.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      vendor.getByRole("button", { name: "Confirm", exact: true }),
    ).toHaveCount(0);
  }
  const installerContext = await browser.newContext();
  const installer = await installerContext.newPage();
  await login(installer, "installer1");
  const card = installer.locator(".job-card").filter({
    has: installer.getByRole("heading", { name: title, exact: true }),
  });
  await card.getByRole("button", { name: "Claim installation" }).click();
  await installer.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(card.getByText(/remaining/)).toBeVisible();
  const initialCountdown = await card.getByText(/remaining/).textContent();
  await expect(card.getByText(/remaining/)).not.toHaveText(initialCountdown!);
  for (const kind of ["identity", "payment"]) {
    await card
      .getByRole("button", { name: `Verify ${kind}`, exact: true })
      .click();
    await installer
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(installer.getByRole("dialog")).toHaveCount(0);
  }
  await card.getByRole("button", { name: "Complete installation" }).click();
  await installer.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();
  // The vendor's already-open details must also update without a refresh.
  await expect(
    vendor
      .locator(".detail-drawer")
      .getByText("Completed", { exact: true })
      .first(),
  ).toBeVisible();
  // The manager's existing session must update through SSE, without a manual refresh.
  await expect(
    page
      .locator("tbody tr")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) })
      .getByText("Completed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page
      .locator(".detail-drawer")
      .getByText("Completed", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Activity history" }),
  ).toBeVisible();
  await expect(
    page.locator(".timeline").getByText("Order completed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close order details" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
  await installerContext.close();
});
test("unauthenticated API calls are rejected", async ({ request }) => {
  expect((await request.get("/api/orders")).status()).toBe(401);
  expect((await request.get("/api/events")).status()).toBe(401);
});

test("20 HTTP claims from three authenticated installers yield one winner", async ({
  playwright,
  baseURL,
}) => {
  const contexts = await Promise.all(
    [1, 2, 3].map(async (n) => {
      const context = await playwright.request.newContext({
        baseURL,
      });
      const { csrfToken } = await (await context.get("/api/auth/csrf")).json();
      await context.post("/api/auth/callback/credentials", {
        form: {
          csrfToken,
          email: `installer${n}@signcraft.demo`,
          password: "SignCraft!2026",
          callbackUrl: baseURL ?? "http://localhost:3000",
        },
      });
      expect((await context.get("/api/me")).status()).toBe(200);
      return context;
    }),
  );
  try {
    const list = await (await contexts[0].get("/api/install-jobs")).json();
    const available = list.items.find(
      (j: { status: string }) => j.status === "AVAILABLE",
    );
    expect(available).toBeTruthy();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        contexts[i % 3].post(`/api/install-jobs/${available.id}/claim`, {
          data: {},
        }),
      ),
    );
    expect(responses.filter((r) => r.status() === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status() === 409)).toHaveLength(19);
    const winner = responses.findIndex((r) => r.status() === 200);
    const claim = await responses[winner].json();
    const released = await contexts[winner % 3].post(
      `/api/install-jobs/${available.id}/verify/identity`,
      {
        data: { claimId: claim.claimId, revision: claim.revision, fail: true },
      },
    );
    expect(released.status()).toBe(200);
    const protectedOrder = await contexts[0].get(
      `/api/orders/${available.orderId}`,
    );
    expect(protectedOrder.status()).toBe(404);
  } finally {
    await Promise.all(contexts.map((c) => c.dispose()));
  }
});
