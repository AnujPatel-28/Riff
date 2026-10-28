import {
  AGENTS_MD,
  CLAUDE_MD,
  addToIndex,
  collectTags,
  ideaId,
  indexEntry,
  parseIndex,
  renderIdeaMarkdown,
  renderIndexMarkdown,
  siteOf,
  suggestKind,
} from "./format.js";

/**
 * Turns a capture plus what you said into the files of one idea, and commits
 * them with the updated index in a single commit.
 *
 * @param {import("./github.js").InspirationRepo} repo
 * @param {object} capture   what lib/extract.js returned
 * @param {{ title: string, note: string, project: string, tags: string[] }} form
 * @param {string} shotBase64 PNG of the element, base64 without the data: prefix
 */
export async function saveIdea(repo, capture, form, shotBase64) {
  let saved = null;

  const result = await repo.commit(async (read) => {
    const index = parseIndex((await read("index.json")) ?? "");
    const kind = suggestKind(capture.element);
    const title = form.title.trim() || `${capitalize(kind)} from ${siteOf(capture.url)}`;
    const project = form.project.trim();
    const id = ideaId({ title, url: capture.url, date: new Date(capture.captured) }, index.ideas.map((i) => i.id));

    const idea = {
      id,
      title,
      url: capture.url,
      site: siteOf(capture.url),
      pageTitle: capture.pageTitle,
      captured: capture.captured,
      project,
      tags: collectTags({ kind, note: form.note, extra: [...form.tags, project] }),
      note: form.note,
      element: capture.element,
      tokens: capture.tokens,
    };
    saved = idea;

    const next = addToIndex(index, indexEntry(idea));
    const files = [
      { path: `ideas/${id}/README.md`, text: renderIdeaMarkdown(idea) },
      { path: `ideas/${id}/snippet.html`, text: capture.snippet },
      { path: `ideas/${id}/shot.png`, base64: shotBase64 },
      { path: "index.json", text: `${JSON.stringify(next, null, 2)}\n` },
      { path: "INDEX.md", text: renderIndexMarkdown(next) },
    ];
    if ((await read("AGENTS.md")) === null) files.push({ path: "AGENTS.md", text: AGENTS_MD });
    if ((await read("CLAUDE.md")) === null) files.push({ path: "CLAUDE.md", text: CLAUDE_MD });
    return files;
  }, `riff: ${form.title.trim() || "new idea"} (${siteOf(capture.url)})`);

  return {
    idea: saved,
    commitUrl: result.url,
    ideaUrl: repo.fileUrl(`ideas/${saved.id}/README.md`),
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
