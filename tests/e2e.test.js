// End to end in a real Chromium with the unpacked extension: connect, pick an
// element with the mouse, describe it, save. GitHub is the in-memory fake,
// served through request interception, so nothing leaves the machine.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
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

test("pick, describe and save an idea in a real browser", { skip: chromium ? false : "playwright not installed" }, async () => {
  const site = await serveFixture();
  const gh = fakeGitHub({ empty: true });
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1000, height: 700 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

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

    const page = await context.newPage();
    await page.goto(site.url);
    const panel = await context.newPage();
    // RIFF_SHOTS=<dir> saves screenshots of each panel view at side-panel width,
    // for design review. Headless tabs share one window, so the panel is only
    // narrowed after the page screenshot has been taken.
    const shoot = async (name) => {
      if (!process.env.RIFF_SHOTS) return;
      await panel.setViewportSize({ width: 380, height: 900 });
      await panel.screenshot({ path: path.join(process.env.RIFF_SHOTS, `${name}.png`), fullPage: true });
    };
    const errors = [];
    panel.on("pageerror", (error) => errors.push(error.message));
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

    // Connect
    await panel.getByLabel("Repo").fill("https://github.com/ana/inspiration");
    await panel.getByLabel("Token").fill("good-token");
    await panel.getByRole("button", { name: "Connect" }).click();
    await panel.getByRole("button", { name: "Pick something you like" }).waitFor();

    // The panel acts on the active tab, as it does when docked beside the page.
    await page.bringToFront();
    await panel.evaluate(() => document.getElementById("pick").click());
    await panel.locator("#view-picking").waitFor({ state: "visible" });

    // Hover the button, step out to the card with ↑, come back with ↓, click.
    const cta = page.locator(".cta");
    await cta.hover();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await cta.click();

    await panel.locator("#view-review").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.hacked), undefined, "the page's own click handler never ran");
    assert.equal(await panel.inputValue("#title"), "Button from 127.0.0.1");
    assert.equal(await panel.inputValue("#tags"), "button");
    const chips = await panel.locator("#tokens .chip").allTextContents();
    assert.ok(chips.includes("#5e6ad2"), `swatches: ${chips}`);
    assert.ok(chips.includes("Arial"), `fonts: ${chips}`);
    assert.ok(chips.includes("radius 999px"), `radius: ${chips}`);

    // Saving without a note asks for one
    await panel.getByRole("button", { name: "Save to inspiration" }).click();
    assert.match(await panel.textContent("#save-error"), /why you like it/);

    // "Dictate" the note, then save with Ctrl+Enter
    await panel.fill("#note", "The arrow nudges right on hover and the shadow is barely there. #hover");
    await panel.fill("#title", "Pill button with arrow");
    await panel.fill("#project", "portfolio");
    await shoot("4-review");
    await panel.press("#note", "Control+Enter");
    await panel.locator("#view-saved").waitFor({ state: "visible", timeout: 10_000 });
    await shoot("5-saved");

    const index = JSON.parse(gh.read("index.json"));
    const idea = index.ideas[0];
    assert.equal(idea.title, "Pill button with arrow");
    assert.equal(idea.project, "portfolio");
    assert.deepEqual(idea.tags, ["button", "portfolio", "hover"]);
    assert.equal(idea.source, site.url);

    // The screenshot is a real PNG cropped to the button. (The crop scale comes
    // from the captured image itself, so it is 2x on a 2x display; headless
    // Chromium captures at 1x.)
    const png = Buffer.from(gh.readBase64(idea.shot), "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const box = await cta.boundingBox();
    assert.ok(Math.abs(png.readUInt32BE(16) - box.width) <= 1, `width ${png.readUInt32BE(16)} vs ${box.width}`);
    assert.ok(Math.abs(png.readUInt32BE(20) - box.height) <= 1, `height ${png.readUInt32BE(20)} vs ${box.height}`);

    // The snippet keeps structure and values, and drops anything executable
    const snippet = gh.read(idea.snippet);
    assert.match(snippet, /border-radius: 999px/);
    assert.match(snippet, /background-color: #5e6ad2/);
    assert.match(snippet, /\]::after \{ content: "→";/);
    assert.match(snippet, /background: #16171b|background: #0f1013|background: #08090a/);
    assert.doesNotMatch(snippet, /onclick|<script|data-track/);

    const readme = gh.read(idea.path);
    assert.match(readme, /> The arrow nudges right on hover/);
    assert.match(readme, /transition: transform 0\.16s ease-out/);
    assert.ok(gh.read("AGENTS.md"));

    // Copy prompt and recent list
    await panel.getByRole("button", { name: "Capture another" }).click();
    assert.match(await panel.textContent("#recent"), /Pill button with arrow/);
    await shoot("2-ready");
    await panel.evaluate(() => {
      document.getElementById("view-ready").hidden = true;
      document.getElementById("view-picking").hidden = false;
    });
    await shoot("3-picking");
    await panel.getByRole("button", { name: "Settings" }).click();
    await shoot("1-settings");
    if (process.env.RIFF_SHOTS) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.join(process.env.RIFF_SHOTS, "snippet.html"), snippet);
      await writeFile(path.join(process.env.RIFF_SHOTS, "README.md"), readme);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    site.close();
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
