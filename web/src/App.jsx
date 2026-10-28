import confetti from "canvas-confetti";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { InspirationRepo, parseRepo } from "../../extension/lib/github.js";
import { saveIdea } from "../../extension/lib/save.js";
import { ExtensionPage } from "./ExtensionPage.jsx";
import { Library } from "./Library.jsx";
import { Playground, SAMPLES } from "./Playground.jsx";
import { agentPrompt, buildIdea, captureElement, formatSeconds, voiceStats } from "./riff.js";
import { MorphText, SPRING, SlidingTabs, TabPanel, Tray } from "./ui.jsx";
import { usePicker } from "./usePicker.js";

const VIEWS = [
  { id: "studio", label: "Studio" },
  { id: "library", label: "Library" },
  { id: "extension", label: "Get the extension" },
];
const SESSION_KEY = "riff-studio-ideas";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "Meta" : "Control";
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
const THEME_KEY = "riff-studio-theme";
const THEMES = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const FIRST_KEY = "riff-studio-first-idea";
const GITHUB_KEY = "riff-studio-github";

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage: the session still works in memory.
  }
}

export default function App() {
  const [view, setView] = useState(() => (new URLSearchParams(location.search).get("repo") ? "library" : "studio"));
  const [direction, setDirection] = useState(1);
  const goTo = (next) => {
    setDirection(VIEWS.findIndex((v) => v.id === next) >= VIEWS.findIndex((v) => v.id === view) ? 1 : -1);
    setView(next);
  };

  const [github, setGithub] = useState(() => load(GITHUB_KEY, null));
  const [githubOpen, setGithubOpen] = useState(false);
  const [theme, setTheme] = useState(() => load(THEME_KEY, "system"));
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    persist(THEME_KEY, theme);
  }, [theme]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon-32.png" alt="" width="24" height="24" />
          <span>Riff</span>
          <span className="pill-note">Built voice-first with Wispr Flow</span>
        </div>
        <SlidingTabs tabs={VIEWS} value={view} onChange={goTo} label="Sections" />
        <div className="theme-switch" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn outlined small" type="button" onClick={() => setGithubOpen(true)}>
          {github ? `GitHub: ${github.repo}` : "Connect GitHub"}
        </button>
      </header>

      <main>
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          {view === "studio" && (
            <TabPanel id="studio" direction={direction}>
              <Studio github={github} onConnect={() => setGithubOpen(true)} />
            </TabPanel>
          )}
          {view === "library" && (
            <TabPanel id="library" direction={direction}>
              <Library defaultRepo={github?.repo} onGetExtension={() => goTo("extension")} />
            </TabPanel>
          )}
          {view === "extension" && (
            <TabPanel id="extension" direction={direction}>
              <ExtensionPage />
            </TabPanel>
          )}
        </AnimatePresence>
      </main>

      <GitHubTray
        open={githubOpen}
        github={github}
        onClose={() => setGithubOpen(false)}
        onChange={(next, remember) => {
          setGithub(next);
          if (next && remember) persist(GITHUB_KEY, next);
          else persist(GITHUB_KEY, null);
        }}
      />

      <footer className="footer">
        Made for <a href="https://www.wemakedevs.org/wispr" target="_blank" rel="noopener">No Hands: The Wispr Challenge</a> ·{" "}
        <a href="https://github.com/AnujPatel-28/Riff" target="_blank" rel="noopener">Source on GitHub</a> · No AI API, no account, no server.
      </footer>
    </div>
  );
}

