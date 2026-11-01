# 237 — The back office in the mock-up's colours

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** 236

## Story

As someone working in the back office all day, I want it to look calm and
clear (a light header, one strong accent, cards that stand off the page), so
that what I'm working on, and where I am, is what draws the eye.

## Context

Found 2026-11-01, comparing the Overview mock-up of story 236 with screenshots
of the back office. The logo and text in the mock-up are not ours and are
ignored here. The differences:

1. **The header.** The mock-up's is white with a hairline under it. Its section
   names are dark ink, and the current one is terracotta with a terracotta
   underline. Ours is a solid peach bar (`--crombolo-orange`) with cocoa text.
2. **The accent.** The mock-up uses a deep terracotta filled with white text:
   the New content bar, the active tab, links and the selected tree item. Ours
   is a light peach with cocoa text, because the logo's terracotta (`#cb6f48`)
   is only 3.8:1 against white, below WCAG AA (`tests/theme.test.ts`). A
   deeper terracotta, around `#b4532f`, is about 4.6:1 with white and still
   reads as the mock-up's colour.
3. **The sidebar.** The mock-up's sits on the same cream as the page, so the
   white cards are what stands out. Ours is white beside a cream main area.
4. **The selected tree item.** The mock-up's is terracotta text and icon, with
   no fill. Ours is Umbraco's filled highlight.
5. **Cards** have a faint shadow and more padding in the mock-up. Ours are flat.
6. **Small elements on the Overview:**
   - a type label in a peach pill;
   - avatar initials on a soft colour per person;
   - stat and activity icons in tinted circles: terracotta for edits, green for
     published.

   Ours use cream and grey.
7. **Type.** The mock-up's headings are a heavier, tighter sans-serif, close to
   Inter. The back office uses Umbraco's Lato.
8. **The Overview's own problems:**
   - its heading crowds the line under it;
   - Content still shows a tab strip ("Overview | Redirect URL Management"),
     since it has a second dashboard. The mock-up has no tabs.

## Decisions (2026-11-01)

1. **Tokens, not per-screen styles.** Points 1 to 5 change `theme.css` and the
   dark themes (`theme-dark.css`, `theme-system.css`), so they reach every
   screen:
   - a white header with a terracotta current marker;
   - a new deep-terracotta accent with white text;
   - a cream sidebar;
   - an outlined, terracotta selection;
   - soft card shadows.

   Every pair stays AA in `tests/theme.test.ts`, light and dark.
2. **The Overview's own polish** (points 6 and 8) is in its own element.
   Redirect URL Management becomes a Settings card under Site, so Content has
   one dashboard and no tab strip.
3. **Lato stays** (confirmed 2026-11-01). On Crombolo's own screens (the
   Overview and Settings) headings take a heavier weight and tighter
   letter-spacing, closer to the mock-up. Lato is under the SIL OFL 1.1. Its
   notice now ships beside the fonts as `dist/assets/fonts/OFL.txt`, from
   `packages/backoffice-dist/licenses/Lato-OFL.txt`, and in `NOTICE`, with a
   vendor test. The fonts already carried it in their own metadata.
4. **The brand's docs follow:** `docs/brand.md` gains the new accent, and the
   header's new treatment, beside the palette it already lists.

## Plan

Measured 2026-11-01 against white `#fff` and the cream ground `#fff7ea`.

1. **The accent, light** (`theme.css`):
   - a new `--crombolo-terracotta` of `#ad4f2c` routes
     `--uui-palette-violet-blue`, so it carries default, selected and emphasis
     at once;
   - its hover is `#9b4526`;
   - white text on it is 5.3:1, and as text on cream it is 5.0:1;
   - `--uui-color-default-contrast` and `--uui-color-selected-contrast` become
     white;
   - the light peach `--crombolo-orange` stays for tints only: the sign-in
     backdrop and hover fills under dark text.
