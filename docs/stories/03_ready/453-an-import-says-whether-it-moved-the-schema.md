# 453 — An import says whether it moved the schema

**Epic:** K — Moving content · **Priority:** should · **Size:** S
**Depends on:** none

## Story

As whoever runs an import of a bundle's content, I want its result to say whether it moved
the site's schema, and from what to what, so that I know when the nodes serving the site
need to take the new schema before the back office is used again.

## Context

An import (`installBundleContent`) can change document types and data types as well as
content. Nodes that loaded the schema before the import keep serving the old one until they
take the new one, and nothing in the import's result says that happened: a caller has to
read the schema state itself, before and after, to find out.

The change is small and is in this repository's working tree, uncommitted:

- `packages/server/src/bundle-install.ts`: `installBundleContent` reads
  `currentSchemaState(db)` before and after the install it wraps, and returns
  `schema: { before, after }` with the result. `ContentImportResult` gains an optional
  `schema`.
- `tests/import-reaches-nodes.test.ts`: *the schema an import moves*, an import that changes
  a type answers a different `after` from its `before`, and one that changes only content
  answers the same.

It was tried before this story was written: an operator restarting a site's nodes when, and
only when, `before` and `after` differ saw the restart happen after an import that moved the
schema, and the site's back office answered on the new schema afterwards.

## Acceptance criteria

- [ ] `ContentImportResult.schema` is `{ before, after }`, each the schema state as
      `currentSchemaState` reads it, around the import.
- [ ] An import that changes a type answers `before` ≠ `after`; one that changes only
      content answers them equal.
- [ ] The field is optional, so a caller written against an earlier release is unchanged.
- [ ] Documented with the import's result.
