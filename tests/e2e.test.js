// End to end in a real Chromium with the unpacked extension: connect, pick an
// element with the mouse, describe it, save. GitHub is the in-memory fake,
// served through request interception, so nothing leaves the machine.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { fakeGitHub } from "../extension/lib/fake-github.test-helper.js";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(root, "../extension");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}

async function serveFixture() {
  const html = await readFile(path.join(root, "fixtures/page.html"));
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

/**
 * The shipped extension relies on activeTab, which Chrome grants when you
 * press Alt+R or click the icon. A test cannot press the toolbar, so it runs
 * a copy whose manifest also allows all sites.
 */
async function testCopyOfExtension() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "riff-ext-"));
  await cp(extensionDir, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, "<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  return dir;
}

test("pick, dictate and save an idea in a real browser", { skip: chromium ? false : "playwright not installed" }, async () => {
  const site = await serveFixture();
  const gh = fakeGitHub({ empty: true });
  const extension = await testCopyOfExtension();
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const shots = process.env.RIFF_SHOTS;

  try {
    await context.route("https://api.github.com/**", async (route) => {
      const request = route.request();
      const response = await gh.fetch(request.url(), {
        method: request.method(),
        headers: { Authorization: request.headers().authorization },
        body: request.postData() ?? undefined,
      });
      await route.fulfill({ status: response.status, headers: { "content-type": "application/json" }, body: await response.text() });
    });

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const errors = [];

    // Connect once in the options page; it is remembered from then on.
    const options = await context.newPage();
    options.on("pageerror", (error) => errors.push(error.message));
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);
    await options.getByLabel("Repo", { exact: true }).fill("https://github.com/ana/inspiration");
    await options.getByLabel("Token", { exact: true }).fill("good-token");
    await options.getByRole("button", { name: "Connect" }).click();
    await options.getByText("Connected to ana/inspiration").waitFor();
    if (shots) await options.screenshot({ path: path.join(shots, "1-options.png"), fullPage: true });

    // Start a capture on the page, as Alt+R does.
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(site.url);
    await page.bringToFront();
    const started = await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url: `${url}*` });
      return globalThis.riffStartCapture(tab);
    }, site.url);
    assert.deepEqual(started, { started: true });

    // Hover the button, step out to the card with ↑, come back with ↓, click.
    const cta = page.locator(".cta");
    await cta.hover();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await cta.click();
    assert.equal(await page.evaluate(() => window.hacked), undefined, "the page's own click handler never ran");

    // The card opens on the page with the note box already focused, so
    // dictation lands there without a click.
    const card = page.locator("[data-riff-card]");
    await card.getByRole("dialog", { name: "Save to Riff" }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector("[data-riff-card]").shadowRoot.activeElement?.id), "note");
    const keysBefore = (await page.evaluate(() => window.pageKeys)).length;
    await page.keyboard.type("The arrow nudges right on hover and the shadow is barely there. #hover");
    assert.equal(await card.locator("#note").inputValue(), "The arrow nudges right on hover and the shadow is barely there. #hover");
    assert.equal((await page.evaluate(() => window.pageKeys)).length, keysBefore, "page shortcuts never saw the typing");

    // One question up front; the rest is folded but summarised.
    assert.equal(await card.locator("#title").isVisible(), false, "details start folded");
    assert.match(await card.locator("summary").textContent(), /Button from 127\.0\.0\.1 · #button/);
    await card.locator("summary").click();
    assert.equal(await card.locator("#title").inputValue(), "Button from 127.0.0.1");
    assert.equal(await card.locator("#tags").inputValue(), "button");
    const chips = await card.locator(".chip").allTextContents();
    assert.ok(chips.includes("#5e6ad2"), `swatches: ${chips}`);
    assert.ok(chips.includes("Arial"), `fonts: ${chips}`);
    assert.ok(chips.includes("radius 999px"), `radius: ${chips}`);

    await card.locator("#title").fill("Pill button with arrow");
    await card.locator("#project").fill("portfolio");
    if (shots) await page.screenshot({ path: path.join(shots, "2-card.png") });
    await card.locator("#project").press("Control+Enter");
    await card.getByRole("dialog", { name: "Saved to Riff" }).waitFor({ timeout: 10_000 });
    // The same card became the saved card, and the first save says so.
    assert.equal(await card.locator("section.card").count(), 1);
    assert.equal(await card.locator(".saved-head img").count(), 1);
    assert.match(await card.locator(".born").textContent(), /inspiration library is born/);
    await page.waitForTimeout(500);
    if (shots) await page.screenshot({ path: path.join(shots, "3-saved.png") });

    const index = JSON.parse(gh.read("index.json"));
    const idea = index.ideas[0];
    assert.equal(idea.title, "Pill button with arrow");
    assert.equal(idea.project, "portfolio");
    assert.deepEqual(idea.tags, ["button", "portfolio", "hover"]);
    assert.equal(idea.source, site.url);

    // The screenshot is the button only: the picker overlay and the card were
    // not on screen when it was taken. The crop scale comes from the captured
    // image itself, so it is 2x on a 2x display; headless captures at 1x.
    const png = Buffer.from(gh.readBase64(idea.shot), "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const box = await cta.boundingBox();
    assert.ok(Math.abs(png.readUInt32BE(16) - box.width) <= 1, `width ${png.readUInt32BE(16)} vs ${box.width}`);
    assert.ok(Math.abs(png.readUInt32BE(20) - box.height) <= 1, `height ${png.readUInt32BE(20)} vs ${box.height}`);

    const snippet = gh.read(idea.snippet);
    assert.match(snippet, /border-radius: 999px/);
    assert.match(snippet, /background-color: #5e6ad2/);
    assert.match(snippet, /\]::after \{ content: "→";/);
    assert.doesNotMatch(snippet, /onclick|<script|data-track/);
    assert.match(gh.read(idea.path), /> The arrow nudges right on hover/);
    assert.ok(gh.read("AGENTS.md"));

    // Esc closes the card; the idea shows up under Recent in the options page.
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached" });
    await options.reload();
    await options.getByRole("link", { name: "Pill button with arrow" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    site.close();
    await rm(extension, { recursive: true, force: true });
  }
});

test("the snippet of a whole card is cleaned of scripts and unsafe links", { skip: chromium ? false : "playwright not installed" }, async () => {
  const site = await serveFixture();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(site.url);
    await page.addScriptTag({ path: path.join(extensionDir, "lib/extract.js") });
    const data = await page.evaluate(() => globalThis.RiffExtract.capture(document.getElementById("plan")));

    assert.equal(data.element.selector, "section#plan");
    assert.equal(data.tokens.backdrop, "#08090a");
    assert.ok(data.tokens.gradients[0].includes("linear-gradient"));
    assert.ok(data.tokens.borders.includes("1px solid #23252a"));
    assert.ok(data.tokens.radii.includes("16px"));
    assert.ok(data.tokens.fonts.some((f) => f.family === "Georgia"));
    assert.equal(data.tokens.type[0].size, "20px", "largest text first");
    assert.match(data.tokens.layout, /^grid/);

    assert.doesNotMatch(data.snippet, /<script|inlineScriptRan|javascript:|onclick/);
    assert.match(data.snippet, new RegExp(`src="${site.url}logo.png"`), "relative URLs become absolute");
    assert.match(data.snippet, new RegExp(`href="${site.url}signup"`));
    assert.match(data.snippet, /Captured by Riff from/);
  } finally {
    await browser.close();
    site.close();
  }
});
