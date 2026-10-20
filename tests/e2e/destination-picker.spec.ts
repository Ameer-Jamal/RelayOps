import { test, expect } from "@playwright/test";

test("2500 destinations stay paginated, searchable, and keyboard selectable", async ({ page, request }) => {
  const first = await request.get("/api/teams/directory?limit=30");
  const payload = (await first.json()).data;
  expect(payload.total).toBe(2500);
  expect(payload.entries).toHaveLength(30);
  expect(payload.nextOffset).toBe(30);
  await page.goto("/#targets");
  await expect(page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option")).toHaveCount(0);
  await page.getByRole("button", { name: "Teams destination", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search Teams destinations" });
  await expect(page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option")).toHaveCount(30);
  await expect(page.getByRole("status").filter({ hasText: "2500 matching" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("31–60 of 2500")).toBeVisible();
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("1–30 of 2500")).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("2498");
  await expect(page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Selected destination")).toContainText("Example destination 2498");
  await expect(page.getByLabel("Selected destination")).toContainText("19:destination-2498");
});

test("type filters, empty state, escape, and exact ID selection work", async ({ page }) => {
  await page.goto("/#targets");
  await page.getByRole("button", { name: "Teams destination", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search Teams destinations" });
  await page.getByRole("combobox", { name: "Filter destination type" }).selectOption("channel");
  await expect(page.getByRole("status").filter({ hasText: "500 matching" })).toBeVisible();
  await search.fill("this-does-not-exist");
  await expect(page.getByText("No matches. Try a different name or type.")).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Teams destination", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Teams destination", exact: true }).click();
  await page.getByRole("combobox", { name: "Filter destination type" }).selectOption("all");
  await search.fill("48:notes");
  await expect(page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option")).toHaveCount(1);
  await page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option").click();
  await expect(page.getByLabel("Selected destination")).toContainText("Myself");
});

test("manual actions uses the same picker without sending during selection", async ({ page }) => {
  const sends: string[] = [];
  page.on("request", req => { if (req.url().includes("test-post")) sends.push(req.url()); });
  await page.goto("/#actions");
  await page.getByRole("button", { name: "Teams destination", exact: true }).click();
  await page.getByRole("combobox", { name: "Search Teams destinations" }).fill("48:notes");
  await expect(page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option")).toHaveCount(1);
  await page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option").click();
  await expect(page.getByRole("button", { name: "Teams destination", exact: true })).toHaveText(/Myself/);
  await expect(page.getByRole("button", { name: "Send Message", exact: true })).toBeEnabled();
  expect(sends).toEqual([]);
});

test("a late search response cannot replace the current query", async ({ page }) => {
  let finishOld!: () => void;
  const oldFinished = new Promise<void>(resolve => { finishOld = resolve; });
  await page.route("**/api/teams/directory?**", async route => {
    if (new URL(route.request().url()).searchParams.get("query") === "2480") {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 600));
      try { await route.fulfill({ response }); } catch { /* The obsolete request can be aborted. */ }
      finally { finishOld(); }
    } else await route.continue();
  });
  await page.goto("/#targets");
  await page.getByRole("button", { name: "Teams destination", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search Teams destinations" });
  const started = page.waitForRequest(req => new URL(req.url()).searchParams.get("query") === "2480");
  await search.fill("2480");
  await started;
  await search.fill("2498");
  await oldFinished;
  const options = page.getByRole("listbox", { name: "Teams destinations" }).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options).toContainText("2498");
});

async function chooseSelf(page: import('@playwright/test').Page) {
  await page.goto('/#targets');
  await page.getByRole('button', { name: 'Teams destination', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search Teams destinations' }).fill('48:notes');
  const option = page.getByRole('listbox', { name: 'Teams destinations' }).getByRole('option');
  await expect(option).toHaveCount(1);
  await option.click();
}

test('compose carries the exact destination without sending', async ({ page }) => {
  const sends: string[] = [];
  page.on('request', req => { if (req.url().includes('test-post')) sends.push(req.url()); });
  await chooseSelf(page);
  await page.getByRole('button', { name: 'Compose message', exact: true }).click();
  await expect(page).toHaveURL(/#actions$/);
  await expect(page.getByRole('button', { name: 'Teams destination', exact: true })).toHaveText(/Myself/);
  await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  expect(sends).toEqual([]);
});

test('use in a rule creates an unsaved disabled draft with exact destination', async ({ page, request }) => {
  const before = await (await request.get('/api/rules-config')).json();
  await chooseSelf(page);
  await page.getByRole('button', { name: 'Use in a rule', exact: true }).click();
  await expect(page).toHaveURL(/#rules$/);
  await expect(page.getByText(/Unsaved rule draft for Myself/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Rule ID', exact: true }).last()).toHaveValue('message-draft');
  await expect(page.getByRole('checkbox', { name: 'Enabled', exact: true }).last()).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Target', exact: true }).last()).toHaveValue('48:notes');
  expect((await (await request.get('/api/rules-config')).json()).data.rules).toEqual(before.data.rules);
  await page.getByRole('button', { name: 'Save Rules', exact: true }).click();
  await expect(page.getByText('Rules saved.', { exact: true })).toBeVisible();
  const saved = (await (await request.get('/api/rules-config')).json()).data.rules;
  expect(saved.find((rule: { id: string }) => rule.id === 'message-draft')).toMatchObject({ enabled: false, actions: [{ type: 'post_message', target: '48:notes' }] });
});

test('save shortcut persists exact destination and rejects duplicate names', async ({ page, request }) => {
  await chooseSelf(page);
  await page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shortcut name', exact: true }).fill('fixture-self');
  await page.getByRole('button', { name: 'Save Shortcut', exact: true }).click();
  await expect(page.getByText('Shortcut "fixture-self" saved. Use it as a target in rules or MCP calls.')).toBeVisible();
  const aliases = (await (await request.get('/api/targets')).json()).data;
  expect(decodeURIComponent(aliases.find((target: { name: string }) => target.name === 'fixture-self').url)).toContain('48:notes');
  await page.getByRole('button', { name: 'Save shortcut', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shortcut name', exact: true }).fill('fixture-self');
  await page.getByRole('button', { name: 'Save Shortcut', exact: true }).click();
  await expect(page.getByText(/That shortcut name already exists/)).toBeVisible();
});
