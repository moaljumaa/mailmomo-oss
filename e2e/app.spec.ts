import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { E2E } from "./global-setup";
import { OWNER, appendMail, imapMessages, waitForInbox } from "./helpers";
import { eml } from "../tests/helpers";

test.describe.configure({ mode: "serial" });

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
});
test.afterAll(async () => { await ctx.close(); });

const shot = (name: string) => page.screenshot({ path: `e2e-shots/${name}.png` });
const row = (text: string) => page.getByTestId("thread-row").filter({ hasText: text });

test("security: API is closed to anonymous users", async ({ request }) => {
  for (const p of ["/api/threads", "/api/accounts", "/api/settings", "/api/tokens"]) expect((await request.get(p)).status()).toBe(401);
  expect((await request.get("/api/events")).status()).toBe(401);
  expect((await request.get("/api/attachments/x")).status()).toBe(401);
  expect((await request.post("/api/mcp", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  const r = await request.get("/api/health");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("redirects to first-run setup, creates the owner, then closes signup", async ({ request }) => {
  await page.goto("/mail/inbox");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome to Mailmomo" })).toBeVisible();
  await shot("01-setup");
  await page.getByTestId("name").fill(OWNER.name);
  await page.getByTestId("email").fill(OWNER.email);
  await page.getByTestId("password").fill("short");
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/login/); // too short: rejected
  await page.getByTestId("password").fill(OWNER.password);
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/mail\/inbox/);
  await expect(page.getByTestId("onboarding")).toBeVisible();
  // signup is now closed
  const r = await request.post("/api/auth/sign-up/email", { data: { email: "evil@x.test", password: "another-long-password", name: "Evil" }, headers: { origin: "http://localhost:3100" } });
  expect(r.ok()).toBe(false);
});

test("connect a real IMAP/SMTP account and sync", async () => {
  await shot("02-onboarding");
  await page.getByTestId("acc-email").fill("alice@test.local");
  await page.getByTestId("acc-name").fill("Alice");
  await page.getByTestId("imap-host").fill("127.0.0.1");
  await page.getByTestId("imap-port").fill(String(E2E.imap));
  await page.locator("select").first().selectOption("starttls");
  await page.getByTestId("imap-port").fill(String(E2E.imap));
  await page.getByTestId("imap-pass").fill("pass");
  await page.getByTestId("smtp-host").fill("127.0.0.1");
  await page.getByTestId("smtp-port").fill(String(E2E.smtp));
  await page.getByTestId("smtp-user").fill("alice@test.local");
  await page.getByTestId("smtp-pass").fill("pass");
  await page.getByText("Advanced").click();
  await page.getByRole("switch", { name: "Allow self-signed" }).click();
  // wrong password is reported clearly
  await page.getByTestId("imap-pass").fill("nope");
  await page.getByTestId("test-conn").click();
  await expect(page.getByText(/IMAP: .*/)).toBeVisible();
  await page.getByTestId("imap-pass").fill("pass");
  await page.getByTestId("test-conn").click();
  await expect(page.getByText("IMAP: connected")).toBeVisible();
  await expect(page.getByText("SMTP: connected")).toBeVisible();
  await page.getByTestId("save-account").click();
  await waitForInbox(page, 6);
  await shot("03-inbox");
});

test("inbox: threads, categories, unread state", async () => {
  await expect(page.getByTestId("view-title")).toHaveText("Inbox");
  // 7 messages, kickoff + reply are one thread -> 7 rows? (6 threads + attachment thread)
  await expect(page.getByTestId("thread-row")).toHaveCount(6);
  await expect(row("Project kickoff")).toContainText("2"); // thread count
  await expect(row("Weekly deals")).toBeVisible();
  // tabs filter
  await page.getByRole("tab", { name: /Promos/ }).click();
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await expect(row("Weekly deals")).toBeVisible();
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page.getByTestId("thread-row")).toHaveCount(6);
});

test("AI triage categorizes and summarizes (mocked model)", async () => {
  // triage worker runs in the background
  await expect.poll(async () => (await row("Your invoice").textContent()) ?? "", { timeout: 40_000 }).toContain("An invoice or receipt");
  await expect(row("Project kickoff")).toContainText("A message from a person");
  await page.reload();
  await expect(page.getByTestId("sidebar") .or(page.getByRole("link", { name: /Needs reply/ }))).toBeVisible();
  await shot("04-triaged");
});

test("open a conversation: reader, remote images blocked, mark read", async () => {
  await row("Weekly deals").click();
  await expect(page.getByTestId("reader-subject")).toHaveText("Weekly deals: 50% off");
  await expect(page.getByText("Images are hidden to protect your privacy.")).toBeVisible();
  const frame = page.frameLocator('[data-testid="message-html"]');
  await expect(frame.getByText("Big")).toBeVisible();
  await expect(page.getByText("This looks like a mailing list.")).toBeVisible();
  await page.getByRole("button", { name: "Load images" }).click();
  await expect(page.getByText("Images are hidden to protect your privacy.")).toBeHidden();
  await shot("05-reader-html");
  // becomes read shortly after opening
  await expect(row("Weekly deals").locator('[aria-label="Unread"]')).toHaveCount(0, { timeout: 8000 });
});

test("keyboard: j/k navigation, archive with e, undo with z", async () => {
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]t=/);
  const sel = () => page.locator("[role=option][aria-selected=true]");
  await page.getByTestId("thread-list").hover();
  await page.keyboard.press("j");
  await expect(sel()).toHaveCount(1);
  const first = await sel().getAttribute("data-thread-id");
  await page.keyboard.press("j");
  await expect(sel()).not.toHaveAttribute("data-thread-id", first!);
  const second = await sel().getAttribute("data-thread-id");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(sel()).toHaveAttribute("data-thread-id", second!); // rapid presses are not lost
  await page.keyboard.press("k");
  await expect(sel()).toHaveAttribute("data-thread-id", first!);

  const before = await page.getByTestId("thread-row").count();
  await page.keyboard.press("e");
  await expect(page.getByTestId("thread-row")).toHaveCount(before - 1);
  await expect(page.getByText(/Archived/)).toBeVisible();
  await expect(sel()).toHaveCount(1); // advanced to a neighbour
  await page.keyboard.press("z");
  await expect(page.getByTestId("thread-row")).toHaveCount(before, { timeout: 10_000 });
});

