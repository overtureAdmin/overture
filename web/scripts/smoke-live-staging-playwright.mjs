import { chromium } from "@playwright/test";

const baseUrl = process.env.STAGING_BASE_URL || "https://app.unityhealthtech.com";
const username = process.env.STAGING_SMOKE_USER || "dev.user@unityappeals.local";
const password = process.env.STAGING_SMOKE_PASSWORD || "DevPass1!DevPass1!";

async function maybeSignIn(page) {
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });

  if (page.url().includes("/login")) {
    const hostedUiEntry = page.locator("a[href^='/auth/login']");
    if (await hostedUiEntry.count()) {
      await hostedUiEntry.first().click();
    }
  }

  await page.waitForLoadState("domcontentloaded");
  if (!page.url().includes("amazoncognito.com")) {
    return;
  }

  const usernameInput = page.locator("input[name='username']:visible, input#signInFormUsername:visible").first();
  const passwordInput = page.locator("input[name='password']:visible, input#signInFormPassword:visible").first();
  await usernameInput.waitFor({ timeout: 30000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);

  const submit = page.locator("button[type='submit']:visible, input[type='submit']:visible").first();
  await submit.click();
  await page.waitForURL((url) => url.toString().includes("/app"), { timeout: 60000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await maybeSignIn(page);

  await page.waitForURL((url) => url.toString().includes("/app"), { timeout: 60000 });
  await page.waitForSelector("text=What are we writing today?", { timeout: 60000 });

  const caseTitle = `Smoke Live ${new Date().toISOString()}`;
  await page.fill("#thread-title", caseTitle);
  await page.click("button:has-text('New Patient')");

  await page.waitForURL(/\/document\//, { timeout: 60000 });
  await page.waitForSelector("text=Intake + Checklist", { timeout: 60000 });
  await page.waitForSelector("text=Appeal Letter Draft", { timeout: 60000 });
  await page.waitForSelector("text=Pilot Metrics", { timeout: 60000 });
  await page.waitForSelector("text=Org Default Logo", { timeout: 60000 });
  await page.waitForSelector("text=Case Override Logo", { timeout: 60000 });

  await page.click("button:has-text('5')");
  await page.fill("textarea[placeholder='Optional satisfaction notes...']", "Live staging smoke satisfaction note");
  await page.click("button:has-text('Save Notes')");
  await page.waitForSelector("text=Satisfaction notes saved.", { timeout: 30000 });

  const documentUrl = page.url();
  await browser.close();

  console.log("staging browser smoke passed");
  console.log(`baseUrl=${baseUrl}`);
  console.log(`documentUrl=${documentUrl}`);
  console.log(`createdCaseTitle=${caseTitle}`);
}

run().catch((error) => {
  console.error("staging browser smoke failed");
  console.error(error);
  process.exit(1);
});
