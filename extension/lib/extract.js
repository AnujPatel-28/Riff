// Runs inside the page (injected by the side panel, never on its own).
// Reads the picked element's real computed styles and builds a cleaned,
// self-contained snippet. Classic script on purpose: content scripts injected
// with chrome.scripting cannot be ES modules.
(() => {
  if (globalThis.RiffExtract) return;

  const MAX_NODES = 400;
  const MAX_SNIPPET_CHARS = 300_000;

  // Properties worth keeping in a snippet. Layout first, then box, then type,
  // then paint, so the inline style reads top to bottom like hand-written CSS.
  const SNIPPET_PROPS = [
    "display", "position", "top", "right", "bottom", "left", "z-index",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self", "flex-grow", "flex-shrink", "flex-basis", "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
    "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top", "border-right", "border-bottom", "border-left", "border-radius", "outline",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-align", "text-decoration", "white-space",
    "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "box-shadow", "text-shadow", "opacity", "filter", "backdrop-filter", "mix-blend-mode", "transform",
    "overflow", "object-fit", "cursor", "transition", "animation",
    "fill", "stroke", "stroke-width",
  ];

  // Values that are almost always browser defaults; leaving them out keeps
  // the snippet readable without changing how it renders.
  const DEFAULTS = new Set([
    "", "normal", "none", "auto", "0px", "0", "0s", "static", "visible", "start", "stretch", "nowrap", "row",
    "rgba(0, 0, 0, 0)", "transparent", "repeat", "0% 0%", "1", "0px none rgb(0, 0, 0)", "content-box",
    "all 0s ease 0s", "none 0s ease 0s 1 normal none running", "baseline", "ltr", "0 1 auto",
  ]);
  const ALWAYS_KEEP = new Set(["display", "width", "height", "color", "font-family", "font-size", "font-weight", "line-height"]);

  const PSEUDOS = ["::before", "::after"];

  function rgbToHex(value) {
    const m = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
    if (!m) return value;
    const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    let alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    if (!Number.isFinite(alpha)) alpha = 1;
    const hex = (n) => n.toString(16).padStart(2, "0");
    const base = `#${hex(r)}${hex(g)}${hex(b)}`;
    return alpha >= 1 ? base : `${base}${hex(Math.round(alpha * 255))}`;
  }

  function isTransparent(value) {
    return !value || value === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(value) || /\/\s*0\)$/.test(value);
  }

  /** Colors inside a box-shadow / gradient string. */
  function colorsIn(value) {
    return value.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b|oklch\([^)]+\)|color\([^)]+\)/gi) || [];
  }

  function firstFamily(stack) {
    return stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
  }

  function hasOwnText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) return true;
    }
    return false;
  }

  function counted() {
    const map = new Map();
    return {
      add(key, weight = 1, extra) {
        if (!key) return;
        const entry = map.get(key) || { value: key, count: 0, ...extra };
        entry.count += weight;
        map.set(key, entry);
      },
      top(limit) {
        return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
      },
    };
  }

  function walk(root, limit) {
    const nodes = [];
    const stack = [root];
    while (stack.length > 0 && nodes.length < limit) {
      const el = stack.shift();
      nodes.push(el);
      for (const child of el.children) stack.push(child);
    }
    return { nodes, truncated: stack.length > 0 };
  }

  function visible(style) {
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  }

  /** Nearest painted background behind the element, for context. */
  function backdropOf(el) {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (!isTransparent(bg)) return rgbToHex(bg);
    }
    return "#ffffff";
  }

  function borderOf(style, side) {
    const width = style.getPropertyValue(`border-${side}-width`);
    const kind = style.getPropertyValue(`border-${side}-style`);
    if (width === "0px" || kind === "none") return null;
    return `${width} ${kind} ${rgbToHex(style.getPropertyValue(`border-${side}-color`))}`;
  }

  function boxShorthand(style, prop) {
    const [t, r, b, l] = ["top", "right", "bottom", "left"].map((side) => style.getPropertyValue(`${prop}-${side}`));
    if ([t, r, b, l].every((v) => v === "0px")) return null;
    if (t === b && r === l) return t === r ? t : `${t} ${r}`;
    return `${t} ${r} ${b} ${l}`;
  }

  function tokensOf(nodes, root) {
    const colors = counted();
    const fonts = counted();
    const type = counted();
    const radii = counted();
    const shadows = counted();
    const spacing = counted();
    const borders = counted();
    const motion = counted();
    const gradients = counted();

    const addColor = (value, role, weight = 1) => {
      if (isTransparent(value)) return;
      colors.add(rgbToHex(value), weight, { role });
    };

    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (!visible(style)) continue;
      const area = Math.max(1, el.getBoundingClientRect().width * el.getBoundingClientRect().height);

      addColor(style.backgroundColor, "background", Math.sqrt(area));
      if (hasOwnText(el)) {
        const chars = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).reduce((sum, n) => sum + n.textContent.trim().length, 0);
        addColor(style.color, "text", chars);
        fonts.add(firstFamily(style.fontFamily), chars, { family: firstFamily(style.fontFamily), stack: style.fontFamily });
        const key = `${style.fontSize}|${style.fontWeight}|${style.lineHeight}|${style.letterSpacing}`;
        type.add(key, chars, { size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing });
      }
      if (el instanceof SVGElement) {
        if (style.fill && style.fill !== "none") addColor(style.fill, "icon");
        if (style.stroke && style.stroke !== "none") addColor(style.stroke, "icon");
      }
      for (const side of ["top", "right", "bottom", "left"]) {
        const border = borderOf(style, side);
        if (border) {
          borders.add(border);
          addColor(style.getPropertyValue(`border-${side}-color`), "border");
        }
      }
      if (style.borderRadius && style.borderRadius !== "0px") radii.add(style.borderRadius);
      if (style.boxShadow && style.boxShadow !== "none") {
        shadows.add(style.boxShadow);
        for (const c of colorsIn(style.boxShadow)) addColor(c, "shadow");
      }
      if (style.textShadow && style.textShadow !== "none") shadows.add(`text: ${style.textShadow}`);
      if (style.backgroundImage && style.backgroundImage.includes("gradient")) {
        gradients.add(style.backgroundImage);
        for (const c of colorsIn(style.backgroundImage)) addColor(c, "gradient");
      }
      const padding = boxShorthand(style, "padding");
      if (padding) spacing.add(`padding ${padding}`);
      if ((style.display.includes("flex") || style.display.includes("grid")) && style.gap && style.gap !== "normal" && style.gap !== "0px") {
        spacing.add(`gap ${style.gap}`);
      }
      if (style.transitionDuration && style.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) {
        motion.add(`transition: ${style.transition}`);
      }
      if (style.animationName && style.animationName !== "none") {
        motion.add(`animation: ${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`);
      }
    }

    const rootStyle = getComputedStyle(root);
    const layout = [rootStyle.display];
    if (rootStyle.display.includes("flex")) layout.push(rootStyle.flexDirection, `justify ${rootStyle.justifyContent}`, `align ${rootStyle.alignItems}`);
    if (rootStyle.display.includes("grid")) layout.push(`columns ${rootStyle.gridTemplateColumns}`);

    return {
      colors: colors.top(10).map(({ value, role, count }) => ({ value, role, weight: Math.round(count) })),
      backdrop: backdropOf(root.parentElement),
      fonts: fonts.top(4).map(({ family, stack }) => ({ family, stack })),
      type: type.top(6).map(({ size, weight, lineHeight, letterSpacing }) => ({ size, weight, lineHeight, letterSpacing }))
        .sort((a, b) => parseFloat(b.size) - parseFloat(a.size)),
      radii: radii.top(6).map((e) => e.value),
      shadows: shadows.top(4).map((e) => e.value),
      gradients: gradients.top(3).map((e) => e.value),
      spacing: spacing.top(8).map((e) => e.value),
      borders: borders.top(4).map((e) => e.value),
      motion: motion.top(4).map((e) => e.value),
      layout: layout.join(" · "),
    };
  }

  const INHERITED = new Set([
    "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
    "text-transform", "text-align", "white-space", "cursor", "fill", "stroke", "stroke-width",
  ]);
  const SVG_ONLY = new Set(["fill", "stroke", "stroke-width"]);
  const MEDIA_ONLY = new Set(["object-fit"]);

  /**
   * Inline style for one element: non-default values only, inherited values
   * only where they change, SVG and media properties only where they apply.
   */
  function styleText(style, { root = false, parent = null, svg = false, media = false } = {}) {
    const parts = [];
    for (const prop of SNIPPET_PROPS) {
      if (SVG_ONLY.has(prop) && !svg) continue;
      if (MEDIA_ONLY.has(prop) && !media) continue;
      let value = style.getPropertyValue(prop);
      const keep = root && ALWAYS_KEEP.has(prop);
      if (!keep && DEFAULTS.has(value)) continue;
      if (!keep && parent && INHERITED.has(prop) && parent.getPropertyValue(prop) === value) continue;
      if ((prop === "row-gap" || prop === "column-gap") && value === style.getPropertyValue("gap")) continue;
      if (prop.startsWith("border-") && !prop.includes("radius") && /^0px\s/.test(value)) continue;
      if (prop === "outline" && /none/.test(value)) continue;
      if (/color|fill|stroke$/.test(prop)) value = rgbToHex(value);
      if (prop === "box-shadow" || prop === "text-shadow" || prop === "background-image" || prop === "border-top" || prop === "border-right" || prop === "border-bottom" || prop === "border-left" || prop === "outline") {
        value = value.replace(/rgba?\([^)]+\)/g, rgbToHex);
      }
      parts.push(`${prop}: ${value}`);
    }
    return parts.join("; ");
  }

  function absolutize(value) {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  }

  const DROP_TAGS = new Set(["SCRIPT", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "LINK", "META", "STYLE", "BASE"]);
  const URL_ATTRS = ["src", "href", "poster", "xlink:href"];

  function cleanAttributes(clone) {
    for (const attr of [...clone.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name.startsWith("data-") || name === "nonce" || name === "integrity") {
        clone.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.includes(name)) {
        if (/^\s*javascript:/i.test(attr.value)) clone.removeAttribute(attr.name);
        else clone.setAttribute(attr.name, absolutize(attr.value));
      }
      if (name === "srcset") {
        clone.setAttribute(
          attr.name,
          attr.value.split(",").map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            return [absolutize(url), ...rest].join(" ");
          }).join(", "),
        );
      }
    }
  }

  function pseudoRule(el, pseudo, id) {
    const style = getComputedStyle(el, pseudo);
    if (!style.content || style.content === "none" || style.content === "normal") return "";
    return `[data-riff="${id}"]${pseudo} { content: ${style.content}; ${styleText(style, { parent: getComputedStyle(el) })} }`;
  }

  function buildSnippet(root, nodes, tokens, meta) {
    const keep = new Set(nodes);
    const pseudoRules = [];
    let pseudoId = 0;

    const rootRect = root.getBoundingClientRect();
    const cloneNode = (el) => {
      if (DROP_TAGS.has(el.tagName)) return null;
      const clone = el.cloneNode(false);
      cleanAttributes(clone);
      const isRoot = el === root;
      let css = styleText(getComputedStyle(el), {
        root: isRoot,
        parent: isRoot || !el.parentElement ? null : getComputedStyle(el.parentElement),
        svg: el instanceof SVGElement,
        media: /^(IMG|VIDEO|PICTURE|CANVAS)$/.test(el.tagName),
      });
      if (isRoot) {
        // Out of its page the element keeps its own width and sits in the flow.
        css = css
          .replace(/(^|; )width: [^;]+/, `$1width: ${Math.round(rootRect.width)}px`)
          .replace(/(^|; )position: (fixed|sticky|absolute)/, "$1position: relative")
          .replace(/(^|; )(top|right|bottom|left): [^;]+/g, "");
      }
      // Written as text, never through el.style, so Chrome does not rewrite
      // our hex colors and longhands into rgb() and shorthands.
      if (css) clone.setAttribute("style", css);
      const rules = PSEUDOS.map((p) => pseudoRule(el, p, pseudoId)).filter(Boolean);
      if (rules.length > 0) {
        clone.setAttribute("data-riff", String(pseudoId));
        pseudoRules.push(...rules);
        pseudoId += 1;
      }
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode(false));
        else if (child.nodeType === Node.ELEMENT_NODE && keep.has(child)) {
          const next = cloneNode(child);
          if (next) clone.appendChild(next);
        }
      }
      return clone;
    };

    const tree = cloneNode(root);

    const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    let html = `<!doctype html>
<html lang="${escapeHtml(document.documentElement.lang || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<!-- Captured by Riff from ${escapeHtml(meta.url)} on ${meta.captured}. Reference only: computed styles inlined, scripts removed. -->
<style>
  body { margin: 0; padding: 32px; background: ${tokens.backdrop}; display: flex; justify-content: center; align-items: flex-start; }
${pseudoRules.map((rule) => `  ${rule}`).join("\n")}
</style>
</head>
<body>
${tree.outerHTML}
</body>
</html>
`;
    if (html.length > MAX_SNIPPET_CHARS) {
      html = html.slice(0, MAX_SNIPPET_CHARS) + "\n<!-- truncated by Riff: element too large -->\n";
    }
    return html;
  }

  function selectorOf(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = [...el.classList].filter((c) => !/^(css-|sc-|_|jsx-)|[0-9a-f]{6,}/i.test(c)).slice(0, 2);
    return cls.length > 0 ? `${tag}.${cls.join(".")}` : tag;
  }

  /** A link or div that is styled as a button: filled or outlined, padded, short. */
  function looksLikeButton(el, rect) {
    const style = getComputedStyle(el);
    const text = (el.innerText || "").trim();
    const painted = !isTransparent(style.backgroundColor) || borderOf(style, "top") !== null;
    const padded = boxShorthand(style, "padding") !== null;
    return painted && padded && text.length > 0 && text.length <= 40 && rect.height <= 80;
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    return {
      buttonLike: looksLikeButton(el, rect),
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: typeof el.className === "string" ? el.className : el.getAttribute("class") || "",
      role: el.getAttribute("role") || "",
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      selector: selectorOf(el),
      width: rect.width,
      height: rect.height,
    };
  }

  /** Everything the side panel needs from the picked element. */
  function capture(el) {
    const { nodes, truncated } = walk(el, MAX_NODES);
    const tokens = tokensOf(nodes, el);
    const rect = el.getBoundingClientRect();
    const captured = new Date().toISOString();
    const meta = { title: document.title, url: location.href, captured };
    return {
      url: location.href,
      pageTitle: document.title,
      captured,
      element: describe(el),
      tokens,
      snippet: buildSnippet(el, nodes, tokens, meta),
      truncated,
      viewport: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  globalThis.RiffExtract = { capture, describe, rgbToHex, selectorOf };
})();
