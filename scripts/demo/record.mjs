// Actual browser interactions. Run --probe before recording against a DB snapshot.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href
    : "playwright"
);
assert(
  process.env.DEMO_PASSWORD,
  "Supply DEMO_PASSWORD for the disposable demo owner",
);
const build = resolve(
  process.env.DEMO_BUILD_DIR || join(tmpdir(), "bos-video-demo"),
);
const web = process.env.DEMO_WEB_URL || "http://127.0.0.1:43100";
const api = process.env.DEMO_API_URL || "http://127.0.0.1:43101";
for (const url of [web, api])
  assert(
    ["127.0.0.1", "localhost"].includes(new URL(url).hostname),
    "Local demo only",
  );
const probe = process.argv.includes("--probe");
const seed = JSON.parse(await readFile(`${build}/seed.json`, "utf8"));
const voices = probe
  ? []
  : JSON.parse(await readFile(`${build}/voice.json`, "utf8"));
await mkdir(`${build}/raw`, { recursive: true });
await mkdir(`${build}/shots`, { recursive: true });
const login = await fetch(`${api}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.DEMO_EMAIL || "demo@ownstack.example",
    password: process.env.DEMO_PASSWORD,
  }),
});
assert(login.ok, "Demo login failed");
const cookie = login.headers.get("set-cookie").split(";")[0];
async function thread(key) {
  return (
    await fetch(`${api}/threads/${seed[key].conversationId}`, {
      headers: { cookie },
    })
  ).json();
}
const browser = await chromium.launch({ headless: true });
const results = [];
const nap = (ms) =>
  new Promise((r) => setTimeout(r, probe ? Math.min(ms, 100) : ms));
async function smooth(page, y) {
  await page.evaluate(
    async (target) => {
      const from = window.scrollY;
      const delta = target - from;
      const start = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          const p = Math.min(1, (now - start) / 850);
          const eased = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
          window.scrollTo(0, from + delta * eased);
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
    },
    Math.max(0, y),
  );
}
async function show(page, locator, margin = 160) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  if (box.y < 100 || box.y + box.height > 760)
    await smooth(page, (await page.evaluate(() => scrollY)) + box.y - margin);
}
async function click(page, loc) {
  await show(page, loc);
  const box = await loc.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 18,
  });
  await nap(250);
  await loc.click();
  await nap(550);
}
async function openThread(page, key) {
  await click(
    page,
    page.locator(`a[href="/threads/${seed[key].conversationId}"]`),
  );
  await page.waitForURL(`**/threads/${seed[key].conversationId}*`);
  await page.locator(".processing-summary").waitFor();
  await nap(500);
}
async function scene(id, title, route, action) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    ...(probe
      ? {}
      : {
          recordVideo: {
            dir: `${build}/raw`,
            size: { width: 1600, height: 900 },
          },
        }),
  });
  await context.addCookies([
    {
      name: "bos_session",
      value: cookie.split("=")[1],
      url: web,
      httpOnly: true,
    },
  ]);
  await context.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(s);
      const c = document.createElement("div");
      c.id = "demo-cursor";
      Object.assign(c.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "17px",
        height: "17px",
        border: "2px solid white",
        borderRadius: "50%",
        background: "#296653",
        boxShadow: "0 2px 9px #0005",
        zIndex: "2147483647",
        pointerEvents: "none",
        transform: "translate(-50%,-50%)",
      });
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => {
        c.style.left = `${e.clientX}px`;
        c.style.top = `${e.clientY}px`;
      });
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(70000);
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(web + route, { waitUntil: "load" });
  await page.locator("h1").waitFor();
  await nap(1400);
  const start = Date.now();
  try {
    await action(page);
    const min = (voices.find((v) => v.id === id)?.duration || 0) + 1.5;
    if (!probe) await nap(Math.max(900, min * 1000 - (Date.now() - start)));
    await page.screenshot({
      path: `${build}/shots/${String(id).padStart(2, "0")}.png`,
    });
    assert.equal(errors.length, 0, `Browser errors: ${errors.join("; ")}`);
    const duration = (Date.now() - start) / 1000;
    const video = page.video();
    await context.close();
    results.push({
      id,
      title,
      duration,
      ...(video ? { raw: await video.path() } : {}),
      errors,
    });
    await writeFile(
      `${build}/${probe ? "probe" : "recorded"}.json`,
      JSON.stringify(results, null, 2),
    );
    console.log(`PASS ${id}: ${title} (${duration.toFixed(1)}s)`);
  } catch (e) {
    await page.screenshot({ path: `${build}/failure-${id}.png` });
    await context.close();
    throw e;
  }
}
try {
  await scene(1, "AI prepares. People decide.", "/inbox", async (page) => {
    await nap(3000);
    await click(
      page,
      page.getByRole("combobox", { name: "Sort conversations" }),
    );
    await page.getByRole("combobox").selectOption("oldest");
    await nap(2500);
    await click(page, page.getByRole("searchbox"));
    await page.getByRole("searchbox").pressSequentially("Emma", { delay: 110 });
    await nap(1500);
  });
  await scene(
    2,
    "Real request → price-list-based quote",
    "/inbox",
    async (page) => {
      await page.getByRole("searchbox").fill("Emma");
      await openThread(page, "quote");
      await nap(4500);
      const quote = page.locator(".quote-card").last();
      await show(page, quote, 220);
      assert.match(await quote.innerText(), /407\.00/);
      await nap(4500);
    },
  );
  await scene(
    3,
    "Internal instructions. Recalculated quote.",
    "/inbox",
    async (page) => {
      await page.getByRole("searchbox").fill("Emma");
      await openThread(page, "quote");
      const input = page.getByRole("textbox", {
        name: "Instructions for the assistant",
      });
      await click(page, input);
      await input.pressSequentially(
        "Add an oven clean to this quote. Keep the original rooms and quantities.",
        { delay: 24 },
      );
      await click(
        page,
        page.getByRole("button", { name: "Update draft", exact: true }),
      );
      await page
        .locator(".quote-card")
        .last()
        .getByText(/478\.50/)
        .waitFor();
      assert.equal((await thread("quote")).quote.totalMinor, 47850);
      await show(page, page.locator(".quote-card").last(), 170);
      await nap(3500);
    },
  );
  let publicPath;
  await scene(4, "Review → edit → approve → queue", "/inbox", async (page) => {
    await page.getByRole("searchbox").fill("Emma");
    await openThread(page, "quote");
    const draft = page.getByRole("textbox", {
      name: "Draft reply",
      exact: true,
    });
    await click(page, draft);
    await draft.evaluate((el) =>
      el.setSelectionRange(0, el.value.indexOf("\n")),
    );
    await draft.pressSequentially("Hi Emma, thanks for getting in touch!", {
      delay: 50,
    });
    await nap(800);
    await click(
      page,
      page.getByRole("button", { name: "Save changes", exact: true }),
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Approve reply", exact: true })
      .waitFor({ state: "visible" });
    await nap(1000);
    await click(
      page,
      page.getByRole("button", { name: "Approve reply", exact: true }),
    );
    await page
      .getByRole("button", { name: "Send to outbox", exact: true })
      .first()
      .waitFor();
    await nap(1600);
    await click(
      page,
      page.getByRole("button", { name: "Send to outbox", exact: true }).first(),
    );
    await page.getByText("Awaiting customer", { exact: true }).waitFor();
    const t = await thread("quote");
    assert.equal(t.quote.status, "sent");
    const sent = t.messages.findLast((m) => m.direction === "outbound");
    assert(sent.text.includes("Hi Emma"));
    publicPath = new URL(sent.text.match(/http:\/\/[^\s]+\/quote\/[^\s]+/)[0])
      .pathname;
    const out = await (
      await fetch(`${api}/outbox`, { headers: { cookie } })
    ).json();
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].status, "queued");
    assert.equal(out.items[0].attempts, 0);
    await smooth(page, 260);
    await nap(3000);
  });
  await scene(
    5,
    "Customer portal: quote, conversation, decision",
    publicPath,
    async (page) => {
      await nap(3500);
      const accept = page.getByRole("button", {
        name: "Accept quote",
        exact: true,
      });
      await show(page, accept, 650);
      await nap(1800);
      await click(page, accept);
      await page
        .getByText("Thank you. You’ve accepted this quote.", { exact: true })
        .waitFor();
      assert.equal((await thread("quote")).quote.status, "accepted");
      await nap(2200);
    },
  );
  await scene(
    6,
    "Knowledge-base answers, still reviewed",
    "/inbox",
    async (page) => {
      await page.getByRole("searchbox").fill("Oliver");
      await openThread(page, "faq");
      await nap(1800);
      await show(page, page.locator(".fact-note"), 650);
      assert.match(
        await page.locator(".fact-note").innerText(),
        /2 knowledge base facts/,
      );
      await nap(4000);
    },
  );
  await scene(
    7,
    "Capture the request. Confirm availability.",
    "/inbox",
    async (page) => {
      await page.getByRole("searchbox").fill("Mia");
      await openThread(page, "service");
      await nap(1600);
      const note = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Internal service note" }),
      });
      await show(page, note, 190);
      assert.match(await note.innerText(), /12 Demo Street/);
      await nap(4500);
    },
  );
  await scene(
    8,
    "Escalate uncertainty. Human control.",
    "/inbox",
    async (page) => {
      await click(page, page.getByRole("link", { name: /^Complaints 1$/ }));
      await page.waitForURL("**/inbox?filter=complaints");
      await openThread(page, "complaint");
      assert.match(
        await page.locator(".processing-summary").innerText(),
        /Urgent/,
      );
      await nap(1200);
      await click(
        page,
        page.getByRole("button", {
          name: "Take over conversation",
          exact: true,
        }),
      );
      await page.getByText("Automation paused", { exact: true }).waitFor();
      await nap(2000);
      await click(
        page,
        page.getByRole("link", { name: "Back to inbox", exact: true }),
      );
      await page.waitForURL("**/inbox");
      await click(page, page.getByRole("link", { name: /^Needs review 2$/ }));
      await page.waitForURL("**/inbox?filter=needs_human");
      await nap(2500);
      assert(await page.getByRole("link", { name: /Ava Martin/ }).count());
    },
  );
  await scene(
    9,
    "Faster preparation. Human control.",
    "/outbox",
    async (page) => {
      assert.match(await page.locator("main").innerText(), /Queued|queued/);
      await nap(3000);
    },
  );
  console.log(
    probe
      ? "PROBE COMPLETE: all real actions verified. Restore snapshot before recording."
      : "RECORDING COMPLETE",
  );
} finally {
  await browser.close();
}