test("search: free text, operators, attachments", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await page.getByTestId("search-input").fill("pineapple");
  await expect(page).toHaveURL(/search/);
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await expect(row("Project kickoff")).toBeVisible();
  await page.getByTestId("search-input").fill("has:attachment");
  await expect(row("Signed contract")).toBeVisible();
  await page.getByTestId("search-input").fill("from:stripe");
  await expect(page.getByTestId("thread-row")).toHaveCount(1);
  await page.getByTestId("search-input").fill("zzzznothing");
  await expect(page.getByText("No results")).toBeVisible();
  await shot("06-search-empty");
  // natural language (mock) button appears for 3+ plain words
  await page.getByTestId("search-input").fill("show me my invoices please");
  await page.getByTestId("ai-search-btn").click();
  await expect(page.getByTestId("search-input")).toHaveValue("invoice");
  await expect(row("Your invoice")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/mail/inbox");
  await waitForInbox(page, 6);
});

test("new mail arrives live (IMAP IDLE → SSE) and updates counts without a reload", async () => {
  const before = await page.getByTestId("thread-row").count();
  await appendMail("alice@test.local", eml({ from: "Erin <erin@test.local>", to: "alice@test.local", subject: "Live delivery check", body: "Hello, did this show up instantly?" }));
  await expect(row("Live delivery check")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("thread-row")).toHaveCount(before + 1);
  // archive it again so later tests keep their expectations
  await row("Live delivery check").click();
  await page.keyboard.press("e");
  await expect(row("Live delivery check")).toBeHidden();
});

