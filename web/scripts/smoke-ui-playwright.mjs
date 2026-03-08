import { chromium } from "@playwright/test";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3010",
  });

  await context.addCookies([
    {
      name: "id_token",
      value: "smoke",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const appPage = await context.newPage();

  await appPage.route("**/api/threads", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            threads: [
              { id: "thread-1", title: "Jane Smith - Appeal", updatedAt: "2026-02-23T03:00:00.000Z" },
              { id: "thread-2", title: "Alex Turner - LMN", updatedAt: "2026-02-23T02:00:00.000Z" },
            ],
          },
        }),
      });
    }

    if (method === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            thread: { id: "thread-created", title: "Smoke Created", updatedAt: "2026-02-23T03:10:00.000Z" },
          },
        }),
      });
    }

    return route.continue();
  });

  await appPage.goto("/app", { waitUntil: "networkidle" });
  await appPage.waitForSelector("text=What are we writing today?");
  await appPage.waitForSelector("#patient-search");

  await appPage.fill("#patient-search", "jane");
  await appPage.waitForSelector("text=Jane Smith - Appeal");

  await appPage.fill("#thread-title", "Smoke Created");
  await appPage.click("button:has-text('New Patient')");
  await appPage.waitForURL("**/document/thread-created");

  const docPage = appPage;

  await docPage.route("**/api/threads/thread-created/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          messages: [
            { id: "m1", role: "user", content: "Need appeal support", createdAt: "2026-02-23T03:10:00.000Z" },
            { id: "m2", role: "assistant", content: "Drafting now", createdAt: "2026-02-23T03:10:02.000Z" },
          ],
        },
      }),
    });
  });

  await docPage.route("**/api/threads/thread-created/documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          documents: [
            {
              id: "doc-1",
              threadId: "thread-created",
              kind: "appeal",
              version: 1,
              createdAt: "2026-02-23T03:10:05.000Z",
            },
          ],
        },
      }),
    });
  });

  await docPage.route("**/api/documents/doc-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          document: {
            id: "doc-1",
            threadId: "thread-created",
            kind: "appeal",
            version: 1,
            content: "Introduction\nClinical summary\nRequested determination",
            createdAt: "2026-02-23T03:10:05.000Z",
          },
        },
      }),
    });
  });

  await docPage.goto("/document/thread-created", { waitUntil: "networkidle" });
  await docPage.waitForSelector("text=Appeal Letter Draft");
  await docPage.waitForSelector("text=Pilot Metrics");
  await docPage.waitForSelector("text=Org Default Logo");
  await docPage.waitForSelector("text=Case Override Logo");

  const noteText = "Strong first draft";
  await docPage.click("button:has-text('5')");
  await docPage.fill("textarea[placeholder='Optional satisfaction notes...']", noteText);
  await docPage.click("button:has-text('Save Notes')");
  await docPage.waitForSelector("text=Satisfaction notes saved.");

  await docPage.reload({ waitUntil: "networkidle" });
  await docPage.waitForSelector("text=Pilot Metrics");
  await docPage.waitForSelector(`textarea[placeholder='Optional satisfaction notes...']`);
  const savedNotes = await docPage.inputValue("textarea[placeholder='Optional satisfaction notes...']");
  if (savedNotes !== noteText) {
    throw new Error(`Expected persisted satisfaction notes '${noteText}', got '${savedNotes}'`);
  }

  await browser.close();

  console.log("playwright ui smoke passed");
  console.log("- /app loaded, search/filter and create/navigation validated");
  console.log("- /document/[id] loaded, Slice 5 controls and pilot metrics interactions validated");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
