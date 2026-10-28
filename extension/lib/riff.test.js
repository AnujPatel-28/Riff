import assert from "node:assert/strict";
import test from "node:test";

import { fakeGitHub } from "./fake-github.test-helper.js";
import {
  addToIndex,
  agentPrompt,
  collectTags,
  emptyIndex,
  ideaId,
  indexEntry,
  parseIndex,
  renderIdeaMarkdown,
  renderIndexMarkdown,
  siteOf,
  slugify,
  suggestKind,
} from "./format.js";
import { GitHubError, InspirationRepo, base64ToText, parseRepo, textToBase64 } from "./github.js";
import { saveIdea } from "./save.js";

const TOKENS = {
  colors: [
    { value: "#5e6ad2", role: "background", weight: 90 },
    { value: "#ffffff", role: "text", weight: 12 },
  ],
  backdrop: "#08090a",
  fonts: [{ family: "Inter Variable", stack: '"Inter Variable", sans-serif' }],
  type: [{ size: "14px", weight: "500", lineHeight: "20px", letterSpacing: "normal" }],
  radii: ["999px"],
  shadows: ["rgba(0, 0, 0, 0.2) 0px 1px 2px 0px"],
  gradients: [],
  spacing: ["padding 8px 16px", "gap 6px"],
  borders: [],
  motion: ["transition: transform 0.16s ease-out"],
  layout: "inline-flex · row · justify center · align center",
};

const CAPTURE = {
  url: "https://www.linear.app/pricing?ref=x",
  pageTitle: "Pricing – Linear",
  captured: "2026-10-28T09:30:00.000Z",
  element: { tag: "a", id: "", classes: "Button_root", role: "", text: "Get started", selector: "a.Button_root", width: 148.4, height: 40 },
  tokens: TOKENS,
  snippet: "<!doctype html><html><body><a style=\"color: #ffffff\">Get started</a></body></html>",
};

const FORM = {
  title: "Pill button with sliding arrow",
  note: "The arrow slides on hover and the shadow is barely there. #hover\nI want it for my contact link.",
  project: "portfolio",
  tags: ["button"],
};

const PNG = "iVBORw0KGgo=";

// ---------- format ----------

test("slugify keeps ids readable and safe", () => {
  assert.equal(slugify("Pill button — with Arrow!"), "pill-button-with-arrow");
  assert.equal(slugify("Café déjà vu"), "cafe-deja-vu");
  assert.equal(slugify("!!!"), "idea");
  assert.ok(slugify("a".repeat(100)).length <= 48);
});

test("siteOf drops www and survives bad URLs", () => {
  assert.equal(siteOf("https://www.linear.app/pricing"), "linear.app");
  assert.equal(siteOf("not a url"), "unknown-site");
});

test("ideaId is dated, readable and unique", () => {
  const date = new Date(2026, 9, 28, 12);
  const first = ideaId({ title: "Pill button", url: "https://linear.app", date });
  assert.equal(first, "2026-10-28-linear-app-pill-button");
  assert.equal(ideaId({ title: "Pill button", url: "https://linear.app", date }, [first]), `${first}-2`);
  assert.equal(ideaId({ title: "Pill button", url: "https://linear.app", date }, [first, `${first}-2`]), `${first}-3`);
});

test("suggestKind names what was picked", () => {
  assert.equal(suggestKind({ tag: "button" }), "button");
  assert.equal(suggestKind({ tag: "a", classes: "btn btn-primary" }), "button");
  assert.equal(suggestKind({ tag: "a", classes: "hero-cta" }), "button");
  assert.equal(suggestKind({ tag: "a", buttonLike: true }), "button");
  assert.equal(suggestKind({ tag: "a" }), "link");
  assert.equal(suggestKind({ tag: "nav" }), "navigation");
  assert.equal(suggestKind({ tag: "div", classes: "pricing-card" }), "card");
  assert.equal(suggestKind({ tag: "h2" }), "typography");
  assert.equal(suggestKind({ tag: "div" }), "section");
});

test("collectTags merges the kind, extra tags and spoken #hashtags", () => {
  assert.deepEqual(
    collectTags({ kind: "button", note: "love the #hover and #Dark-Mode feel, not #a", extra: ["Portfolio", "button"] }),
    ["button", "portfolio", "hover", "dark-mode"],
  );
});

