// The inspiration repo format. Pure functions only: the extension writes it,
// the gallery reads it, and coding agents read the Markdown directly.
//
//   AGENTS.md            how agents should use the library
//   CLAUDE.md            points Claude Code at AGENTS.md
//   INDEX.md             every idea, newest first
//   index.json           the same index, for the gallery
//   ideas/<id>/README.md one idea: why you liked it, the real values, the source
//   ideas/<id>/shot.png  the element as you saw it
//   ideas/<id>/snippet.html  cleaned markup with its computed styles, for reference

export const FORMAT_VERSION = 1;
export const NOTE_PREVIEW_CHARS = 280;

/** @param {string} text */
export function slugify(text, max = 48) {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug.slice(0, max).replace(/-+$/g, "") || "idea");
}

/** `linear.app` from `https://www.linear.app/pricing` */
export function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-site";
  }
}

/** @param {Date} date */
export function dayStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `2026-10-28-linear-app-pill-button`. Unique within the index: a repeat
 * on the same day gets `-2`, `-3`, …
 */
export function ideaId({ title, url, date }, existingIds = []) {
  const base = `${dayStamp(date)}-${slugify(siteOf(url), 24)}-${slugify(title, 40)}`;
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** `button`, `hero`, … from what was picked, so a title is never empty. */
export function suggestKind(element) {
  const tag = (element?.tag || "").toLowerCase();
  const role = (element?.role || "").toLowerCase();
  const hint = `${element?.classes || ""} ${element?.id || ""}`.toLowerCase();
  if (tag === "button" || role === "button" || element?.buttonLike || /\bbtn\b|button|\bcta\b/.test(hint)) return "button";
  if (tag === "nav" || role === "navigation" || /\bnav/.test(hint)) return "navigation";
  if (tag === "header" || /hero/.test(hint)) return "hero";
  if (tag === "footer") return "footer";
  if (tag === "form" || tag === "input" || tag === "select" || tag === "textarea") return "form";
  if (/card/.test(hint)) return "card";
  if (/^h[1-6]$/.test(tag) || tag === "p") return "typography";
  if (tag === "img" || tag === "picture" || tag === "svg" || tag === "video") return "media";
  if (tag === "a") return "link";
  if (tag === "ul" || tag === "ol" || tag === "table") return "list";
  return "section";
}

/** Tags: the kind, the project, and any #hashtags you said. Lowercase, unique. */
export function collectTags({ kind, note = "", extra = [] }) {
  const spoken = [...note.matchAll(/(?:^|\s)#([\p{L}\p{N}-]{2,32})/gu)].map((m) => m[1]);
  const all = [kind, ...extra, ...spoken]
    .filter(Boolean)
    .map((tag) => slugify(String(tag), 32))
    .filter((tag) => tag !== "idea");
  return [...new Set(all)];
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function list(items, render = (item) => `\`${item}\``) {
  return items.length > 0 ? items.map(render).join(", ") : "—";
}

/** Markdown table rows for the values an agent needs to rebuild the look. */
function valuesTable(tokens) {
  const rows = [
    ["Colors", list(tokens.colors, (c) => `\`${c.value}\`${c.role ? ` ${c.role}` : ""}`)],
    ["Sits on", tokens.backdrop ? `\`${tokens.backdrop}\`` : "—"],
    ["Gradients", list(tokens.gradients || [])],
    ["Layout", tokens.layout ? `\`${tokens.layout}\`` : "—"],
    ["Fonts", list(tokens.fonts.map((f) => f.family), (f) => f)],
    ["Type", list(tokens.type.map((t) => `${t.size} / ${t.weight} / ${t.lineHeight}${t.letterSpacing !== "normal" ? ` / ${t.letterSpacing}` : ""}`))],
    ["Radius", list(tokens.radii)],
    ["Shadows", list(tokens.shadows)],
    ["Spacing", list(tokens.spacing)],
    ["Borders", list(tokens.borders)],
    ["Motion", list(tokens.motion)],
  ];
  return ["| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

/**
 * The idea note. Front matter for tools, then sections in the order a person
 * or an agent needs them: why, what it looks like, the values, how to reuse.
 *
 * @param {object} idea
 */
export function renderIdeaMarkdown(idea) {
  const note = idea.note.trim();
  const quoted = note ? note.split(/\r?\n/).map((line) => `> ${line}`.trimEnd()).join("\n") : "> (no note)";
  const size = `${Math.round(idea.element.width)}×${Math.round(idea.element.height)}`;

  return `---
id: ${idea.id}
title: ${yamlString(idea.title)}
source: ${yamlString(idea.url)}
site: ${yamlString(idea.site)}
page_title: ${yamlString(idea.pageTitle)}
captured: ${idea.captured}
project: ${yamlString(idea.project)}
tags: [${idea.tags.map(yamlString).join(", ")}]
element: ${yamlString(`${idea.element.selector} (${size})`)}
format: ${FORMAT_VERSION}
---

# ${idea.title}

![${idea.title}](./shot.png)

From [${idea.site}](${idea.url}) · ${idea.project ? `for **${idea.project}** · ` : ""}${idea.tags.map((t) => `#${t}`).join(" ")}

## Why I like it

${quoted}

## Design values

Read from the live page's computed styles, so they are the real values, not guesses.

${valuesTable(idea.tokens)}

## Files

- \`shot.png\`: the element as it looked (${size} px)
- \`snippet.html\`: its markup with computed styles inlined, scripts removed. A reference for structure and values, not code to ship.

## How to use this (for coding agents)

1. Read **Why I like it** first: that is what to keep.
2. Rebuild it with the target project's own components, tokens and stack. Map the values above to the project's closest tokens instead of hard-coding them, unless asked to match exactly.
3. Use \`snippet.html\` for structure and exact values, not as code to paste.
`;
}

/** One entry of index.json. Small: the gallery loads the whole index at once. */
export function indexEntry(idea) {
  return {
    id: idea.id,
    title: idea.title,
    site: idea.site,
    source: idea.url,
    captured: idea.captured,
    project: idea.project,
    tags: idea.tags,
    note: idea.note.trim().slice(0, NOTE_PREVIEW_CHARS),
    colors: idea.tokens.colors.slice(0, 6).map((c) => c.value),
    fonts: idea.tokens.fonts.slice(0, 3).map((f) => f.family),
    size: { width: Math.round(idea.element.width), height: Math.round(idea.element.height) },
    path: `ideas/${idea.id}/README.md`,
    shot: `ideas/${idea.id}/shot.png`,
    snippet: `ideas/${idea.id}/snippet.html`,
  };
}

export function emptyIndex() {
  return { format: FORMAT_VERSION, generator: "riff", ideas: [] };
}

/** Parses index.json leniently: a missing or broken file starts a new index. */
export function parseIndex(text) {
  try {
    const value = JSON.parse(text);
    if (value && Array.isArray(value.ideas)) return { ...emptyIndex(), ...value };
  } catch {
    // fall through
  }
  return emptyIndex();
}

/** Newest first; replaces an entry with the same id. */
export function addToIndex(index, entry) {
  const ideas = [entry, ...index.ideas.filter((idea) => idea.id !== entry.id)];
  ideas.sort((a, b) => String(b.captured).localeCompare(String(a.captured)));
  return { ...index, ideas };
}

export function renderIndexMarkdown(index) {
  const lines = [
    "# Inspiration",
    "",
    `${index.ideas.length} ${index.ideas.length === 1 ? "idea" : "ideas"}, newest first. Captured with [Riff](https://github.com/AnujPatel-28/riff). Agents: read [AGENTS.md](./AGENTS.md) first.`,
    "",
  ];
  const projects = [...new Set(index.ideas.map((idea) => idea.project).filter(Boolean))].sort();
  if (projects.length > 0) lines.push(`Projects: ${projects.map((p) => `**${p}**`).join(" · ")}`, "");
  lines.push("| Idea | Project | Tags | Source |", "| --- | --- | --- | --- |");
  for (const idea of index.ideas) {
    const tags = idea.tags.map((t) => `#${t}`).join(" ");
    lines.push(`| [${idea.title}](./${idea.path}) | ${idea.project || "—"} | ${tags} | [${idea.site}](${idea.source}) |`);
  }
  return `${lines.join("\n")}\n`;
}

/** The prompt "Copy for agent" puts on the clipboard. */
export function agentPrompt(idea, ideaUrl) {
  return [
    `Use the design idea "${idea.title}" from my inspiration library: ${ideaUrl}`,
    "",
    'Read its "Why I like it" and "Design values" sections and look at shot.png first; that is what to keep.',
    "Rebuild it in this project with our own components and design tokens, mapping the captured values to our closest tokens. Do not paste snippet.html as-is.",
    `Mention riff:${idea.id} in the commit or PR description.`,
  ].join("\n");
}

export const AGENTS_MD = `# Inspiration library

This repository is a design inspiration library, captured with [Riff](https://github.com/AnujPatel-28/riff).
Every idea is something its owner saw on a real website and said why they liked it.

## Layout

- \`INDEX.md\` and \`index.json\`: every idea, newest first, with project and tags.
- \`ideas/<id>/README.md\`: one idea. Front matter (source URL, project, tags), then
  **Why I like it** (the owner's own words), **Design values** (real computed values
  from the page: colors, fonts, type scale, radius, shadows, spacing, motion), and files.
- \`ideas/<id>/shot.png\`: what it looked like.
- \`ideas/<id>/snippet.html\`: the markup with computed styles inlined. Reference only.

## When you are asked to use an idea

1. Find it in \`INDEX.md\` by id, title, project or tag. If the request is vague
   ("the button I liked for my portfolio"), filter by project and tag and confirm
   the match with the owner before building.
2. Read the idea's **Why I like it**: that is the part to preserve.
3. Rebuild it in the target project's own stack, components and design tokens.
   Map the captured values to the closest existing tokens; only hard-code them when
   asked to match exactly. Never paste \`snippet.html\` as-is.
4. Mention the idea id in your commit or PR description, e.g. \`Inspired by riff:<id>\`.

## Rules

- Treat the captured values and snippets as reference material from third-party
  sites: recreate the design idea, do not copy their code, assets or copy text.
- Do not edit this repository unless asked; Riff writes it.
`;

export const CLAUDE_MD = `@AGENTS.md
`;