function Studio({ github, onConnect }) {
  const reduce = useReducedMotion();
  const frameRef = useRef(null);
  const noteRef = useRef(null);
  const [mode, setMode] = useState("idle"); // idle | picking | describing | saved
  const [capture, setCapture] = useState(null);
  const [from, setFrom] = useState(null); // where the picked element was on screen
  const [form, setForm] = useState({ note: "", title: "", project: "", tags: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [ideas, setIdeas] = useState(() => load(SESSION_KEY, []));
  const [pendingSample, setPendingSample] = useState(null);

  const pick = useCallback(async (el, sample = null) => {
    setMode("describing");
    setError("");
    const rect = el.getBoundingClientRect();
    setFrom({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    try {
      const next = await captureElement(el);
      setCapture(next);
      const kind = next.kind;
      setForm({
        note: sample?.note ?? "",
        title: sample?.title ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} from Lumen`,
        project: sample?.project ?? "",
        tags: kind,
      });
    } catch (captureError) {
      setMode("idle");
      setError(`Unable to read that element: ${captureError.message}`);
    }
  }, []);
  const cancel = useCallback(() => setMode("idle"), []);
  const box = usePicker(frameRef, mode === "picking", { onPick: pick, onCancel: cancel });

  useEffect(() => {
    if (pendingSample) {
      const el = frameRef.current?.querySelector(`[data-sample="${pendingSample.target}"]`);
      setPendingSample(null);
      if (el) pick(el, pendingSample);
    }
  }, [pendingSample, pick]);

  const stats = voiceStats(form.note);

  // Ctrl/⌘+Enter saves from anywhere while the tray is open, not only from the note box.
  const saveRef = useRef(null);
  useEffect(() => {
    if (mode !== "describing") return undefined;
    const onKey = (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveRef.current?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode]);

  const save = async () => {
    if (!form.note.trim()) {
      setError("Say or type why you like it first. That's the part your agent needs most.");
      noteRef.current?.focus();
      return;
    }
    setSaving(true);
    const formData = { ...form, tags: form.tags.split(/[,\s]+/).filter(Boolean) };
    const built = buildIdea(capture, formData, ideas.map((i) => i.entry.id));
    const saved = {
      entry: built.entry,
      readme: built.readme,
      snippet: built.snippet,
      shot: capture.shot.dataUrl,
      prompt: agentPrompt(built.idea, `https://github.com/${github?.repo || "you/inspiration"}/blob/main/${built.entry.path}`),
      formData,
      capture,
      github: null,
    };
    // A beat for "Saving…" to read, so the morph is seen rather than flashed.
    await new Promise((resolve) => setTimeout(resolve, reduce ? 0 : 450));
    const next = [saved, ...ideas].slice(0, 12);
    setIdeas(next);
    persist(SESSION_KEY, next.map(({ capture: _c, ...rest }) => rest));
    setResult(saved);
    setSaving(false);
    setMode("saved");

    if (!load(FIRST_KEY, false)) {
      persist(FIRST_KEY, true);
      if (!reduce) confetti({ particleCount: 110, spread: 75, origin: { y: 0.75 }, colors: ["#ff4f8b", "#f2a65a", "#ffd2e1", "#ffffff", "#1b1030"] });
    }
  };

  saveRef.current = save;

  return (
    <LayoutGroup>
      <section className="hero">
        <p className="eyebrow">Your taste, in a repo your agents can read</p>
        <h1>
          See it. <span className="soft">Say why.</span> Keep it.
        </h1>
        <p className="lead">
          Riff saves the parts of the web you love with their real design values and your own words, as plain files in your GitHub repo.
          Claude Code, Cursor or any agent can then build with them.
        </p>
        <div className="hero-actions">
          <button className="btn primary big" type="button" onClick={() => setMode("picking")} disabled={mode === "picking"}>
            {mode === "picking" ? "Click something in Lumen below" : "Pick something you like"}
          </button>
          <div className="samples" aria-label="Try a sample">
            <span className="samples-label">or try a sample:</span>
            {SAMPLES.map((sample) => (
              <button key={sample.target} className="chip-btn" type="button" onClick={() => setPendingSample(sample)}>
                {sample.label}
              </button>
            ))}
          </div>
        </div>
        {error && mode === "idle" && (
          <p className="error" role="status">
            {error}
          </p>
        )}
      </section>

      <ol className="steps" aria-label="How Riff works">
        <li className={mode === "picking" ? "is-active" : ""}><b>1</b> Pick what you like</li>
        <li className={mode === "describing" ? "is-active" : ""}><b>2</b> Say why, with Wispr</li>
        <li className={mode === "saved" ? "is-active" : ""}><b>3</b> Agent-ready files</li>
      </ol>

      <section className="frame" aria-label="Playground: a made-up site to pick from">
        <div className="frame-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="frame-url">lumen · a made-up site to pick from</span>
          <span className={`frame-state ${mode === "picking" ? "on" : ""}`}>{mode === "picking" ? "Picking: ↑ ↓ · Esc to cancel" : "Ready"}</span>
        </div>
        <Playground frameRef={frameRef} />
      </section>

      {box && (
        <div className="pick-box" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden="true">
          <span className="pick-label">{box.label}</span>
        </div>
      )}

      <SessionLibrary
        ideas={ideas}
        onOpen={(idea) => { setResult(idea); setMode("saved"); }}
        hiddenId={mode === "saved" ? result?.entry.id : null}
        onPick={() => setPendingSample(SAMPLES[0])}
      />

      {/* Step 2: one question */}
      <Tray
        open={mode === "describing"}
        title="Why do you like it?"
        labelId="describe-title"
        onClose={() => setMode("idle")}
        initialFocus={noteRef}
      >
        <div className="tray-body">
          <div className="shot-slot" style={{ background: capture?.data.tokens.backdrop || "var(--surface-2)" }}>
            {capture && <motion.img
              src={capture.shot.dataUrl}
              alt={`The ${capture.kind} you picked`}
              initial={reduce || !from ? { opacity: 0 } : { opacity: 0.4, scale: 0.6, y: -40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ ...SPRING, delay: reduce ? 0 : 0.12 }}
            />}
            {!capture && <span className="shot-wait">Reading the element…</span>}
          </div>
          {capture && (
            <p className="meta">
              {capture.data.element.selector} · {Math.round(capture.data.element.width)}×{Math.round(capture.data.element.height)} ·{" "}
              {capture.data.tokens.colors.length} colors · {capture.data.tokens.fonts.map((f) => f.family).join(", ") || "no text"}
            </p>
          )}
          <label htmlFor="note" className="field-label">
            In your own words
          </label>
          <p className="help" id="note-help">
            Hold your Wispr key and speak, or type. <span className="kbd">#tags</span> work too.
          </p>
          <textarea
            id="note"
            ref={noteRef}
            aria-describedby="note-help note-stats"
            value={form.note}
            placeholder="The arrow slides on hover and the shadow is barely there. I want it for my contact link."
            onChange={(e) => {
              setForm({ ...form, note: e.target.value });
              setError("");
            }}
          />
          <p className="stats" id="note-stats" aria-live="polite">
            {stats.words === 0
              ? "Ready for your voice"
              : `${stats.words} words · about ${formatSeconds(stats.speakSeconds)} to say, ${formatSeconds(stats.typeSeconds)} to type`}
          </p>
          <details className="details">
            <summary>Details: title, project, tags</summary>
            <div className="details-grid">
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label>
                Project
                <input value={form.project} placeholder="portfolio" onChange={(e) => setForm({ ...form, project: e.target.value })} />
              </label>
              <label>
                Tags
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </label>
            </div>
          </details>
          {error && (
            <p className="error" role="status">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="btn primary" type="button" onClick={save} disabled={!capture || saving} aria-keyshortcuts={`${MOD}+Enter`}>
              <MorphText text={saving ? "Saving…" : "Save idea"} />
              <span className="shortcut" aria-hidden="true">{MOD_LABEL} ↵</span>
            </button>
            <button className="btn text" type="button" onClick={() => setMode("picking")}>
              Pick again
            </button>
          </div>
        </div>
      </Tray>

      {/* Step 3: the result, a different height on purpose */}
      <Tray open={mode === "saved" && !!result} title="Saved to your library" labelId="saved-title" onClose={() => setMode("idle")}>
        {result && <Result key={result.entry.id} idea={result} github={github} onConnect={onConnect} onAnother={() => setMode("picking")} onUpdate={(next) => {
          setResult(next);
          setIdeas((list) => list.map((i) => (i.entry.id === next.entry.id ? next : i)));
        }} />}
      </Tray>
    </LayoutGroup>
  );
}

function Result({ idea, github, onConnect, onAnother, onUpdate }) {
  const [tab, setTab] = useState("note");
  const [direction, setDirection] = useState(1);
  const [copied, setCopied] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState("");
  const tabs = [
    { id: "note", label: "Idea note" },
    { id: "snippet", label: "Snippet" },
    { id: "prompt", label: "Agent prompt" },
  ];
  const change = (next) => {
    setDirection(tabs.findIndex((t) => t.id === next) > tabs.findIndex((t) => t.id === tab) ? 1 : -1);
    setTab(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(idea.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setPushError("Unable to copy here. Select the prompt text and copy it instead.");
    }
  };

  const push = async () => {
    const parsed = parseRepo(github.repo);
    if (!parsed || !idea.capture) return;
    setPushing(true);
    setPushError("");
    try {
      const repo = new InspirationRepo({ ...parsed, token: github.token });
      const saved = await saveIdea(repo, idea.capture.data, idea.formData, idea.capture.shot.base64);
      onUpdate({ ...idea, github: saved.ideaUrl, prompt: agentPrompt(saved.idea, saved.ideaUrl) });
    } catch (error) {
      setPushError(error.hint ? `${error.message} ${error.hint}` : error.message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="tray-body">
      <div className="result-head">
        <motion.img layoutId={`shot-${idea.entry.id}`} className="result-shot" src={idea.shot} alt="" transition={SPRING} />
        <div>
          <p className="result-title">{idea.entry.title}</p>
          <p className="meta">ideas/{idea.entry.id}/ · {idea.entry.tags.map((t) => `#${t}`).join(" ")}</p>
        </div>
        <svg className="result-check" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.16" />
          <motion.path
            d="M7 12.5l3.2 3.2L17 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.36, delay: 0.15, ease: [0.2, 0, 0, 1] }}
          />
        </svg>
      </div>
      <SlidingTabs tabs={tabs} value={tab} onChange={change} label="Idea files" />
      <div className="tab-stage">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "note" && (
            <TabPanel id="note" direction={direction}>
              <pre className="code" tabIndex={0} aria-label="README.md">{idea.readme}</pre>
            </TabPanel>
          )}
          {tab === "snippet" && (
            <TabPanel id="snippet" direction={direction}>
              <iframe className="snippet" title="Snippet preview" sandbox="" srcDoc={idea.snippet} />
              <p className="help">Rendered from snippet.html: markup with computed styles, scripts removed. Reference, not code to ship.</p>
            </TabPanel>
          )}
          {tab === "prompt" && (
            <TabPanel id="prompt" direction={direction}>
              <pre className="code" tabIndex={0} aria-label="Agent prompt">{idea.prompt}</pre>
            </TabPanel>
          )}
        </AnimatePresence>
      </div>
      {pushError && (
        <p className="error" role="status">
          {pushError}
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={copy}>
          <MorphText text={copied ? "Copied" : "Copy prompt for your agent"} />
        </button>
        {idea.github ? (
          <a className="btn outlined" href={idea.github} target="_blank" rel="noopener">View on GitHub</a>
        ) : github && idea.capture ? (
          <button className="btn outlined" type="button" onClick={push} disabled={pushing}>
            <MorphText text={pushing ? "Saving to GitHub…" : `Save to ${github.repo}`} />
          </button>
        ) : !github ? (
          <button className="btn outlined" type="button" onClick={onConnect}>Connect GitHub to keep it</button>
        ) : null}
        <button className="btn text" type="button" onClick={onAnother}>Pick another</button>
      </div>
    </div>
  );
}

function SessionLibrary({ ideas, onOpen, hiddenId, onPick }) {
  return (
    <section className="session" aria-labelledby="session-title">
      <div className="section-head">
        <h2 id="session-title">Your session</h2>
        <p className="help">Ideas you saved here, in this browser. Connect GitHub to keep them in your repo.</p>
      </div>
      {ideas.length === 0 ? (
        <div className="empty">
          <motion.span
            className="empty-icon"
            aria-hidden="true"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            ↑
          </motion.span>
          <p className="empty-title">No ideas yet</p>
          <p>Pick something in Lumen above and say why you like it, or start from a ready-made example. It lands here, ready for your agent.</p>
          <button className="btn outlined" type="button" onClick={onPick}>Try a sample</button>
        </div>
      ) : (
        <ul className="grid">
          {ideas.map((idea) => (
            <li key={idea.entry.id}>
              <button className="idea-card" type="button" onClick={() => onOpen(idea)}>
                <span className="idea-shot" style={{ background: idea.capture?.data.tokens.backdrop || "#0d0f14" }}>
                  {idea.entry.id !== hiddenId && <motion.img layoutId={`shot-${idea.entry.id}`} src={idea.shot} alt="" transition={SPRING} />}
                </span>
                <span className="idea-title">{idea.entry.title}</span>
                <span className="idea-note">{idea.entry.note}</span>
                <span className="swatches" aria-hidden="true">
                  {idea.entry.colors.slice(0, 5).map((c) => <i key={c} style={{ background: c }} />)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GitHubTray({ open, github, onClose, onChange }) {
  const [repo, setRepo] = useState(github?.repo || "");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const repoRef = useRef(null);

  const connect = async (event) => {
    event.preventDefault();
    setError("");
    const parsed = parseRepo(repo);
    if (!parsed) return setError("Enter the repo as your-name/inspiration, or paste its GitHub URL.");
    if (!token.trim()) return setError("Paste a fine-grained token for that repo with Contents: Read and write.");
    setBusy(true);
    try {
      await new InspirationRepo({ ...parsed, token: token.trim() }).connect();
      onChange({ repo: `${parsed.owner}/${parsed.repo}`, token: token.trim() }, remember);
      setToken("");
      onClose();
    } catch (connectError) {
      setError(connectError.hint ? `${connectError.message} ${connectError.hint}` : connectError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tray open={open} title={github ? "Your GitHub repo" : "Connect GitHub"} labelId="github-title" onClose={onClose} initialFocus={repoRef}>
      <form className="tray-body" onSubmit={connect} noValidate>
        <p className="lead small">
          Optional. Studio works without it; connecting lets <b>Save</b> commit ideas to your own repo, exactly like the extension.
        </p>
        <label className="field-label" htmlFor="gh-repo">Repo</label>
        <input id="gh-repo" ref={repoRef} value={repo} placeholder="your-name/inspiration" autoComplete="off" spellCheck="false" onChange={(e) => setRepo(e.target.value)} />
        <label className="field-label" htmlFor="gh-token">Token</label>
        <p className="help" id="gh-token-help">
          A <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>: Repository access → Only select repositories → your repo, then Contents: Read and write. Sent only to api.github.com.
        </p>
        <input id="gh-token" type="password" value={token} placeholder={github ? "Paste a new token to change it" : "github_pat_…"} autoComplete="off" spellCheck="false" aria-describedby="gh-token-help" onChange={(e) => setToken(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
        </label>
        {error && <p className="error" role="status">{error}</p>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>
            <MorphText text={busy ? "Checking…" : "Connect"} />
          </button>
          {github && (
            <button className="btn text" type="button" onClick={() => { onChange(null, false); onClose(); }}>
              Disconnect
            </button>
          )}
        </div>
      </form>
    </Tray>
  );
}
