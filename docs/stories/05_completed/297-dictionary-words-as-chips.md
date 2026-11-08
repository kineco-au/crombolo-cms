# 297 — Dictionary words as chips, in forms and on pages

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 293, 294

## Story

As someone editing a form or a page, I want a dictionary item I've used to show as a chip I can
open, so that I can see and change its words in each language without going to Translation.

## Context

Since story 293 a form's text can name a dictionary item, `#contact.name`, and since 294 the form
editor suggests items after a `#` and says what one reads as. The text is still a plain box with
`#contact.name` in it. A page's own text can't name a dictionary item at all.

Block labels already use Umbraco's label marks: `{=heading}` is a property's value, and `{#key}`
is a back office term (`umbLocalize`). A dictionary item takes the same shape, so there is one
pattern everywhere.

## Decisions (2026-11-08)

- **One pattern, `{#key}`,** in forms, page property values and labels. It can stand alone or sit
  inside text: `Welcome to {#site.name}`. A key that names no item shows as written. Bare `#key`
  is retired, so `#1 choice` is only ever text.
- **Forms move to `{#key}` (option A).** Every form text that is exactly `#key` and names an item
  becomes `{#key}`. Forms are files in `schema/forms/`, not rows, so the "migration" is the server
  rewriting those files as it starts, where it may write its schema; `bundle build --check`
  reports a bare `#key` that would have matched. Bare `#key` is read for one release, then not at
  all.
- **Pages resolve `{#key}`** in text boxes, text areas and rich text, including those inside block
  list and block grid items, in the page's language, then its fallbacks, then as the item's name.
- **Chips only where the whole value is one `{#key}`** in a text box or text area, in the form
  editor and on pages. Rich text resolves but shows no chip.
- **A chip** is a button-style chip with the item's words in the default language and an × that
  clears the value, leaving the box empty to type in. Typing `{#` (and `#` at the start of a box,
  as 294 does) suggests items, and choosing one writes `{#key}`.
- **Clicking the chip** opens an overlay with the item's words, a switch between the site's
  languages, and a way to change them, saved to the dictionary.
- **Search and the Delivery API see the words:** the indexer indexes each language's resolved
  text, and the Delivery API returns the text in the requested language, as rendering does. The
  stored value keeps `{#key}`.
- **Labels:** the fork's `{#…}` looks in the dictionary when the back office has no term of that
  name, so a block label can show translated words.

## Acceptance criteria

- [x] Forms: `{#key}` resolves wherever `#key` did (293); the server rewrites matching bare
      `#key` values in the form files as it starts; `bundle build --check` warns of a bare `#key`.
- [x] Pages: `{#key}` resolves in text box, text area and rich text values, at the top level and
      in blocks, in the page's language then its fallbacks, in rendering and the Delivery API;
      a `{#key}` naming no item shows as written.
- [x] Search indexes the resolved words in each language, not `{#key}`.
- [x] In the form editor and a page's text box or text area, a value that is exactly one `{#key}`
      shows as a chip with its words in the default language; the × clears it, and suggestions
      write `{#key}`.
- [x] The chip's overlay shows the words in each language, switches between them, and saves a
      change to the dictionary, on a site whose dictionary can be changed.
- [x] Someone without Translation sees the words but can't change them, and the overlay says so.
- [x] A block label with `{#key}` shows the dictionary item's words when no back office term has
      that name.
- [x] Plain text, and text with `#` or a `{#…}` naming no item, behave as they do today.
- [x] `docs/forms.md`, `docs/rendering.md` and the release notes describe `{#key}` and the
      upgrade from `#key`.
- [x] Covering tests, including a browser test that opens the overlay and changes a word.

## Implementation (2026-11-08)

- `@crombolo/core` `dictionary-words.ts`: finding and resolving `{#key}`, and the old `#key`.
- Rendering: the value context's `word` (`dictionaryWordIn` in the published cache) resolves text
  box, text area and rich text values, blocks included; forms use the same lookup.
- Search: `dictionaryWords` in `@crombolo/data` resolves values per culture in both indexes;
  `queueDictionaryWordsForSearch` requeues the pages naming an item when it is created, changed,
  renamed or deleted.
- Forms: `form-word-upgrade.ts` rewrites `#key` on the word lines of `schema/forms/*.toml` at
  install; `bundle build --check` reports `unknown-dictionary-item` for `{#key}` and
  `bare-dictionary-word` for an old `#key`.
- API: `<backoffice>/crombolo/api/dictionary/words[/<name>]` (`dictionary-words-api.ts`): read by
  anyone signed in, changed with Translation or Settings.
- Back office: `crombolo-dictionary-words` (chip and suggestions, `dictionary-words.js`) and
  `crombolo-dictionary-chip` (the overlay). The form editor's input and the fork's text box and
  text area editors put their input inside it; the fork's `ufm-localize` asks
  `umbCromboloHooks.dictionaryWord` for a label's `{#key}` the back office has no term for.
- Tests: `dictionary-words`, `form-words`, `form-word-input`, `dictionary`, `search`, and the
  browser tests `dictionary-chips` and `forms`.
