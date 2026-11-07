# 293 — One form in every language

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone running a site in more than one language, I want one form whose words follow the
visitor's language, so that a new field is added once and all its submissions are in one place.

## Context

A form has one set of labels. A translated site needs a form for each language, picked by a form
picker that varies by culture, as `sites/crombolo-demo` does with `contact.toml` and
`contacto.toml`. A new field has to be added twice, the copies can drift apart, and submissions
are split across them. Umbraco Forms keeps one form, with captions such as `#Name` that name a
dictionary item. That comes from community threads and a converter package: no official page
describing it was found on 2026-11-07.

## Findings (2026-11-07)

- **Dropdowns already do this.** `source = { kind = "dictionary", parent = "Regions" }` gives
  labels in the page's language, or the request's for the Delivery API (`docs/forms.md`).
- **Submissions save no language.** `packages/server/src/form-submit.ts` writes `culture: null`
  into `form_entry`, though the column exists.
- **A form is drawn in two places:** `<Form>` on the server and the Delivery API for islands.
  Both have to give the same words.
- **One place to do it.** `withResolvedChoices` already fills in a form's choices for a language,
  at four sites in `published-cache.ts`, and `<Form>`, the Delivery API and the submission check
  all read its result. The words can be resolved in the same step.
- **A submission already knows its language.** `submitFormRoute` in `server.ts` works it out from
  `Accept-Language` or the page it came from, to resolve the form, and then drops it. There is
  no migration, since `form_entry.culture` exists.
- **Others read captions directly:** Entries and the CSV export (`server/src/forms.ts`), and the
  e-mail summary (`form-workflows.ts`). They would show `#contact.name` unless resolved too.
- **Choices are already covered** by a dictionary source, and a condition compares what is
  stored, which doesn't change with the language. Plain `values = [...]` lists stay one language.
- **The form editor** shows a caption as text, and Umbraco's shows the raw key there too.

## Decisions (2026-11-07)

- **The dictionary holds the words,** where translators already work and fallback languages
  apply. Translations inside the form file would be a second place to keep them.
- **A `#` names a dictionary item:** `caption = "#contact.name"`. Words without one stay exactly
  as they are, so existing forms don't change.
- **`sites/crombolo-demo` moves to one form,** and `contacto.toml` goes.

## Acceptance criteria

- [x] Captions, help text, placeholders, required messages, the submit button and the thank-you
      message can each name a dictionary item.
- [x] They show in the page's language, then its fallbacks, on the server and through the
      Delivery API.
- [x] A dictionary item with no translation falls back as the dictionary does.
- [x] `crombolo bundle build --check` reports a form naming a dictionary item that doesn't exist.
- [x] The form editor shows the words, and it is clear they come from the dictionary.
- [x] A submission saves its language, and Entries shows it and can filter by it.
- [x] Entries, the CSV export and e-mails show words, never a `#key`.
- [x] Words without a `#` behave as they do today.
- [x] The demo has one contact form in two languages, its `enquiryForm` property no longer varies,
      and `docs/forms.md` and `docs/rendering.md` say how this works.
- [x] Covering tests, including a post in each language.

## What was built (2026-11-07)

- **`withFormWords`** in `packages/core/src/forms.ts`, and one `localisedForm` in
  `published-cache.ts` where the four choice resolutions were.
- **A `#` naming no item is shown as written** (the recommendation, taken when the build was
  asked for, then `#` itself confirmed by the maintainer after looking at `dictionary:`). So
  "#1 choice" needs no escape.
- **The check runs only for a site with `content/dictionary.toml`.** Without it, the items may
  all be in a database the build can't see, and every name would look missing.
- **The form editor shows words in the default language,** as its choice preview does, not the
  editor's own, under the name and each caption, the submit button and the message on submit. It
  doesn't appear under help text, placeholders or required messages.
- **Entries shows aliases as its labels,** so it had no `#key` to resolve. Its Language filter
  and tag show once a form has entries in more than one language.

## Plan

1. **Core:** `withFormWords(form, word)` in `packages/core/src/forms.ts`, pure, which walks the
   form's text: page and group captions, and each field's caption, help text, placeholder,
   mandatory and pattern messages, plus the submit, next and previous labels and the message on
   submit. Library forms' words pass through it too.
2. **The word:** a text starting `#` whose rest is a dictionary item's name gives its translation,
   then its fallbacks, then the item's name. Anything else stays exactly as written.
3. **The cache:** one private `#localised(form, snapshot, view, culture)` in `published-cache.ts`
   replaces the four `withResolvedChoices` calls, so every reader gets both.
4. **Submissions:** the culture `submitFormRoute` finds goes to `submitForm` and into
   `form_entry.culture`, and the check's messages come from the resolved form.
5. **Other readers:** Entries, the CSV export and the e-mail summary resolve words in the entry's
   language, then the default one.
6. **Entries:** a Language column, and a filter, shown only on a site with more than one language.
7. **The check:** `bundle build --check` reports a `#word` with no spaces that matches no item.
8. **The form editor:** under a field whose text names an item, a line saying what it reads as in
   the editor's language and that it comes from the dictionary. A `previewWords` call beside
   `previewChoices`.
9. **The demo:** `contact.toml` names dictionary items, `contacto.toml` goes, `enquiryForm` stops
   varying, and the note in `docs/rendering.md` is replaced.
10. **Tests:** the walk; a post in each language, with its messages and saved language; the
    Delivery API with `Accept-Language`; the CSV; the check; plain text unchanged.

No migration.
