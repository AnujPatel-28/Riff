import { InspirationRepo, parseRepo } from "../lib/github.js";

const $ = (id) => document.getElementById(id);

async function load() {
  return chrome.storage.local.get({ repo: "", token: "", recent: [] });
}

function describeError(error) {
  return error?.hint ? `${error.message} ${error.hint}` : String(error?.message || error);
}

async function render() {
  const { repo, token, recent } = await load();
  $("setup-repo").value = repo;
  $("setup-token").value = "";
  $("setup-token").placeholder = token ? "Saved. Paste a new one only to replace it." : "github_pat_…";
  $("connected").textContent = repo && token ? `Connected to ${repo}. Every idea is saved there until you change it here.` : "Not connected yet.";
  $("setup-submit").textContent = repo && token ? "Save changes" : "Connect";

  const list = $("recent");
  list.replaceChildren(
    ...(recent.length === 0
      ? [Object.assign(document.createElement("li"), { className: "empty", textContent: "Nothing saved yet. Press Alt+R on any website to start." })]
      : recent.map((item) => {
          const li = document.createElement("li");
          const a = Object.assign(document.createElement("a"), { href: item.url, target: "_blank", rel: "noopener", textContent: item.title });
          const meta = Object.assign(document.createElement("span"), { className: "meta", textContent: [item.site, item.project].filter(Boolean).join(" · ") });
          li.append(a, meta);
          return li;
        })),
  );

  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = commands.find((c) => c.name === "_execute_action")?.shortcut;
  if (shortcut) $("shortcut").textContent = shortcut;
}

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("setup-error").textContent = "";
  const stored = await load();
  const parsed = parseRepo($("setup-repo").value);
  const token = $("setup-token").value.trim() || stored.token;
  if (!parsed) {
    $("setup-error").textContent = "Enter the repo as your-name/inspiration, or paste its GitHub URL.";
    return;
  }
  if (!token) {
    $("setup-error").textContent = "Paste a fine-grained token with Contents: Read and write.";
    return;
  }
  $("setup-submit").disabled = true;
  try {
    await new InspirationRepo({ ...parsed, token }).connect();
    await chrome.storage.local.set({ repo: `${parsed.owner}/${parsed.repo}`, token });
    await render();
  } catch (error) {
    $("setup-error").textContent = describeError(error);
  } finally {
    $("setup-submit").disabled = false;
  }
});

chrome.storage.onChanged.addListener(render);
render();
