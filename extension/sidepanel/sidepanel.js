import { InspirationRepo, GitHubError, parseRepo } from "../lib/github.js";
import { agentPrompt, siteOf, suggestKind } from "../lib/format.js";
import { saveIdea } from "../lib/save.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["setup", "ready", "picking", "review", "saved"];
const RECENT_LIMIT = 12;

let settings = { repo: "", token: "", projects: [], lastProject: "", recent: [] };
let pickingTabId = null;
let capture = null; // { data, shotBase64 }
let lastSaved = null;

function show(view) {
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  $("open-settings").hidden = view === "setup" || !settings.token;
}

function setError(id, error) {
  const message = error instanceof GitHubError && error.hint ? `${error.message} ${error.hint}` : error ? String(error.message || error) : "";
  $(id).textContent = message;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(["repo", "token", "projects", "lastProject", "recent"]);
  settings = { ...settings, ...stored };
}

async function store(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set(patch);
}

function repoClient() {
  const parsed = parseRepo(settings.repo);
  if (!parsed || !settings.token) return null;
  return new InspirationRepo({ ...parsed, token: settings.token });
}

// ---------- connect ----------

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("setup-error", "");
  const repoText = $("setup-repo").value;
  const token = $("setup-token").value.trim() || settings.token;
  const parsed = parseRepo(repoText);
  if (!parsed) return setError("setup-error", "Enter the repo as your-name/inspiration, or paste its GitHub URL.");
  if (!token) return setError("setup-error", "Paste a fine-grained token with Contents: Read and write.");

  $("setup-submit").disabled = true;
  try {
    const repo = new InspirationRepo({ ...parsed, token });
    await repo.connect();
    await store({ repo: `${parsed.owner}/${parsed.repo}`, token });
    $("setup-token").value = "";
    await showReady();
  } catch (error) {
    setError("setup-error", error);
  } finally {
    $("setup-submit").disabled = false;
  }
});

$("open-settings").addEventListener("click", () => {
  $("setup-repo").value = settings.repo;
  $("setup-token").value = "";
  $("setup-token").placeholder = settings.token ? "Leave empty to keep the saved token" : "github_pat_…";
  show("setup");
});

// ---------- ready ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function canRunOn(url) {
  return /^https?:\/\//.test(url || "") && !/^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/.test(url);
}

async function refreshPage() {
  const tab = await activeTab();
  $("ready-site").textContent = tab?.url ? siteOf(tab.url) : "No page";
  $("ready-title").textContent = tab?.title || "";
  const ok = canRunOn(tab?.url);
  $("pick").disabled = !ok;
  setError("ready-error", ok ? "" : "Riff can't run on this page. Browser pages and the Chrome Web Store block extensions; open a normal website.");
}

function renderRecent() {
  const list = $("recent");
  list.replaceChildren();
  if (settings.recent.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing saved yet. Your ideas will show up here.";
    list.append(li);
    return;
  }
  for (const item of settings.recent) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [item.site, item.project].filter(Boolean).join(" · ");
    li.append(a, meta);
    list.append(li);
  }
}

async function showReady() {
  show("ready");
  renderRecent();
  await refreshPage();
}

chrome.tabs.onActivated.addListener(() => !$("view-ready").hidden && refreshPage());
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && !$("view-ready").hidden && refreshPage());

// ---------- picking ----------

async function startPicking() {
  setError("ready-error", "");
  const tab = await activeTab();
  if (!tab?.id || !canRunOn(tab.url)) return refreshPage();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/extract.js", "content/picker.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "riff:start" });
    pickingTabId = tab.id;
    show("picking");
  } catch (error) {
    show("ready");
    setError("ready-error", `Unable to start picking on this page (${error.message}). Reload the page and try again.`);
  }
}

$("pick").addEventListener("click", startPicking);
$("repick").addEventListener("click", startPicking);
$("cancel-pick").addEventListener("click", async () => {
  if (pickingTabId !== null) await chrome.tabs.sendMessage(pickingTabId, { type: "riff:stop" }).catch(() => {});
  pickingTabId = null;
  await showReady();
});

/** Crops the visible-tab screenshot to the element, at full device resolution. */
async function cropShot(dataUrl, viewport) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bitmap.width / viewport.innerWidth;
  const left = Math.max(0, viewport.x);
  const top = Math.max(0, viewport.y);
  const right = Math.min(viewport.innerWidth, viewport.x + viewport.width);
  const bottom = Math.min(viewport.innerHeight, viewport.y + viewport.height);
  const width = Math.round((right - left) * scale);
  const height = Math.round((bottom - top) * scale);
  if (width < 2 || height < 2) throw new Error("The element is off screen. Scroll it into view and pick again.");

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, Math.round(left * scale), Math.round(top * scale), width, height, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { base64, url: URL.createObjectURL(blob), partial: viewport.y < 0 || viewport.y + viewport.height > viewport.innerHeight };
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== pickingTabId) return;
  if (message?.type === "riff:cancelled") {
    pickingTabId = null;
    showReady();
  } else if (message?.type === "riff:error") {
    pickingTabId = null;
    showReady().then(() => setError("ready-error", `Unable to read that element: ${message.message}`));
  } else if (message?.type === "riff:picked") {
    pickingTabId = null;
    onPicked(message.data, sender.tab.windowId);
  }
});

