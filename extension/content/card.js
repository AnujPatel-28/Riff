// The floating card that appears on the page after a pick: the note box is
// focused at once so Wispr Flow types straight into it, and the page keeps
// its full width. Saving happens in the background worker.
(() => {
  if (globalThis.RiffCard) return;

  let current = null;

  // One easing signature for every move (Family Values: consistent physics).
  const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
  const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)"; // Material 3 standard
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Same roles, type scale and 4/8 spacing as Riff Studio (Material 3 naming).
  // The card is always dark so it reads the same on any site.
  const STYLE = `
    :host {
      all: initial;
      --primary: #ffb0c8; --on-primary: #5e1133; --primary-container: #7b2949; --on-primary-container: #ffd9e4;
      --surface: #151214; --surface-container: #221e20; --surface-container-high: #2c282a;
      --on-surface: #ece4e8; --on-surface-variant: #d0c3ca; --outline: #998d94; --outline-variant: #4e444b;
      --error: #ffb4ab; --success: #7dd8a6;
      --ease-standard: cubic-bezier(0.2, 0, 0, 1);
    }
    * { box-sizing: border-box; }
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: min(384px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow-y: auto; overscroll-behavior: contain;
      padding: 8px 20px 20px; border-radius: 28px; background: var(--surface-container); color: var(--on-surface);
      box-shadow: 0 2px 6px rgb(0 0 0 / 0.3), 0 16px 40px rgb(0 0 0 / 0.4);
      font: 400 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .head { display: flex; align-items: center; gap: 8px; min-height: 48px; margin-bottom: 4px; }
    .title { display: flex; align-items: center; gap: 8px; margin: 0; margin-inline-end: auto; font-weight: 600; font-size: 16px; line-height: 1.3; color: var(--on-surface); }
    .mark { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; background: #ff4f8b; color: #1b1030; font-weight: 800; font-size: 12px; }
    .x { all: unset; position: relative; cursor: pointer; display: grid; place-items: center; width: 40px; height: 40px; margin-inline-end: -8px; border-radius: 50%; color: var(--on-surface-variant); font-size: 15px; }
    .x::after, button::after, a.btn::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0; transition: opacity 150ms var(--ease-standard); pointer-events: none; }
    @media (hover: hover) { .x:hover::after, button:not(:disabled):hover::after, a.btn:hover::after { opacity: 0.08; } }
    .x:active::after, button:not(:disabled):active::after, a.btn:active::after { opacity: 0.1; }
    :focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
    textarea:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: -1px; border-color: transparent; }
    .shot { display: grid; place-items: center; min-height: 72px; max-height: 160px; padding: 12px; border-radius: 16px; overflow: hidden; }
    .shot img { display: block; max-width: 100%; max-height: 136px; object-fit: contain; }
    .meta { margin: 8px 0 0; color: var(--on-surface-variant); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 24px; padding: 0 8px; border-radius: 8px; background: var(--surface-container-high); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--on-surface); overflow-wrap: anywhere; }
    .sw { width: 10px; height: 10px; flex: none; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25); }
    label { display: block; margin: 16px 0 4px; font-weight: 600; font-size: 14px; color: var(--on-surface); }
    .help { margin: 0 0 8px; color: var(--on-surface-variant); font-size: 13px; line-height: 1.4; }
    textarea, input {
      width: 100%; min-height: 40px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--outline); background: var(--surface); color: var(--on-surface);
      font: 400 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    textarea { min-height: 96px; resize: vertical; }
    textarea::placeholder, input::placeholder { color: var(--on-surface-variant); opacity: 1; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 8px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
    button, a.btn {
      all: unset; position: relative; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      min-height: 40px; padding: 8px 20px; border-radius: 999px; font-weight: 600; font-size: 14px; line-height: 1.3; text-align: center; color: var(--primary);
    }
    button.primary { background: var(--primary); color: var(--on-primary); }
    button.outlined, a.btn.outlined { box-shadow: inset 0 0 0 1px var(--outline); }
    button.text { padding-inline: 12px; }
    button:disabled { background: color-mix(in srgb, var(--on-surface) 12%, transparent); color: color-mix(in srgb, var(--on-surface) 38%, transparent); cursor: default; }
    @media (prefers-reduced-motion: no-preference) {
      button:not(:disabled):active, a.btn:active { scale: 0.97; }
      button, a.btn { transition: scale 150ms var(--ease-standard); }
    }
    .label { display: inline-block; }
    .tip { margin-inline-start: auto; color: var(--on-surface-variant); font-size: 12px; }
    kbd { font: 600 11px ui-monospace, monospace; padding: 0 4px; border-radius: 4px; background: var(--surface-container-high); }
    .error { margin: 8px 0 0; color: var(--error); font-weight: 600; font-size: 13px; }
    .error:empty { display: none; }
    details { margin-top: 12px; }
    summary { display: flex; align-items: center; gap: 8px; min-height: 40px; cursor: pointer; color: var(--on-surface-variant); font-size: 13px; list-style: none; overflow-wrap: anywhere; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "›"; display: inline-block; font-size: 16px; transition: rotate 200ms var(--ease-standard); }
    details[open] summary::before { rotate: 90deg; }
    summary b { color: var(--on-surface); font-weight: 600; }
    details label { margin-top: 8px; }
    .saved-head { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
    .saved-head .shot { flex: none; width: 88px; height: 56px; min-height: 0; padding: 6px; border-radius: 12px; }
    .saved-head .shot img { max-height: 44px; }
    .saved-text { flex: 1; min-width: 0; }
    .saved-text p { margin: 0; }
    .saved-title { color: var(--on-surface); font-weight: 600; line-height: 1.35; }
    .saved-sub { color: var(--on-surface-variant); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .check { flex: none; width: 24px; height: 24px; color: var(--success); }
    .check path { stroke-dasharray: 24; stroke-dashoffset: 0; }
    .born { margin: 16px 0 0; color: var(--on-surface); font-size: 14px; line-height: 1.45; }
    .stack { flex-direction: column; align-items: stretch; }
    .stack > * { width: 100%; }
    .status { margin: 8px 0 0; color: var(--on-surface-variant); font-size: 13px; }
    .status:empty { display: none; }
    canvas.confetti { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647; }
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

  /** Old label slides up and out, the new one slides in from below. */
  function morph(button, text) {
    const label = button.querySelector(".label") || button;
    if (reduced() || !label.animate) {
      label.textContent = text;
      return;
    }
    label.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 -6px" }], { duration: 110, easing: "ease-in" }).onfinish = () => {
      label.textContent = text;
      label.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 220, easing: EASE_OUT });
    };
  }

  /** FLIP: make `node` look like it starts at `from` (a viewport rect), then let it settle. */
  function flyFrom(node, from, duration = 460) {
    if (reduced() || !from || !node.animate) return;
    const to = node.getBoundingClientRect();
    if (!to.width || !to.height || !from.width || !from.height) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    node.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.85 },
        { transformOrigin: "0 0", transform: "none", opacity: 1 },
      ],
      { duration, easing: EASE_SPRING },
    );
  }

  /** A short burst for the one moment that deserves it: the very first save. */
  function confetti(shadow) {
    if (reduced()) return;
    const canvas = el("canvas", { class: "confetti", "aria-hidden": "true" });
    shadow.append(canvas);
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const colors = ["#ff4f8b", "#ffb3cd", "#f2a65a", "#ffffff", "#5ad1a0"];
    const originX = innerWidth - 200;
    const originY = innerHeight - 160;
    const bits = Array.from({ length: 90 }, () => ({
      x: originX, y: originY,
      vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
      size: 4 + Math.random() * 5, spin: Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    const frame = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.35;
        b.x += b.vx;
        b.y += b.vy;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin * t / 300);
        ctx.globalAlpha = Math.max(0, 1 - t / 1400);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (t < 1400) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
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
    const save = el("button", { class: "primary", type: "submit" }, el("span", { class: "label" }, "Save to inspiration"));

    // One question up front; what will be saved stays visible in one line.
    const summaryLine = el("span", {});
    const refreshSummary = () => {
      const parts = [title.value.trim() || "Untitled", project.value.trim(), tags.value.split(/[,\s]+/).filter(Boolean).map((t) => `#${t}`).join(" ")];
      summaryLine.textContent = "";
      summaryLine.append(el("b", {}, parts[0]), ...parts.slice(1).filter(Boolean).map((p) => ` · ${p}`));
    };
    for (const input of [title, project, tags]) input.addEventListener("input", refreshSummary);
    refreshSummary();

    const form = el(
      "form",
      { novalidate: "" },
      el("label", { for: "note" }, "Why do you like it?"),
      el("p", { class: "help", id: "note-help" }, "Hold your Wispr key and speak, or type. #tags work too."),
      note,
      el(
        "details",
        {},
        el("summary", {}, summaryLine),
        el("label", { for: "title" }, "Title"),
        title,
        el(
          "div",
          { class: "row" },
          el("div", {}, el("label", { for: "project" }, "Project"), project),
          el("div", {}, el("label", { for: "tags" }, "Tags"), tags),
        ),
      ),
      el("datalist", { id: "riff-projects" }, ...picked.projects.map((p) => el("option", { value: p }))),
      error,
      el(
        "div",
        { class: "actions" },
        save,
        el("button", { class: "text", type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Pick again"),
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
      morph(save, "Saving…");
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
        morph(save, "Save to inspiration");
        return;
      }
      becomeSaved(card, shotBox, result);
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

    const shotBox = el("div", { class: "shot", style: `background:${data.tokens.backdrop || "#ffffff"}` }, img);
    const card = el(
      "section",
      { class: "card", role: "dialog", "aria-label": "Save to Riff", onkeydown: (event) => event.key === "Escape" && close() },
      header(shadow, "Save to Riff"),
      shotBox,
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
    // The element you picked travels from the page into the card.
    const v = data.viewport;
    if (!reduced()) card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
    img.decode?.().catch(() => {}).finally(() => flyFrom(img, { left: v.x, top: v.y, width: v.width, height: v.height }));
    focusSoon(note);
  }

  /**
   * The same card becomes the saved card: the screenshot shrinks into a
   * thumbnail and the card eases to its new height. Nothing teleports.
   */
  function becomeSaved(card, shotBox, result) {
    const shadow = current?.shadow;
    if (!shadow) return;
    const beforeCard = card.getBoundingClientRect();
    const img = shotBox.querySelector("img");
    const beforeImg = img.getBoundingClientRect();

    const status = el("p", { class: "status", role: "status" });
    const copy = el("button", { class: "primary", type: "button" }, el("span", { class: "label" }, "Copy prompt for your agent"));
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.prompt);
        morph(copy, "Copied");
        status.textContent = "Paste it into Claude Code, Cursor or any agent.";
        setTimeout(() => current && morph(copy, "Copy prompt for your agent"), 1800);
      } catch {
        status.textContent = "Unable to copy here. Open the idea on GitHub and copy its link instead.";
      }
    });

    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("viewBox", "0 0 24 24");
    check.setAttribute("class", "check");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.16"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';

    img.removeAttribute("style");
    card.setAttribute("aria-label", "Saved to Riff");
    card.replaceChildren(
      header(shadow, "Saved"),
      el(
        "div",
        { class: "saved-head" },
        shotBox,
        el("div", { class: "saved-text" }, el("p", { class: "saved-title" }, result.title), el("p", { class: "saved-sub" }, `${result.repo} · ideas/${result.id}`)),
        check,
      ),
      result.first ? el("p", { class: "born" }, "Your inspiration library is born. Every idea from now on lands next to this one. ✦") : null,
      el(
        "div",
        { class: "actions stack" },
        copy,
        el("a", { class: "btn outlined", href: result.ideaUrl, target: "_blank", rel: "noopener" }, "View on GitHub"),
        el("button", { class: "text", type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Capture another"),
      ),
      status,
    );

    if (!reduced()) {
      const afterCard = card.getBoundingClientRect();
      card.animate(
        [{ height: `${beforeCard.height}px`, overflow: "hidden" }, { height: `${afterCard.height}px`, overflow: "hidden" }],
        { duration: 320, easing: EASE_OUT },
      );
      flyFrom(img, beforeImg, 380);
      check.querySelector("path").animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { duration: 360, delay: 160, easing: EASE_OUT, fill: "backwards" });
    }
    if (result.first) confetti(shadow);
    copy.focus({ preventScroll: true });
  }

  function showError(message) {
    const shadow = mount();
    const card = el(
      "section",
      { class: "card", role: "alertdialog", "aria-label": "Riff error", onkeydown: (event) => event.key === "Escape" && close() },
      header(shadow, "Riff"),
      el("p", { class: "error" }, message),
      el("div", { class: "actions" }, el("button", { class: "primary", type: "button", onclick: () => { close(); globalThis.RiffPicker.start(); } }, "Pick again")),
    );
    shadow.append(card);
  }

  globalThis.RiffCard = { show, showError, close };
})();
