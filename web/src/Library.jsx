import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import { parseRepo } from "../../extension/lib/github.js";
import { agentPrompt } from "./riff.js";
import { MorphText, SPRING, Tray } from "./ui.jsx";

const DEFAULT_REPO = "AnujPatel-28/inspiration";
const raw = (repo, path) => `https://raw.githubusercontent.com/${repo}/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`;

/** "Why I like it" from an idea README, so the detail shows your words first. */
function whyOf(readme) {
  const match = readme.match(/## Why I like it\n\n([\s\S]*?)\n\n## /);
  return match ? match[1].replace(/^> ?/gm, "").trim() : "";
}

/** Any public inspiration repo, read straight from GitHub: no token, no server. */
export function Library({ defaultRepo }) {
  const initial = new URLSearchParams(location.search).get("repo") || defaultRepo || DEFAULT_REPO;
  const [repoInput, setRepoInput] = useState(initial);
  const [repo, setRepo] = useState(initial);
  const [state, setState] = useState({ status: "loading", ideas: [] });
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);

  const loadRepo = useCallback(async (name) => {
    setState({ status: "loading", ideas: [] });
    try {
      const response = await fetch(raw(name, "index.json"), { cache: "no-store" });
      if (response.status === 404) return setState({ status: "missing", ideas: [] });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const index = await response.json();
      setState({ status: "ready", ideas: Array.isArray(index.ideas) ? index.ideas : [] });
    } catch (error) {
      setState({ status: "error", ideas: [], message: error.message });
    }
  }, []);

  useEffect(() => {
    loadRepo(repo);
  }, [repo, loadRepo]);

  const submit = (event) => {
    event.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) return;
    const name = `${parsed.owner}/${parsed.repo}`;
    setRepo(name);
    setFilter("all");
    const url = new URL(location.href);
    url.searchParams.set("repo", name);
    history.replaceState(null, "", url);
  };

  const tags = [...new Set(state.ideas.flatMap((idea) => [idea.project, ...idea.tags]).filter(Boolean))].slice(0, 12);
  const shown = filter === "all" ? state.ideas : state.ideas.filter((idea) => idea.project === filter || idea.tags.includes(filter));

  return (
    <>
      <section className="hero compact">
        <p className="eyebrow">Library</p>
        <h1>
          {repo.split("/")[0]}'s <span className="soft">inspiration</span>
        </h1>
        <p className="lead">Every idea here was captured with Riff: a real element from a real site, its values, and the owner's own words.</p>
        <form className="repo-form" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="library-repo">Public inspiration repo</label>
          <input id="library-repo" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} spellCheck="false" autoComplete="off" />
          <button className="btn ghost" type="submit">Open</button>
        </form>
      </section>

      {state.status === "loading" && <p className="empty">Loading {repo}…</p>}
      {state.status === "missing" && (
        <div className="empty">
          <p>
            No public library at <b>{repo}</b> yet. Capture an idea with the extension, or make the repo public so it can be shown here.
          </p>
        </div>
      )}
      {state.status === "error" && (
        <p className="empty error">Unable to load {repo} ({state.message}). Check the name and your connection, then open it again.</p>
      )}

      {state.status === "ready" && (
        <section aria-label={`${repo} ideas`}>
          {tags.length > 0 && (
            <div className="filters" role="group" aria-label="Filter by project or tag">
              {["all", ...tags].map((tag) => (
                <button key={tag} type="button" className="chip-btn" aria-pressed={filter === tag} onClick={() => setFilter(tag)}>
                  {tag === "all" ? `All ${state.ideas.length}` : `#${tag}`}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="empty">Nothing here yet. Press Alt+R on any website with the extension to add the first idea.</p>
          ) : (
            <ul className="grid">
              {shown.map((idea) => (
                <motion.li key={idea.id} layout transition={SPRING}>
                  <button className="idea-card" type="button" onClick={() => setOpen(idea)}>
                    <span className="idea-shot">
                      <img src={raw(repo, idea.shot)} alt="" loading="lazy" />
                    </span>
                    <span className="idea-title">{idea.title}</span>
                    <span className="idea-note">{idea.note}</span>
                    <span className="idea-meta">
                      {idea.site}
                      {idea.project ? ` · ${idea.project}` : ""}
                    </span>
                    <span className="swatches" aria-hidden="true">
                      {idea.colors.slice(0, 5).map((c) => <i key={c} style={{ background: c }} />)}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </section>
      )}

      <IdeaTray repo={repo} idea={open} onClose={() => setOpen(null)} />
    </>
  );
}

function IdeaTray({ repo, idea, onClose }) {
  const [detail, setDetail] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!idea) return;
    setDetail(null);
    let cancelled = false;
    Promise.all([fetch(raw(repo, idea.path)).then((r) => r.text()), fetch(raw(repo, idea.snippet)).then((r) => r.text())])
      .then(([readme, snippet]) => !cancelled && setDetail({ readme, snippet }))
      .catch(() => !cancelled && setDetail({ readme: "", snippet: "" }));
    return () => {
      cancelled = true;
    };
  }, [repo, idea]);

  const ideaUrl = idea ? `https://github.com/${repo}/blob/HEAD/${idea.path}` : "";
  const copy = async () => {
    await navigator.clipboard.writeText(agentPrompt(idea, ideaUrl)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Tray open={!!idea} title={idea?.title || ""} labelId="idea-title" onClose={onClose}>
      {idea && (
        <div className="tray-body">
          <div className="shot-slot">
            <img src={raw(repo, idea.shot)} alt={idea.title} />
          </div>
          <p className="meta">
            From <a href={idea.source} target="_blank" rel="noopener">{idea.site}</a> · {new Date(idea.captured).toLocaleDateString()} · {idea.tags.map((t) => `#${t}`).join(" ")}
          </p>
          <blockquote className="why">{detail ? whyOf(detail.readme) || idea.note : idea.note}</blockquote>
          <div className="values">
            {idea.colors.map((c) => (
              <span key={c} className="value-chip"><i style={{ background: c }} aria-hidden="true" />{c}</span>
            ))}
            {idea.fonts.map((f) => <span key={f} className="value-chip">{f}</span>)}
          </div>
          {detail?.snippet && <iframe className="snippet" title="Snippet preview" sandbox="" srcDoc={detail.snippet} />}
          <div className="actions">
            <button className="btn primary" type="button" onClick={copy}>
              <MorphText text={copied ? "Copied" : "Copy prompt for your agent"} />
            </button>
            <a className="btn ghost" href={ideaUrl} target="_blank" rel="noopener">Open on GitHub</a>
          </div>
        </div>
      )}
    </Tray>
  );
}