test("attachments download from the IMAP server", async () => {
  await row("Signed contract").click();
  await expect(page.getByTestId("attachments")).toContainText("contract.txt");
  const href = await page.getByTestId("attachments").locator("a").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("THE-CONTRACT-TEXT");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("compose and send a message (undo window, SMTP, Sent copy)", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  const win = page.getByTestId("compose-window");
  await expect(win).toBeVisible();
  await page.getByTestId("compose-to").fill("bob@test.local");
  await page.keyboard.press("Enter");
  await page.getByTestId("compose-subject").fill("Hello from the e2e suite");
  await page.getByTestId("compose-body").click();
  await page.keyboard.type("This is a real message sent through SMTP.");
  await expect(win.getByText("Saved")).toBeVisible({ timeout: 8000 });
  await shot("07-compose");
  await page.getByTestId("compose-body").press("ControlOrMeta+Enter");
  await expect(win).toBeHidden();
  await expect(page.getByText("Sending…")).toBeVisible();
  // delivered to Bob's real IMAP inbox after the undo window
  await expect.poll(async () => (await imapMessages("bob@test.local")).some((m) => m.subject === "Hello from the e2e suite"), { timeout: 30_000 }).toBe(true);
  const bob = (await imapMessages("bob@test.local")).find((m) => m.subject === "Hello from the e2e suite")!;
  expect(bob.text).toContain("This is a real message sent through SMTP.");
  // and a copy lands in Alice's Sent folder
  await expect.poll(async () => (await imapMessages("alice@test.local", "Sent")).some((m) => m.subject === "Hello from the e2e suite"), { timeout: 30_000 }).toBe(true);
  await page.goto("/mail/sent");
  await expect(row("Hello from the e2e suite")).toBeVisible({ timeout: 30_000 });
});

test("undo send cancels delivery", async () => {
  await page.goto("/mail/inbox");
  await waitForInbox(page, 4);
  await page.keyboard.press("c");
  await page.getByTestId("compose-to").fill("bob@test.local");
  await page.keyboard.press("Enter");
  await page.getByTestId("compose-subject").fill("Never sent");
  await page.getByTestId("compose-body").click();
  await page.keyboard.type("oops");
  await page.getByTestId("send-btn").click();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByTestId("compose-window")).toBeVisible();
  await page.getByTestId("discard-btn").click();
  await page.waitForTimeout(12_000);
  expect((await imapMessages("bob@test.local")).some((m) => m.subject === "Never sent")).toBe(false);
});

test("reply with r keeps the thread and quotes history", async () => {
  await page.goto("/mail/inbox");
  await waitForInbox(page, 6);
  await row("Lunch tomorrow").click();
  await expect(page.getByTestId("reader-subject")).toHaveText("Lunch tomorrow?");
  await page.keyboard.press("r");
  const win = page.getByTestId("compose-window");
  await expect(win).toBeVisible();
  await expect(page.getByTestId("compose-subject")).toHaveValue("Re: Lunch tomorrow?");
  await expect(win.getByText("Carol", { exact: true })).toBeVisible();
  await page.getByTestId("compose-body").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Sounds great, noon works!");
  await shot("08-reply");
  await page.getByTestId("send-btn").click();
  await expect.poll(async () => (await imapMessages("carol@test.local")).some((m) => m.subject === "Re: Lunch tomorrow?" && m.text.includes("Sounds great, noon works!")), { timeout: 30_000 }).toBe(true);
  const carol = (await imapMessages("carol@test.local")).find((m) => m.subject === "Re: Lunch tomorrow?")!;
  expect(carol.text.toLowerCase()).toContain("in-reply-to");
});

test("command palette navigates and runs actions", async () => {
  await page.goto("/mail/inbox");
  await waitForInbox(page, 6);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette-input")).toBeVisible();
  await shot("09-palette");
  await page.getByTestId("palette-input").fill("starred");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("view-title")).toHaveText("Starred");
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page.getByTestId("view-title")).toHaveText("Inbox");
});

test("snooze hides a conversation until later; label and star", async () => {
  await waitForInbox(page, 6);
  await row("GitHub").or(row("Pull request")).first().click();
  await page.keyboard.press("h");
  await expect(page.getByRole("dialog", { name: "Snooze" })).toBeVisible();
  await shot("10-snooze");
  await page.getByText("Tomorrow", { exact: true }).click();
  await expect(row("Pull request merged")).toBeHidden();
  await page.goto("/mail/snoozed");
  await expect(row("Pull request merged")).toBeVisible();
  await page.goto("/mail/inbox");
  await waitForInbox(page, 5);
  // label
  await row("Lunch tomorrow").click();
  await page.keyboard.press("l");
  await page.getByPlaceholder("Add label…").fill("Friends");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Friends" })).toBeVisible({ timeout: 10_000 });
  // star
  await page.keyboard.press("s");
  await page.goto("/mail/starred");
  await expect(row("Lunch tomorrow")).toBeVisible();
});

