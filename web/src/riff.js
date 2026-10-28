// Studio's bridge to the extension's code. Everything that decides what an
// idea looks like (values, note, index, agent prompt) comes from
// ../extension/lib, so the demo produces exactly what the extension commits.
import { toPng } from "html-to-image";

import "../../extension/lib/extract.js";
import {
  AGENTS_MD,
  agentPrompt,
  collectTags,
  ideaId,
  indexEntry,
  renderIdeaMarkdown,
  siteOf,
  suggestKind,
} from "../../extension/lib/format.js";

export { agentPrompt, siteOf, suggestKind, AGENTS_MD };

const SPEAK_WPM = 150; // typical conversational speech
const TYPE_WPM = 40; // typical typing speed

/** Honest, explainable numbers for the voice note. */
export function voiceStats(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    words,
    speakSeconds: Math.round((words / SPEAK_WPM) * 60),
    typeSeconds: Math.round((words / TYPE_WPM) * 60),
  };
}

export function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

// Lumen is made up, so its ideas say so: .example is reserved for
// documentation and can never be someone's real site.
const DEMO_URL = "https://lumen.example/";
const DEMO_TITLE = "Lumen (demo site)";

/** Reads the element with the extension's extractor and renders its picture. */
export async function captureElement(el) {
  const data = { ...globalThis.RiffExtract.capture(el), url: DEMO_URL, pageTitle: DEMO_TITLE };
  data.snippet = data.snippet.replace(/Captured by Riff from \S+/, `Captured by Riff from ${DEMO_URL}`);
  const dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: true });
  return { data, shot: { dataUrl, base64: dataUrl.split(",")[1] }, kind: suggestKind(data.element), site: siteOf(data.url) };
}

/** The files the extension would commit for this idea, built in the browser. */
export function buildIdea(capture, form, existingIds = []) {
  const kind = capture.kind;
  const title = form.title.trim() || `${kind.charAt(0).toUpperCase()}${kind.slice(1)} from ${capture.site}`;
  const project = form.project.trim();
  const id = ideaId({ title, url: capture.data.url, date: new Date(capture.data.captured) }, existingIds);
  const idea = {
    id,
    title,
    url: capture.data.url,
    site: capture.site,
    pageTitle: capture.data.pageTitle,
    captured: capture.data.captured,
    project,
    tags: collectTags({ kind, note: form.note, extra: [...form.tags, project] }),
    note: form.note,
    element: capture.data.element,
    tokens: capture.data.tokens,
  };
  return {
    idea,
    entry: indexEntry(idea),
    readme: renderIdeaMarkdown(idea),
    snippet: capture.data.snippet,
  };
}
