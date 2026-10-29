# 202 — A page's form picker shows its fields

**Epic:** J — Forms · **Priority:** must · **Size:** S
**Depends on:** —

## Story

As a content editor opening Harbourstone's Contact page, I want to see which
form the page uses and inspect its fields, so that I can understand what
visitors will be asked without leaving the page.

## Context

The picker loads the forms and displays the selected form's field count, but
passes native option elements to `uui-select`, which takes an `options`
property instead. Its dropdown is empty despite the existing saved value.
The picker also offers no view of the selected form's fields.

## Acceptance criteria

- [x] The dropdown lists available forms and displays the saved selection.
- [x] Choosing or clearing a form saves its key through the normal page editor.
- [x] An expandable field list shows the selected form's pages, groups, field
      captions, required fields, help and choice options without changing it.
- [x] Loading, unavailable forms and failed field requests have clear states;
      changing selection cannot display an earlier request's fields.
- [x] Unit tests and focused real-browser coverage pass through Docker, along
      with formatting, lint and types. The forms documentation is updated.

## Implementation

- The picker passes the form list through the select component's `options`
  property, with the saved form selected by key and shown by name.
  `form-picker-options.js` also retains unavailable saved forms. Its explicit
  clear choice avoids the component's disabled empty placeholder and maps back
  to an unset page property; its internal value is never saved as a form key.
- **View form fields** expands the existing form-detail endpoint's definition:
  pages, named groups, captions, required markers, help and fixed choices.
  Reading it does not change the page or the form. Full editing remains in the
  Forms section.
- Field requests have loading, failure and retry states, and only a result for
  the current key can populate the preview. Unavailable saved forms can still
  be cleared, including when the site has no remaining forms.
- The browser fixture uses Harbourstone's actual contact form with a small
  Contact page type. The regression verifies its seven fields, saving and
  reloading a selection, clearing it, unavailable forms and failed-load retry.
  The existing workflow designer browser test remains covered.
- Unit tests cover the select choices and clear adapter, plus the Harbourstone
  API summary and full definition. `docs/forms.md` describes the page workflow.

## Validation

- Targeted Docker unit tests: 26 passed, zero failures.
- Focused Docker browser tests (`bun run test:browser forms.browser.ts`):
  two passed, including the existing workflow designer test.
- Full Docker SQLite unit suite: 3,040 passed, 8 skipped, zero failures.
- Final Docker `bun run check`: formatting, lint and types passed.
