// Alt+R or the toolbar icon starts a capture on the current tab. The picker
// and the floating card run in the page; this worker takes the screenshot and
// saves to GitHub, so the token never enters the page.
import { agentPrompt, siteOf, suggestKind } from "./lib/format.js";
import { InspirationRepo, GitHubError, parseRepo } from "./lib/github.js";
import { saveIdea } from "./lib/save.js";
import { cropScreenshot } from "./lib/shot.js";

const RECENT_LIMIT = 20;

// The first version of Riff opened a side panel on click, and Chrome
// remembers that setting across updates; while it is on, clicking the icon
// or pressing Alt+R opens nothing. Turn it off on every start.
function resetPanelBehavior() {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(resetPanelBehavior);
chrome.runtime.onStartup.addListener(resetPanelBehavior);
resetPanelBehavior();

/** Makes a failure visible: a red "!" on the icon, its tooltip, and the options page. */
async function report(tabId, message) {
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: `Riff: ${message}` }).catch(() => {});
  await chrome.storage.local.set({ lastError: { message, at: new Date().toISOString() } }).catch(() => {});
}
const SCRIPTS = ["lib/extract.js", "content/picker.js", "content/card.js"];

async function settings() {
  return chrome.storage.local.get({ repo: "", token: "", projects: [], lastProject: "", recent: [] });
}

function canRunOn(url) {
  return /^https?:\/\//.test(url || "") && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

async function startCapture(tab) {
  const { repo, token } = await settings();
  if (!repo || !token) {
    await chrome.runtime.openOptionsPage();
    return { started: false, reason: "not-connected" };
  }
  if (!tab?.id || !canRunOn(tab.url)) {
    await chrome.action.setBadgeText({ tabId: tab?.id, text: "×" }).catch(() => {});
    await chrome.action.setTitle({ tabId: tab?.id, title: "Riff can't run on this page. Open a normal website." }).catch(() => {});
    return { started: false, reason: "blocked-page" };
  }
  await chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
  await chrome.action.setTitle({ tabId: tab.id, title: "Riff: pick something you like (Alt+R)" }).catch(() => {});
  // Inject fresh copies every time, then start the picker directly in the
  // page instead of by message, so a copy left over from before a reload can
  // never swallow the start.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: SCRIPTS });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.RiffPicker.start() });
  return { started: true };
}

chrome.action.onClicked.addListener((tab) => {
  startCapture(tab).catch((error) => report(tab?.id, `couldn't start on this page (${error?.message || error}). Reload the page and press Alt+R again.`));
});

// Lets the end-to-end test start a capture the way the toolbar icon does.
globalThis.riffStartCapture = startCapture;

function describeError(error) {
  if (error instanceof GitHubError) return error.hint ? `${error.message} ${error.hint}` : error.message;
  return String(error?.message || error);
}

async function onPicked(message, sender) {
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  const shot = await cropScreenshot(dataUrl, message.data.viewport);
  const { projects, lastProject, repo } = await settings();
  return { ok: true, shot, projects, lastProject, repo, site: siteOf(message.data.url), kind: suggestKind(message.data.element) };
}

async function onSave(message) {
  const stored = await settings();
  const parsed = parseRepo(stored.repo);
  if (!parsed || !stored.token) throw new Error("Riff isn't connected to a repo. Open Riff's settings and connect.");
  const repo = new InspirationRepo({ ...parsed, token: stored.token });
  const result = await saveIdea(repo, message.capture, message.form, message.shotBase64);

  const project = message.form.project.trim();
  const projects = project && !stored.projects.includes(project) ? [...stored.projects, project].sort() : stored.projects;
  const recent = [
    { id: result.idea.id, title: result.idea.title, url: result.ideaUrl, site: result.idea.site, project: result.idea.project, captured: result.idea.captured },
    ...stored.recent,
  ].slice(0, RECENT_LIMIT);
  await chrome.storage.local.set({ projects, lastProject: project, recent, lastError: null });

  return {
    ok: true,
    first: stored.recent.length === 0,
    id: result.idea.id,
    title: result.idea.title,
    ideaUrl: result.ideaUrl,
    repo: stored.repo,
    prompt: agentPrompt(result.idea, result.ideaUrl),
  };
}

const HANDLERS = { "riff:picked": onPicked, "riff:save": onSave };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "riff:options") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  handler(message, sender)
    .then(sendResponse)
    .catch((error) => {
      const text = describeError(error);
      report(sender.tab?.id, text);
      sendResponse({ ok: false, error: text });
    });
  return true; // keep the channel open for the async answer
});
