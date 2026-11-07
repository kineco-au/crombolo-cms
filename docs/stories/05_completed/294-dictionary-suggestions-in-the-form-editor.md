# 294 — Dictionary suggestions in the form editor

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** S
**Depends on:** 293

## Story

As someone building a form, I want dictionary items suggested when I type `#`, so that I can
find the right one without leaving the form or remembering its exact name.

## Context

Since story 293 a form's words can name dictionary items, such as `#contact.name`, typed by hand.
The form editor shows what one reads as under some of its text boxes, but not while typing, and
not under help text, placeholders or required messages.

## Decisions (2026-11-07)

- **One shared input for the form editor's text boxes,** which brings the suggestions and the
  "From the dictionary" line to every text that can name an item.
- **Creating an item from the list is left out.** It would write to the dictionary from the form
  editor, and read-only sites would need handling.
- **The code editor is left out,** though `dictionary('` could use the same idea.
- **Help text and messages were left to story 295,** which adds their boxes.

## Acceptance criteria

- [x] Typing `#` in a form text box lists dictionary items, filtered as more is typed.
- [x] Each row shows the item's name and its text in the default language.
- [x] Choosing one fills in `#name`, by mouse or by keyboard, and Escape closes the list.
- [x] Text that doesn't start with `#` shows no list, and behaves as it does today.
- [x] A site with no dictionary items shows no list.
- [x] Every text box in the form editor that can name an item has the input: field, page and group
      captions, a field's placeholder and text block, and the form's labels and message.
- [x] A read-only site's form shows no suggestions, as its text boxes can't be changed.
- [x] It uses plain words, works with a screen reader, and only `forms.manage` can read the list.
- [x] Covering tests, including a browser test that types `#` and picks an item.

## Findings (2026-11-07)

- **Help text and required and pattern messages have no box in the form editor.** The other
  texts that can name an item do.
- **The boxes stay editable on a read-only site.** `_because` hides Save and Create, but the
  inputs are live, so the shared input needs to know.
- **`dictionaryEntries` gives every item in a language,** with its fallbacks, so one list can serve
  the suggestions and the "From the dictionary" line, and the `POST /words` from 293 can go.
- **A list inside a table cell would be clipped,** so it is a native popover, in the top layer.

## Plan

1. **Server:** `GET .../crombolo/api/forms/words` answers `{ words: [{ name, text }] }` in the
   default language, for `forms.manage`. It replaces `POST /words`.
2. **`form-word-input-model.js`, pure:** `suggestions(items, value)` matches names and texts, names
   starting with what was typed first, at most eight rows; `wordFor(items, value)` gives the
   line under the box.
3. **`form-word-input.js`:** a `crombolo-form-word-input` around `uui-input`, taking `label`, `value`,
   `placeholder`, `readonly` and `words`, and sending `change` as `uui-input` does. It is a
   combobox: `role="combobox"`, a `listbox` of options in a popover, arrows,
   Enter, Escape, and a click that doesn't lose the input's focus first.
4. **The form editor:** it loads the list once when a form opens and passes it down. The five
   boxes use the new input, and `#word` and `_words` from 293 go.
5. **A long dictionary:** eight rows and "Keep typing to narrow this down", with the whole list
   held in the browser, so a site with thousands of items needs no search endpoint.
6. **Tests:** `tests/form-word-input.test.ts` for the matching; the endpoint and its permission in
   `tests/forms-backoffice.test.ts`; `tests/browser/forms.browser.ts` types `#con`, picks with
   the keyboard, and sees the line under the box.
7. **Docs:** `docs/forms.md` and release notes.

No migration, and no change to the fork.
