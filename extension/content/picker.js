// Element picker. Injected on demand by the side panel together with
// lib/extract.js; answers with a "riff:picked" or "riff:cancelled" message.
(() => {
  if (globalThis.RiffPicker) return;

  const Z = "2147483647";
  let active = null;

  function overlay() {
    const host = document.createElement("div");
    host.setAttribute("data-riff-overlay", "");
    // A shadow root keeps the page's CSS away from our overlay and ours away from the page.
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box { position: fixed; pointer-events: none; z-index: ${Z}; border: 2px solid #ff4f8b; background: rgb(255 79 139 / 0.12); border-radius: 3px; transition: all 60ms linear; }
        .tag { position: fixed; pointer-events: none; z-index: ${Z}; font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #1b1030; padding: 3px 8px; border-radius: 6px; white-space: nowrap; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); }
        .tag span { color: #ffb3cd; font-weight: 500; }
        .bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: none; z-index: ${Z}; font: 500 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #1b1030; padding: 8px 14px; border-radius: 999px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.3); }
        kbd { font: 600 11px ui-monospace, monospace; background: rgb(255 255 255 / 0.14); border-radius: 4px; padding: 1px 5px; }
        @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
      </style>
      <div class="box" hidden></div>
      <div class="tag" hidden></div>
      <div class="bar">Click what you like · <kbd>↑</kbd> <kbd>↓</kbd> bigger / smaller · <kbd>Enter</kbd> pick · <kbd>Esc</kbd> cancel</div>`;
    document.documentElement.appendChild(host);
    return { host, box: shadow.querySelector(".box"), tag: shadow.querySelector(".tag") };
  }

  function isOurs(el) {
    return el instanceof Element && el.closest("[data-riff-overlay]") !== null;
  }

  function start() {
    if (active) return;
    const ui = overlay();
    let current = null;
    const trail = []; // elements we stepped out of with ↑, so ↓ can go back

    const paint = () => {
      if (!current) return;
      const r = current.getBoundingClientRect();
      Object.assign(ui.box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      ui.box.hidden = false;
      const d = globalThis.RiffExtract.describe(current);
      ui.tag.textContent = "";
      ui.tag.append(d.selector, " ");
      const size = document.createElement("span");
      size.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
      ui.tag.append(size);
      ui.tag.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 260))}px`;
      ui.tag.style.top = `${r.top > 28 ? r.top - 26 : Math.min(r.bottom + 4, innerHeight - 24)}px`;
      ui.tag.hidden = false;
    };

    const select = (el) => {
      if (!el || isOurs(el) || el === document.documentElement || el === document.body) return;
      current = el;
      paint();
    };

    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (el && el !== current && !isOurs(el)) {
        trail.length = 0;
        select(el);
      }
    };

    const finish = (picked) => {
      stop();
      if (!picked) {
        chrome.runtime.sendMessage({ type: "riff:cancelled" });
        return;
      }
      // Let the overlay leave the screen before the side panel takes the screenshot.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          let data;
          try {
            data = globalThis.RiffExtract.capture(picked);
          } catch (error) {
            chrome.runtime.sendMessage({ type: "riff:error", message: String(error?.message || error) });
            return;
          }
          chrome.runtime.sendMessage({ type: "riff:picked", data });
        }),
      );
    };

    const onClick = (event) => {
      if (isOurs(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      finish(current || document.elementFromPoint(event.clientX, event.clientY));
    };

    const swallow = (event) => {
      if (isOurs(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "Enter" && current) {
        event.preventDefault();
        finish(current);
      } else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.body) {
        event.preventDefault();
        trail.push(current);
        select(current.parentElement);
      } else if (event.key === "ArrowDown" && current) {
        event.preventDefault();
        select(trail.pop() || current.firstElementChild || current);
      }
    };

    const onScroll = () => paint();

    addEventListener("mousemove", onMove, true);
    addEventListener("click", onClick, true);
    addEventListener("mousedown", swallow, true);
    addEventListener("mouseup", swallow, true);
    addEventListener("keydown", onKey, true);
    addEventListener("scroll", onScroll, true);
    addEventListener("resize", onScroll, true);

    active = {
      stop() {
        removeEventListener("mousemove", onMove, true);
        removeEventListener("click", onClick, true);
        removeEventListener("mousedown", swallow, true);
        removeEventListener("mouseup", swallow, true);
        removeEventListener("keydown", onKey, true);
        removeEventListener("scroll", onScroll, true);
        removeEventListener("resize", onScroll, true);
        ui.host.remove();
      },
    };
  }

  function stop() {
    active?.stop();
    active = null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "riff:start") start();
    if (message?.type === "riff:stop") stop();
  });

  globalThis.RiffPicker = { start, stop };
})();
