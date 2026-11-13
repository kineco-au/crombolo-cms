# 344 — A save the schema files can't take is refused

**Epic:** Q — A site from the command line · **Priority:** must · **Size:** S
**Depends on:** 021

## Story

As a developer whose site keeps its definitions in `schema/`, I want a back-office
save that would leave those files invalid to be refused, saying why, so that the
database and the files I commit never quietly disagree.

## Context

A back-office save of a content, media or member type, or a data type, wrote the
database and then the file. Before writing the file it validated the whole set, and
if that failed it logged the problems and wrote nothing, while the save reported
success. The change stayed in this database, never reached `schema/`, and so was
never committed or deployed. The docs said such a save was refused in the UI; it
wasn't, and they also said the file was written instead of the row.

## The design

- **Checked before it is kept.** The save runs in a transaction on the transaction's
  own handle (on Postgres a query on the pool would not join it); the definitions are
  exported as the transaction sees them and validated. A problem the save adds rolls
  it back and refuses it, 400, with the problems. Problems that were there before do
  not stop an unrelated save.
- **Then the version and the file**, as before, so a refused save moves neither.
- **Data types too**: their save can now report a refusal through the API.
- The file writers no longer skip silently.

## Acceptance criteria

- [x] A type change that would leave a block list offering a non-element is refused,
      and neither the database, the type's file nor the version changes
- [x] A valid save writes the database and the file alike
- [x] A data type that names a non-element as a block is refused the same way
- [x] On SQLite and Postgres
- [x] `docs/schema-as-code.md` says what a save writes, in order

## Built

- `savedIfValid` (`server/src/adapters/content.ts`) and `schemaProblems`
  (`adapters/schema-files.ts`); content type create, update, create-template and
  import, and data type save, use them. `DataTypePort.save` returns a `PortFailure`.
- Tests: `tests/schema-save-check.test.ts`, run on both dialects.
- Copies and moves are not checked: a copy of a valid type, or a type moved between
  folders, adds nothing a check could refuse.
