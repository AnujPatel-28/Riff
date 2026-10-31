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
export function Library({ defaultRepo, onGetExtension }) {
  const initial = new URLSearchParams(location.search).get("repo") || defaultRepo || DEFAULT_REPO;
  const [repoInput, setRepoInput] = useState(initial);
  const [repo, setRepo] = useState(initial);
  const [state, setState] = useState({ status: "loading", ideas: [] });
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);

  const loadRepo = useCallback(async (name) => {
    setState({ status: "loading", ideas: [] });
    try {
      // The API serves the index as committed right now; raw.githubusercontent
      // caches it for 5 minutes, so a just-saved idea looked missing. Raw stays
      // as the fallback when the API's hourly limit runs out.
      let response = await fetch(`https://api.github.com/repos/${name}/contents/index.json`, {
        headers: { Accept: "application/vnd.github.raw+json" },
        cache: "no-store",
      }).catch(() => null);
      if (!response || (response.status !== 200 && response.status !== 404)) {
        response = await fetch(raw(name, "index.json"), { cache: "no-store" });
      }
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
          <button className="btn outlined" type="submit">Open</button>
        </form>
      </section>

      {state.status === "loading" && (
        <div className="empty" role="status">
          <p>Loading {repo}…</p>
        </div>
      )}
      {state.status === "missing" && (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">✦</span>
          <p className="empty-title">No public library here yet</p>
          <p>
            <b>{repo}</b> has no ideas Riff can show. Capture your first idea with the extension, or make the repo public.
          </p>
          <button className="btn primary" type="button" onClick={onGetExtension}>Get the extension</button>
        </div>
      )}
      {state.status === "error" && (
        <div className="empty error">
          <span className="empty-icon" aria-hidden="true">!</span>
          <p className="empty-title">Can't load {repo}</p>
          <p>Check the repo name and your connection, then try again. ({state.message})</p>
          <button className="btn primary" type="button" onClick={() => loadRepo(repo)}>Try again</button>
        </div>
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
            <div className="empty">
              <p className="empty-title">Nothing matches #{filter}</p>
              <p>No idea in this library has that tag or project.</p>
              <button className="btn outlined" type="button" onClick={() => setFilter("all")}>Show all ideas</button>
            </div>
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
            <a className="btn outlined" href={ideaUrl} target="_blank" rel="noopener">Open on GitHub</a>
          </div>
        </div>
      )}
    </Tray>
  );
}