test("AI: thread summary, draft reply, assistant panel, compose-with-AI", async () => {
  await page.goto("/mail/inbox");
  await waitForInbox(page, 5);
  await row("Project kickoff").click();
  await expect(page.getByTestId("ai-summary")).toBeVisible();
  await page.getByRole("button", { name: "Summarize thread" }).click();
  await expect(page.getByTestId("ai-summary")).toContainText("Meeting proposed for Tuesday");
  await shot("11-ai-summary");
  await page.getByTestId("ai-reply-btn").click();
  await page.getByRole("menuitem", { name: "Friendly" }).click();
  await expect(page.getByTestId("compose-window")).toBeVisible();
  await expect(page.getByTestId("compose-window")).toContainText("Tuesday works for me");
  await page.getByTestId("discard-btn").click();
  // assistant panel via ⌘J
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await page.getByTestId("agent-input").fill("how is my inbox?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("agent-panel")).toContainText("all caught up");
  await shot("12-agent");
  await page.keyboard.press("Escape");
  // compose with AI
  await page.keyboard.press("c");
  await page.getByTestId("ai-compose-btn").click();
  await page.getByTestId("ai-compose-input").fill("ask Bob about the budget");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("compose-subject")).toHaveValue("Quick question");
  await expect(page.getByTestId("compose-body")).toContainText("Following up");
  await page.getByTestId("discard-btn").click();
});

test("settings: rules, API token + real MCP call, appearance", async ({ request }) => {
  await page.goto("/settings/rules");
  await page.waitForTimeout(3000);
  await page.getByTestId("rule-nl").fill("archive anything from github.com and label it Dev");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("rule-preview")).toContainText("github.com");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("rule-row")).toHaveCount(1);

  await page.goto("/settings/api");
  await page.getByTestId("token-scope").selectOption("write");
  await page.getByTestId("token-create").click();
  const token = await page.getByTestId("token-value").textContent();
  expect(token).toMatch(/^mm_/);
  await shot("13-api");

  const init = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } },
  });
  expect(init.status()).toBe(200);
  const list = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("list_messages");
  expect(names).toContain("archive");
  expect(names).not.toContain("send_email");
  const call = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_messages", arguments: { query: "invoice" } } },
  });
  const body = JSON.parse((await call.json()).result.content[0].text);
  expect(body.threads[0].subject).toBe("Your invoice from ACME");

  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/mail/inbox");
  await waitForInbox(page, 4);
  await shot("14-dark");
  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("mobile layout shows one pane at a time", async ({ browser }) => {
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, storageState: await ctx.storageState() });
  const p = await m.newPage();
  await p.goto("/mail/inbox");
  await expect(p.getByTestId("thread-row").first()).toBeVisible({ timeout: 20_000 });
  await p.screenshot({ path: "e2e-shots/15-mobile-list.png" });
  await p.getByRole("button", { name: "Menu" }).click();
  await expect(p.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
  await p.screenshot({ path: "e2e-shots/15b-mobile-menu.png" });
  await p.getByRole("link", { name: "Sent" }).click();
  await expect(p.getByTestId("view-title")).toHaveText("Sent");
  await expect(p.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
  await p.goto("/mail/inbox");
  await expect(p.getByTestId("thread-row").first()).toBeVisible({ timeout: 20_000 });
  await expect(p).toHaveTitle(/Inbox · Mailmomo/);
  await p.getByTestId("thread-row").first().click();
  await expect(p.getByTestId("reader")).toBeVisible();
  await expect(p.getByTestId("thread-list")).toBeHidden();
  await p.screenshot({ path: "e2e-shots/16-mobile-reader.png" });
  await m.close();
});

test("sign out returns to login", async () => {
  await page.goto("/settings/security");
  await page.getByTestId("signout").click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByTestId("email").fill(OWNER.email);
  await page.getByTestId("password").fill("wrong-password-123");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
  await page.getByTestId("password").fill(OWNER.password);
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/mail\/inbox/);
});
