# 402 — A staged dictionary keeps what the bundle leaves out

**Epic:** S — Workspaces and changes · **Priority:** must · **Size:** S
**Depends on:** 399

## Story

As a team staging a site bundle into a workspace, I want the dictionary to follow the
same rules as everything else a bundle carries, so that staging never deletes an item or
carries a translation the site cannot hold without my saying so.

## Context

Story 399 stages a site bundle's dictionary as the workspace keeps one,
`content/dictionary.jsonl`, an item a line, merged by item. The file is compared whole,
as every other file is. But where every other file is one item, this one holds every
dictionary item, so an item Shared has and the bundle lacks (one an editor added since
the checkout, or one a partial bundle does not carry) is removed from the file, and the
merge deletes it, without `prune`. Shipped in 0.74.0.

Two smaller gaps: a translation for a language the site does not have is carried into
the workspace, where a `.udt` import would drop it; and a checkout with no database
carries no dictionary at all.

## The design

- **What the bundle lacks is kept unless `prune`.** Staging measures the dictionary item
  by item: an item the base has and the bundle lacks keeps the base's line in what is
  staged, so the change leaves it alone. With `prune`, it is removed, and the merge asks
  for its delete to be accepted, as for any delete.
- **A translation for a language the site lacks is dropped and listed.** It is left out
  of what is staged, as the `.udt` import leaves it out, and the answer's `leftOut` names
  it (`dictionary: Greeting (fr-FR)`).
- **A checkout carries its dictionary from `dictionary.toml`** at its root, the form a
  person writes by hand and `crombolo dictionary export --out dictionary.toml` writes
  (story 168). As `dictionary import` reads it, an item is matched by name: to the site's
  item of that name, or, for a new one, the key every site gives that name
  (`dictionaryKey`). Without the file, nothing is staged for the dictionary, and so
  nothing is deleted. A file with problems is refused, naming them.

## Acceptance criteria

- [x] An item Shared has and the bundle lacks is kept by a staging without `prune`
- [x] With `prune`, it is deleted, and the merge asks for that to be accepted
- [x] A translation for a language the site lacks is not staged, and is listed in `leftOut`
- [x] A checkout's `dictionary.toml` is staged as its dictionary, its items matched by
      name; a checkout without one stages nothing for it, and one with problems is refused
- [x] `docs/changes.md` says so, and the release notes name 0.74.0's fault fixed

## Decisions

- An item the bundle lacks is kept unless `prune`.
- A translation for a language the site lacks is dropped and listed.
- A checkout's dictionary is `dictionary.toml` (not `.udt`): the form people keep in a
  repository and edit by hand.

## Implementation

- `fitDictionary` and `stagedDictionary` (`packages/server/src/change-transfer.ts`), in
  `stageSite`: the bundle's dictionary matched to the site's items by name and stripped
  of languages it lacks, remembered as the source's base, then measured item by item
  against the base unless `prune`.
- `dictionary-item-removed` (`packages/core/src/schema-changes.ts`, `breaking`), described
  per item for `content/dictionary.jsonl` (`describeFileChange`), so every merge that
  removes a dictionary item asks for it to be accepted.
- The CLI: a checkout's `dictionary.toml` becomes the bundle's `dictionary.udt`
  (`dictionaryUdtOf`), each item keyed by `dictionaryKey(name)`.
- Tests: `tests/site-staging.test.ts`, `tests/workspace-dictionary.test.ts`.