test("the idea note leads with the owner's words and the real values", () => {
  const md = renderIdeaMarkdown({
    ...CAPTURE,
    id: "2026-10-28-linear-app-pill-button",
    title: FORM.title,
    site: "linear.app",
    project: "portfolio",
    tags: ["button", "hover"],
    note: FORM.note,
  });
  assert.match(md, /^---\nid: 2026-10-28-linear-app-pill-button\n/);
  assert.match(md, /title: "Pill button with sliding arrow"/);
  assert.match(md, /tags: \["button", "hover"\]/);
  assert.match(md, /## Why I like it\n\n> The arrow slides on hover and the shadow is barely there\. #hover\n> I want it for my contact link\./);
  assert.match(md, /\| Colors \| `#5e6ad2` background, `#ffffff` text \|/);
  assert.match(md, /\| Sits on \| `#08090a` \|/);
  assert.match(md, /\| Type \| `14px \/ 500 \/ 20px` \|/);
  assert.match(md, /\| Gradients \| — \|/);
  assert.match(md, /148×40/);
  assert.ok(md.indexOf("## Why I like it") < md.indexOf("## Design values"));
});

test("front matter strings are escaped", () => {
  const md = renderIdeaMarkdown({
    ...CAPTURE, id: "x", title: 'Say "hi"', site: "s", project: "", tags: [], note: "",
  });
  assert.match(md, /title: "Say \\"hi\\""/);
  assert.match(md, /> \(no note\)/);
});

test("the index stays newest first and replaces a repeated id", () => {
  const base = { title: "t", site: "s", url: "u", project: "", tags: [], note: "", element: CAPTURE.element, tokens: TOKENS };
  let index = emptyIndex();
  index = addToIndex(index, indexEntry({ ...base, id: "old", captured: "2026-10-01T00:00:00Z" }));
  index = addToIndex(index, indexEntry({ ...base, id: "new", captured: "2026-10-28T00:00:00Z" }));
  index = addToIndex(index, indexEntry({ ...base, id: "old", captured: "2026-10-01T00:00:00Z", title: "renamed" }));
  assert.deepEqual(index.ideas.map((i) => i.id), ["new", "old"]);
  assert.equal(index.ideas[1].title, "renamed");
  assert.equal(index.ideas[0].shot, "ideas/new/shot.png");
});

test("parseIndex starts fresh on a missing or broken file", () => {
  assert.deepEqual(parseIndex("").ideas, []);
  assert.deepEqual(parseIndex("{nope").ideas, []);
  assert.equal(parseIndex('{"ideas":[{"id":"a"}]}').ideas.length, 1);
});

test("INDEX.md links every idea and lists projects", () => {
  const md = renderIndexMarkdown({
    ideas: [{ id: "a", title: "Nav", path: "ideas/a/README.md", project: "portfolio", tags: ["navigation"], site: "x.com", source: "https://x.com" }],
  });
  assert.match(md, /1 idea, newest first/);
  assert.match(md, /Projects: \*\*portfolio\*\*/);
  assert.match(md, /\| \[Nav\]\(\.\/ideas\/a\/README\.md\) \| portfolio \| #navigation \| \[x\.com\]\(https:\/\/x\.com\) \|/);
});

test("the agent prompt points at the idea and says what to keep", () => {
  const prompt = agentPrompt({ id: "abc", title: "Pill" }, "https://github.com/ana/inspiration/blob/main/ideas/abc/README.md");
  assert.match(prompt, /^Use the design idea "Pill" from my inspiration library: https:\/\/github\.com\//);
  assert.match(prompt, /Why I like it/);
  assert.match(prompt, /riff:abc/);
});

// ---------- github ----------

test("parseRepo accepts names and URLs", () => {
  assert.deepEqual(parseRepo("ana/inspiration"), { owner: "ana", repo: "inspiration" });
  assert.deepEqual(parseRepo("https://github.com/ana/inspiration.git"), { owner: "ana", repo: "inspiration" });
  assert.deepEqual(parseRepo(" https://github.com/ana/my.repo/ "), { owner: "ana", repo: "my.repo" });
  assert.equal(parseRepo("inspiration"), null);
  assert.equal(parseRepo("https://gitlab.com/ana/x"), null);
});

test("base64 helpers round-trip UTF-8 and large text", () => {
  const text = "Héllo — ✨ " + "x".repeat(100_000);
  assert.equal(base64ToText(textToBase64(text)), text);
});

test("connect reports a rejected token with a way to fix it", async () => {
  const gh = fakeGitHub();
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "wrong", fetch: gh.fetch });
  await assert.rejects(repo.connect(), (error) => error instanceof GitHubError && error.status === 401 && /new fine-grained token/.test(error.hint));
});

test("connect refuses a read-only token", async () => {
  const gh = fakeGitHub({ push: false });
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "good-token", fetch: gh.fetch });
  await assert.rejects(repo.connect(), /read the repo but not write/);
});

