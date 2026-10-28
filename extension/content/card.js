// The floating card that appears on the page after a pick: the note box is
// focused at once so Wispr Flow types straight into it, and the page keeps
// its full width. Saving happens in the background worker.
(() => {
  if (globalThis.RiffCard) return;

  let current = null;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: min(380px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow-y: auto; overscroll-behavior: contain;
      padding: 16px; border-radius: 14px; background: #17121f; color: #e9e4f0;
      border: 1px solid #2e2639; box-shadow: 0 18px 48px rgb(0 0 0 / 0.38), 0 2px 6px rgb(0 0 0 / 0.25);
      font: 400 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .title { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 650; font-size: 15px; color: #fff; }
    .mark { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: #ff4f8b; color: #1b1030; font-weight: 800; font-size: 12px; }
    .x { all: unset; cursor: pointer; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; color: #b8aec6; }
    .x:hover { background: #2a2234; color: #fff; }
    .x:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid #ff8fb8; outline-offset: 2px; }
    .shot { display: grid; place-items: center; min-height: 64px; max-height: 150px; padding: 10px; border-radius: 10px; border: 1px solid #2e2639; overflow: hidden; }
    .shot img { display: block; max-width: 100%; max-height: 130px; object-fit: contain; }
    .meta { margin: 6px 0 8px; color: #a99fb7; font-size: 12px; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 1px 8px; border-radius: 999px; border: 1px solid #3a3146; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #d9d2e3; overflow-wrap: anywhere; }
    .sw { width: 11px; height: 11px; flex: none; border-radius: 50%; border: 1px solid rgb(255 255 255 / 0.25); }
    label { display: block; margin: 12px 0 4px; font-weight: 600; font-size: 13px; color: #fff; }
    .help { margin: 0 0 6px; color: #a99fb7; font-size: 12px; }
    textarea, input {
      width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #6f6680; background: #0f0b15; color: #fff;
      font: 400 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    textarea { min-height: 92px; resize: vertical; }
    textarea::placeholder, input::placeholder { color: #9a90a8; opacity: 1; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 8px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
    button, a.btn {
      all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      min-height: 34px; padding: 7px 13px; border-radius: 8px; border: 1px solid #3a3146; color: #fff; font-weight: 600; font-size: 13px; text-align: center;
    }
    button.primary { background: #ff4f8b; border-color: #ff4f8b; color: #1b0a12; }
    button:disabled { opacity: 0.55; cursor: default; }
    @media (prefers-reduced-motion: no-preference) {
      .card { animation: in 160ms ease-out; }
      button:not(:disabled):active, a.btn:active { scale: 0.96; }
      button, a.btn { transition: scale 150ms ease-out; }
    }
    @keyframes in { from { opacity: 0; translate: 0 8px; } to { opacity: 1; translate: 0 0; } }
    .tip { margin-left: auto; color: #a99fb7; font-size: 12px; }
    kbd { font: 600 11px ui-monospace, monospace; padding: 0 4px; border-radius: 4px; border: 1px solid #3a3146; }
    .error { margin: 8px 0 0; color: #ff9b91; font-weight: 600; font-size: 13px; }
    .error:empty { display: none; }
    .ok { padding: 10px 12px; border-radius: 10px; border: 1px solid #2e2639; border-left: 4px solid #5ad1a0; }
    .ok p { margin: 0; }
    .ok .sub { color: #a99fb7; font-size: 12px; overflow-wrap: anywhere; margin-top: 2px; }
    .stack { flex-direction: column; align-items: stretch; }
    .stack > * { width: 100%; }
    .status { margin: 8px 0 0; color: #a99fb7; font-size: 12px; }
    .status:empty { display: none; }
  `;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  function chip(text, color) {
    return el("span", { class: "chip" }, color ? el("span", { class: "sw", style: `background:${color}`, "aria-hidden": "true" }) : null, text);
  }

  function mount() {
    close();
    const host = el("div", { "data-riff-card": "" });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", {}, STYLE));
    // Keys typed into the card belong to the card, not to the page's shortcuts.
    for (const type of ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut"]) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }
    document.documentElement.append(host);
    current = { host, shadow };
    return shadow;
  }

  function close() {
    current?.host.remove();
    current = null;
  }

  function header(shadow, text) {
    return el(
      "div",
      { class: "head" },
      el("p", { class: "title" }, el("span", { class: "mark", "aria-hidden": "true" }, "R"), text),
      el("button", { class: "x", type: "button", "aria-label": "Close Riff", onclick: close }, "✕"),
    );
  }

  /** Focus the note box now, and again if the page grabs focus back right away. */
  function focusSoon(node) {
    node.focus({ preventScroll: true });
    setTimeout(() => current && node.focus({ preventScroll: true }), 120);
  }

  function show(data, picked) {
    const shadow = mount();
    const { site, kind } = picked;
    const size = `${Math.round(data.element.width)}×${Math.round(data.element.height)}`;

    const note = el("textarea", {
      id: "note",
      "aria-describedby": "note-help",
      placeholder: "The arrow slides on hover and the shadow is barely there. I want it for my contact link.",
    });
    const title = el("input", { id: "title", autocomplete: "off" });
    title.value = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} from ${site}`;
    const project = el("input", { id: "project", list: "riff-projects", autocomplete: "off", placeholder: "portfolio" });
    project.value = picked.lastProject || "";
    const tags = el("input", { id: "tags", autocomplete: "off", placeholder: "button, hover" });
    tags.value = kind;
    const error = el("p", { class: "error", role: "status" });
    const save = el("button", { class: "primary", type: "submit" }, "Save to inspiration");

    const form = el(
      "form",
      { novalidate: "" },
      el("label", { for: "note" }, "Why do you like it?"),
      el("p", { class: "help", id: "note-help" }, "Hold your Wispr key and speak, or type. #tags work too."),
      note,
      el("label", { for: "title" }, "Title"),
      title,
      el(
        "div",
        { class: "row" },
        el("div", {}, el("label", { for: "project" }, "Project"), project),
        el("div", {}, el("label", { for: "tags" }, "Tags"), tags),
      ),
      el("datalist", { id: "riff-projects" }, ...picked.projects.map((p) => el("option", { value: p }))),
      error,
      el(
        "div",
        { class: "actions" },
        save,
        el("button", { type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Pick again"),
        el("span", { class: "tip" }, el("kbd", {}, "Ctrl"), " + ", el("kbd", {}, "Enter")),
      ),
    );

    const submit = async () => {
      if (!note.value.trim()) {
        error.textContent = "Say or type why you like it first. That's the part your agent needs most.";
        note.focus();
        return;
      }
      save.disabled = true;
      save.textContent = "Saving…";
      error.textContent = "";
      const formData = {
        title: title.value,
        note: note.value,
        project: project.value.trim(),
        tags: tags.value.split(/[,\s]+/).filter(Boolean),
      };
      let result;
      try {
        result = await chrome.runtime.sendMessage({ type: "riff:save", capture: data, form: formData, shotBase64: picked.shot.base64 });
      } catch (sendError) {
        result = { ok: false, error: `Unable to reach Riff (${sendError.message}). Reload the page and try again.` };
      }
      if (!result?.ok) {
        error.textContent = result?.error || "Unable to save. Try again.";
        save.disabled = false;
        save.textContent = "Save to inspiration";
        return;
      }
      showSaved(result);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    form.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });
    note.addEventListener("input", () => (error.textContent = ""));

    const img = el("img", { alt: `The ${kind} you picked on ${site}`, src: `data:image/png;base64,${picked.shot.base64}` });
    // Small captures (a button, an icon) at up to 2x so you can see them.
    if (picked.shot.width < 200) img.style.width = `${Math.min(picked.shot.width * 2, 340)}px`;

    const card = el(
      "section",
      { class: "card", role: "dialog", "aria-label": "Save to Riff", onkeydown: (event) => event.key === "Escape" && close() },
      header(shadow, "Save to Riff"),
      el("div", { class: "shot", style: `background:${data.tokens.backdrop || "#ffffff"}` }, img),
      el("p", { class: "meta" }, `${data.element.selector} · ${size} · ${site}${picked.shot.partial ? " · only the visible part is in the screenshot" : ""}`),
      el(
        "div",
        { class: "chips" },
        ...data.tokens.colors.slice(0, 5).map((c) => chip(c.value, c.value)),
        ...data.tokens.fonts.slice(0, 2).map((f) => chip(f.family)),
        ...data.tokens.radii.slice(0, 1).map((r) => chip(`radius ${r}`)),
      ),
      form,
    );
    shadow.append(card);
    focusSoon(note);
  }

  function showSaved(result) {
    const shadow = mount();
    const status = el("p", { class: "status", role: "status" });
    const copy = el("button", { class: "primary", type: "button" }, "Copy prompt for your agent");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.prompt);
        status.textContent = "Copied. Paste it into Claude Code, Cursor or any agent.";
      } catch {
        status.textContent = "Unable to copy here. Open the idea on GitHub and copy its link instead.";
      }
    });
    const card = el(
      "section",
      { class: "card", role: "dialog", "aria-label": "Saved to Riff", onkeydown: (event) => event.key === "Escape" && close() },
      header(shadow, "Saved"),
      el("div", { class: "ok" }, el("p", {}, result.title), el("p", { class: "sub" }, `${result.repo} · ideas/${result.id}`)),
      el(
        "div",
        { class: "actions stack" },
        copy,
        el("a", { class: "btn", href: result.ideaUrl, target: "_blank", rel: "noopener" }, "View on GitHub"),
        el("button", { type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Capture another"),
      ),
      status,
    );
    shadow.append(card);
    copy.focus({ preventScroll: true });
  }

  function showError(message) {
    const shadow = mount();
    const card = el(
      "section",
      { class: "card", role: "alertdialog", "aria-label": "Riff error", onkeydown: (event) => event.key === "Escape" && close() },
      header(shadow, "Riff"),
      el("p", { class: "error" }, message),
      el("div", { class: "actions" }, el("button", { type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Pick again")),
    );
    shadow.append(card);
  }

  globalThis.RiffCard = { show, showSaved, showError, close };
})();
