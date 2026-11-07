# 295 — Every form word has a box in the form editor

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 294

## Story

As someone building a form in the back office, I want to set a field's help text, placeholder and
messages there, so that I don't have to edit the form's file to change or translate them.

## Context

The form editor has boxes for a field's caption, a placeholder among its type's settings, page
and group captions, and the form's labels and message. A field's help text, required message,
pattern and pattern message can only be set in `schema/forms/*.toml`. Story 293 lets those name
dictionary items too, so the gap now blocks translating a form from the back office as well.

## Acceptance criteria

- [x] A field can set its help text and required message in the form editor.
- [x] A text field can set a pattern and its message.
- [x] Each box uses the input from story 294, so it suggests dictionary items and says what a
      `#name` reads as.
- [x] A text left empty is written out of the form's file, not saved as an empty value.
- [x] Saved values round-trip through the file with nothing else in it changing.
- [x] A read-only site shows them, and offers no way to change them.
- [x] The field table stays readable: the extra boxes sit behind a field's own details, not in
      more columns.
- [x] Covering tests, including a browser test that sets each and sees it on the page.