test("an unreachable GitHub is reported, not thrown raw", async () => {
  const repo = new InspirationRepo({ owner: "a", repo: "b", token: "t", fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(repo.connect(), /Unable to reach GitHub/);
});

// ---------- save ----------

test("the first save into an empty repo creates the whole library", async () => {
  const gh = fakeGitHub({ empty: true });
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "good-token", fetch: gh.fetch });
  const result = await saveIdea(repo, CAPTURE, FORM, PNG);

  const id = result.idea.id;
  assert.match(id, /^2026-10-28-linear-app-pill-button-with-sliding-arrow$/);
  assert.deepEqual(gh.paths(), [
    "AGENTS.md", "CLAUDE.md", "INDEX.md", "README.md",
    `ideas/${id}/README.md`, `ideas/${id}/shot.png`, `ideas/${id}/snippet.html`,
    "index.json",
  ].sort());
  assert.equal(gh.commitCount(), 2, "one commit to start the branch, one for the idea");
  assert.equal(gh.lastMessage(), "riff: Pill button with sliding arrow (linear.app)");
  assert.equal(gh.readBase64(`ideas/${id}/shot.png`), PNG);
  assert.equal(gh.read(`ideas/${id}/snippet.html`), CAPTURE.snippet);
  assert.equal(gh.read("CLAUDE.md"), "@AGENTS.md\n");

  const index = JSON.parse(gh.read("index.json"));
  assert.equal(index.ideas[0].id, id);
  assert.deepEqual(index.ideas[0].tags, ["button", "portfolio", "hover"]);
  assert.deepEqual(index.ideas[0].colors, ["#5e6ad2", "#ffffff"]);
  assert.match(gh.read("INDEX.md"), new RegExp(`ideas/${id}/README\\.md`));
  assert.equal(result.ideaUrl, `https://github.com/ana/inspiration/blob/main/ideas/${id}/README.md`);
  assert.equal(result.commitUrl.startsWith("https://github.com/ana/inspiration/commit/"), true);
});

test("later saves are one commit each and keep earlier ideas", async () => {
  const gh = fakeGitHub({ empty: false });
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "good-token", fetch: gh.fetch });
  const first = await saveIdea(repo, CAPTURE, FORM, PNG);
  const second = await saveIdea(repo, { ...CAPTURE, captured: "2026-10-28T10:00:00.000Z" }, FORM, PNG);

  assert.notEqual(first.idea.id, second.idea.id, "same title on the same day gets a new id");
  assert.equal(gh.commitCount(), 3);
  const ids = JSON.parse(gh.read("index.json")).ideas.map((i) => i.id);
  assert.deepEqual(ids, [second.idea.id, first.idea.id]);
  assert.equal(gh.read("AGENTS.md")?.startsWith("# Inspiration library"), true);
});

test("a push from elsewhere mid-save is merged, not overwritten", async () => {
  const gh = fakeGitHub({ empty: false });
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "good-token", fetch: gh.fetch });
  await saveIdea(repo, CAPTURE, FORM, PNG);

  const other = JSON.parse(gh.read("index.json"));
  other.ideas.unshift({ ...other.ideas[0], id: "from-laptop", captured: "2026-10-28T11:00:00.000Z" });
  gh.pushBeforeNextUpdate("index.json", JSON.stringify(other));

  const result = await saveIdea(repo, { ...CAPTURE, captured: "2026-10-28T12:00:00.000Z" }, { ...FORM, title: "Another" }, PNG);
  const ids = JSON.parse(gh.read("index.json")).ideas.map((i) => i.id);
  assert.equal(ids[0], result.idea.id);
  assert.ok(ids.includes("from-laptop"), "the other device's idea survives");
  assert.equal(ids.length, 3);
});

test("an empty title falls back to the kind and the site", async () => {
  const gh = fakeGitHub({ empty: false });
  const repo = new InspirationRepo({ owner: "ana", repo: "inspiration", token: "good-token", fetch: gh.fetch });
  const result = await saveIdea(repo, CAPTURE, { ...FORM, title: "  " }, PNG);
  assert.equal(result.idea.title, "Button from linear.app");
});