2. **The header:**
   - `--uui-color-header-surface` is white, with cocoa text and icons;
   - `--crombolo-header-current` (the fork's marker token) is the terracotta,
     so the current section is marked in terracotta;
   - a fork commit, `Crombolo: the header's line and the sidebar's ground are
     themeable`, adds the hairline under the header
     (`--umb-header-border-color`) and the next item's sidebar token.
3. **The sidebar:** in the same fork commit, `umb-section-sidebar` paints
   `var(--umb-section-sidebar-background-color, var(--uui-color-surface))`. The
   theme sets it to the cream ground, so the sidebar sits on the page and the
   white cards stand off it.
4. **The selected tree item:**
   - `--uui-color-current` becomes a pale terracotta tint, `#fbeee7`, in place
     of the filled peach;
   - its text, `--uui-color-current-contrast`, is the terracotta, 4.7:1 on the
     tint;
   - the header keeps its own marker through the fork's token.
5. **Card shadows, on Crombolo's own cards only** (decided 2026-11-01):
   - the Overview's boxes and the Settings landing page's cards get a soft
     shadow in their own styles;
   - Umbraco's boxes stay flat;
   - nothing in `@umbraco-ui/uui` is patched, keeping story 235's line;
   - not chosen: a dependency patch so every `uui-box` reads a shadow token,
     which each UUI upgrade would have to re-check.
6. **Dark** (`theme-dark.css`; `theme-system.css` follows it):
   - the header is the night surface with a hairline;
   - the accent fill stays `#da987c` with dark text (7.3:1);
   - links and the current marker are `#e8a688` (8.5:1 on the night ground);
   - selection is the alternate surface with `#e8a688` text;
   - cards keep their border, and no shadow.
7. **Contrast tests:** `tests/theme.test.ts` gains, in light and dark:
   - the current item's text on its tint;
   - the header's current marker on the header;
   - the accent as text on the ground and on white;
   - white on the accent.

   The existing pairs stay.
8. **The Overview:**
   - type labels on the tint as peach pills;
   - avatar initials on a soft hue chosen from the name, by a pure,
     unit-tested function in `overview-format.js`;
   - stat and activity icons in tinted circles: terracotta for edits, green
     for published;
   - the heading's spacing fixed;
   - New content filled with the accent and white text, as in the mock-up.
9. **Redirect URL Management in Settings:**
   - a fork commit, `Crombolo: redirects are a Settings tool`, moves
     `Umb.Dashboard.RedirectManagement`'s section condition from Content to
     Settings;
   - `settings-cards.js` gives it a card under Site, "Redirects: old addresses
     that send visitors to a page's new one";
   - Content then has one dashboard, so no tab strip;
   - `tests/vendor.test.ts` checks the fork's change, as for the others.
10. **Docs:** `docs/brand.md` (the new accent, the header, the selection),
    `docs/backoffice-hosting.md` (the fork's two commits), the release notes.
11. **Checks:**
    - screenshots of the Overview, Settings, a content editor, the media
      section and the sign-in page, light and dark, compared with the
      mock-up;
    - the browser tests that read colours or the header (`theme`,
      `settings-header`, `overview`, `settings-landing`,
      `settings-dashboards`, `sign-in-dialog`) run.

## Acceptance criteria

- [x] The header is light, with the current section marked in terracotta.
- [x] One deep-terracotta accent, filled with white text, across buttons,
      links, the active tab and the selected tree item, and AA in light and
      dark.
- [x] The sidebar shares the page's cream, and cards stand off it.
- [x] The Overview has the mock-up's pills, avatars and icons, and no tab strip.
- [x] Redirect URL Management is a Settings card.
- [x] `docs/brand.md` lists the new palette.

## Implementation (2026-11-01)

- **Fork commits** on `umbraco/crombolo`, pinned at `377f0b5c`:
  - `the header's line, its current tab's text and the sidebar's ground are
    themeable`: `--crombolo-header-line`, drawn as an inset shadow so the
    header stays 60px; `--crombolo-header-current-text`; and
    `--crombolo-section-sidebar-background`.
  - `redirects are a Settings tool`: the dashboard's section condition.
  - `buttons in the header draw in the header's ink`: with a white header and
    white text on the accent, the header's icon buttons and the user's
    initial had become white on white.
- **The selected tree item and the active tab are separate.** Both read
  "current". The theme sets current to the accent, so tab markers stay
  visible. The tree's item takes the menu item's own tokens
  (`--uui-menu-item-background-color-active`, `-color-active`) for the tint.
  Its hover tint is `#faeae1`, which clears 4.5:1 where `#f8e4d9` did not.
- **Themes:** `theme.css` and `theme-dark.css`; `theme-system.css` follows
  dark.
- **Crombolo's cards:**
  - `--crombolo-card-shadow` (none in dark) and `--crombolo-terracotta-tint`
    (the alternate surface in dark) are read by `overview-dashboard.js` and
    `settings-section.js`;
  - avatar colours come from `avatarHue` in `overview-format.js`;
  - the title cell no longer breaks the table's row lines.
- **Tests:**
  - `tests/theme.test.ts`: a light palette suite, and the new dark pairs;
  - `tests/branding.test.ts`: the accent and the header;
  - `tests/vendor.test.ts`: the three fork commits;
  - `tests/settings-cards.test.ts`: the Redirects card;
  - `tests/overview.test.ts`: `avatarHue`.
- **Checked by screenshot:** the Overview, Settings, Structure and a content
  editor, light and dark.
- **Access change:** the redirect dashboard now needs the Settings section.
  Editors keep each page's redirects on its Info tab.
- **The sidebar is white after all (2026-11-01):** asked for after seeing it.
  `--crombolo-section-sidebar-background` is white in light and the night
  surface in dark, so the tree is a panel like the cards. The fork's token
  stays, so the theme decides.