async function onPicked(data, windowId) {
  let shot;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    shot = await cropShot(dataUrl, data.viewport);
  } catch (error) {
    await showReady();
    setError("ready-error", error.message || String(error));
    return;
  }
  capture = { data, shotBase64: shot.base64 };
  renderReview(data, shot);
}

// ---------- review ----------

function chip(text, color) {
  const span = document.createElement("span");
  span.className = "chip";
  if (color) {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");
    span.append(swatch);
  }
  span.append(text);
  return span;
}

function renderReview(data, shot) {
  const kind = suggestKind(data.element);
  const site = siteOf(data.url);
  // Small captures (a button, an icon) are shown up to 2x, on the color they sat on.
  $("shot").onload = () => {
    const img = $("shot");
    img.style.width = img.naturalWidth < 200 ? `${Math.min(img.naturalWidth * 2, 320)}px` : "";
  };
  $("shot").style.width = "";
  $("shot").parentElement.style.setProperty("--backdrop", data.tokens.backdrop || "transparent");
  $("shot").src = shot.url;
  $("shot").alt = `The ${kind} you picked on ${site}`;
  const size = `${Math.round(data.element.width)}×${Math.round(data.element.height)}`;
  $("shot-caption").textContent = `${data.element.selector} · ${size} · ${site}${shot.partial ? " · only the visible part is in the screenshot" : ""}`;

  const tokens = $("tokens");
  tokens.replaceChildren(
    ...data.tokens.colors.slice(0, 6).map((c) => chip(c.value, c.value)),
    ...data.tokens.fonts.slice(0, 2).map((f) => chip(f.family)),
    ...data.tokens.radii.slice(0, 1).map((r) => chip(`radius ${r}`)),
  );

  $("note").value = "";
  $("title").value = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} from ${site}`;
  $("project").value = settings.lastProject || "";
  $("tags").value = kind;
  $("projects").replaceChildren(...settings.projects.map((p) => Object.assign(document.createElement("option"), { value: p })));
  setError("save-error", "");
  show("review");
  $("note").focus();
}

$("idea-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!capture) return;
  const repo = repoClient();
  if (!repo) return show("setup");

  const form = {
    title: $("title").value,
    note: $("note").value,
    project: $("project").value.trim(),
    tags: $("tags").value.split(/[,\s]+/).filter(Boolean),
  };
  if (!form.note.trim()) {
    setError("save-error", "Say or type why you like it first. That's the part your agent needs most.");
    $("note").focus();
    return;
  }

  $("save").disabled = true;
  $("save").textContent = "Saving…";
  setError("save-error", "");
  try {
    const result = await saveIdea(repo, capture.data, form, capture.shotBase64);
    lastSaved = { ...result, repo };
    const projects = form.project && !settings.projects.includes(form.project) ? [...settings.projects, form.project].sort() : settings.projects;
    const recent = [
      { title: result.idea.title, url: result.ideaUrl, site: result.idea.site, project: result.idea.project },
      ...settings.recent,
    ].slice(0, RECENT_LIMIT);
    await store({ projects, lastProject: form.project, recent });
    capture = null;
    $("saved-detail").textContent = `${result.idea.title} is in ${settings.repo} as ideas/${result.idea.id}.`;
    $("saved-link").href = result.ideaUrl;
    $("copy-status").textContent = "";
    show("saved");
    $("copy-agent").focus();
  } catch (error) {
    setError("save-error", error);
  } finally {
    $("save").disabled = false;
    $("save").textContent = "Save to inspiration";
  }
});

$("note").addEventListener("input", () => setError("save-error", ""));

// Ctrl/Cmd+Enter saves from anywhere in the form, so you never leave the keyboard.
$("idea-form").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("idea-form").requestSubmit();
  }
});

// ---------- saved ----------

$("copy-agent").addEventListener("click", async () => {
  if (!lastSaved) return;
  try {
    await navigator.clipboard.writeText(agentPrompt(lastSaved.idea, lastSaved.ideaUrl));
    $("copy-status").textContent = "Copied. Paste it into Claude Code, Cursor or any agent.";
  } catch {
    $("copy-status").textContent = "Unable to copy. Open the idea on GitHub and copy its link instead.";
  }
});

$("another").addEventListener("click", showReady);

// ---------- start ----------

await loadSettings();
if (settings.repo && settings.token) await showReady();
else show("setup");
