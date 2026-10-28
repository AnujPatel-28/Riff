export function ExtensionPage() {
  return (
    <>
      <section className="hero compact">
        <p className="eyebrow">Chrome extension</p>
        <h1>
          Capture on <span className="soft">any website</span>
        </h1>
        <p className="lead">
          Studio shows the flow on a demo page. The extension does it everywhere: press Alt+R, click what you like, say why. Each idea is
          one commit to your own repo.
        </p>
      </section>

      <ol className="install">
        <li>
          <b>Get it.</b> <a href="https://github.com/AnujPatel-28/Riff/archive/HEAD.zip">Download the source</a> and unzip it, or clone{" "}
          <code>github.com/AnujPatel-28/Riff</code>.
        </li>
        <li>
          <b>Load it.</b> Open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the{" "}
          <code>extension</code> folder.
        </li>
        <li>
          <b>Make your library.</b> Create an empty GitHub repo, for example <code>inspiration</code>.
        </li>
        <li>
          <b>Give Riff a key to it.</b> A <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>:{" "}
          Repository access → Only select repositories → your repo, then <b>Contents: Read and write</b>.
        </li>
        <li>
          <b>Capture.</b> Press <span className="kbd">Alt</span> + <span className="kbd">R</span> on any site. The first time, Riff asks for the repo and token, once.
        </li>
      </ol>

      <section className="explain" aria-labelledby="files-title">
        <h2 id="files-title">What lands in your repo</h2>
        <pre className="code">{`inspiration/
  AGENTS.md        how coding agents should use the library
  CLAUDE.md        points Claude Code at AGENTS.md
  INDEX.md         every idea, newest first, by project and tag
  index.json       the same, for this gallery
  ideas/2026-10-28-linear-app-pill-button/
    README.md      why you liked it, the real values, the source
    shot.png       the element as you saw it
    snippet.html   markup with computed styles, scripts removed`}</pre>
        <p className="help">
          Only the tab you press Alt+R on is ever read. The token stays in your browser and is only sent to api.github.com. No AI API, no
          server.
        </p>
      </section>
    </>
  );
}
