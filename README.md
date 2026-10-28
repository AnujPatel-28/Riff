# Riff

**See something you like on any website, say why, and keep it in your own GitHub repo, where your coding agents can use it.**

Design engineers collect inspiration all day: screenshots, bookmarks, boards. Two things always get lost:
the **real values** (colors, type, spacing, shadows, motion) and **why** you liked it. And your coding agent
can't see any of it, so you explain it again every time.

Riff is a Chrome extension:

1. On any website, press **Alt+R** (or click the Riff icon).
2. Hover the page and click the element. **↑** picks the bigger container, **↓** goes back, **Esc** cancels.
3. A card opens on the page with the note box already focused: hold your **Wispr Flow** key and say why
   you like it. Add `#tags` if you want. The page keeps its full width.
4. Press **Ctrl+Enter**. Riff commits the idea to your `inspiration` repo. No PR, nothing to merge.

Each idea lands as plain files any agent can read:

```
inspiration/
  AGENTS.md                      how coding agents should use the library
  CLAUDE.md                      points Claude Code at AGENTS.md
  INDEX.md   index.json          every idea, newest first, by project and tag
  ideas/2026-10-28-linear-app-pill-button/
    README.md                    why you liked it, the real values, the source
    shot.png                     the element as you saw it
    snippet.html                 its markup with computed styles inlined, scripts removed
```

Then tell your agent: *"Use the pill button idea from my inspiration repo for the contact link."*
**Copy prompt for your agent** on the card writes that prompt for you.

No AI API, no account, no server: Riff reads values from the page itself, Wispr turns your voice into
the note, and your own agent does the building.

## Install (developer mode)

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension/` folder.
3. Create an empty GitHub repo, e.g. `inspiration`.
4. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for **only that repo**
   with **Contents: Read and write**.
5. Press **Alt+R** (or click the Riff icon). The first time, Riff opens its settings: paste the repo and
   the token and click **Connect**. That's remembered; change it any time in Riff's options
   (right-click the icon → **Options**).

The token stays in this browser's extension storage, is used only by the extension's background worker
(never by the page you're on), and is only ever sent to `api.github.com`.

## Permissions, and why

| Permission | Why |
| --- | --- |
| Active tab | only the tab you're on, and only when you press Alt+R or click the icon: show the picker, read the element, take the screenshot |
| Scripting | inject the picker and the card into that tab |
| Storage | your repo name, token, projects and recent ideas |
| `api.github.com` | committing ideas to your repo |

Riff can't see any site until you press Alt+R there, and it removes itself when you close the card.

## What gets captured

- **Values from computed styles:** colors with their role (text, background, border, icon, shadow, gradient),
  the color it sits on, font families, the type scale, radius, shadows, gradients, spacing, borders, motion, layout.
- **A screenshot** of the element, cropped at your screen's resolution (only the visible part).
- **A snippet:** the element's markup with non-default computed styles inlined, including `::before`/`::after`.
  Scripts, event handlers, `data-*` attributes and `javascript:` links are removed; URLs are made absolute.

Snippets and screenshots are reference material from other people's sites: recreate the idea in your own
code; don't ship their code or assets. `AGENTS.md` tells agents the same.

## Develop

```bash
npm test           # format, GitHub client and save logic, against an in-memory GitHub
npm run test:e2e   # real Chromium: load the extension, pick with the mouse, save (needs Playwright)
npm run check      # both
RIFF_SHOTS=./shots npm run test:e2e   # also screenshots the options page and the card
```

Built for [No Hands: The Wispr Challenge](https://www.wemakedevs.org/wispr), Builders track.
