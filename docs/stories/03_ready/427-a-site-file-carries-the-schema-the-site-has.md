# 427 — A site file carries the schema the site has

**Epic:** K — Moving content · **Priority:** should · **Size:** M
**Depends on:** 104, 424

## Story

As a host copying one site to another, I want a whole-site file to carry the schema the
site has even where the site has no schema files, so that every site file can be
replaced from and the copy has the same types as its source.

## Context

Suggested by Crombolo Cloud on 2026-11-25, on finding `424`'s first cut refused a
replace from a file with no schema. Not built.

A whole-site export takes the schema as every `.toml` under the site's schema folder as
it stands (`wholeSchema`, `packages/server/src/site-sections.ts`), after
`useSchemaStore` has copied the store into it. A site whose types are only in its
database exports no schema at all (`sections: {}`): a hosted site started from a
template had its types in the database and nothing in its schema store until its first
promotion.

What that costs today:

- **The copy has not the source's types.** Replaced from such a file, a site keeps
  whatever schema it had; where it is at a schema version of its own the replace is
  refused (`NO_SCHEMA`, `424`), and where it is not, pages arrive for types it may lack.
- **`424` cannot help:** a replace takes the file's schema whatever its version, and
  this file has none to take.

The database can already be written out as files: `exportSchemaSet` and
`writeSchemaFiles` (`packages/schema/src/export.ts`) are what `crombolo types export`
uses, and a picked bundle writes its slice the same way (`schemaEntries`).

## The design

- **A whole-site export always carries a schema.** Where the site's schema folder holds
  any definition, the folder is carried as it stands, as today. Where it holds none, the
  schema is written from the database: content, media and member types, data types,
  languages and approval workflows, with a `schema.toml` naming the version the database
  is at.
- **The site is given those files too.** An export that finds no definitions writes
  them into the site's schema folder and publishes them to its schema store, so from
  then on the site's files and database agree and every later export carries its files.
  There is no option: it always does.
- **The site's nodes start as before.** The schema state is marked with the written
  files' hash, so a node that starts from them finds them the same as the database and
  applies nothing. Without that a node in production would refuse to start, the
  definitions having "changed without a new version".
- **Where the files cannot be written** (a read-only folder, a store that refuses), the
  export still carries the schema in its file, and says the site was not given its
  files and why.
- **The manifest says which,** so a reader can tell a schema as the site's files had it
  from one written out of its database.
- **Forms are not written:** a form's definition is only its file, so a site with no
  schema files has none. User groups travel with the file's people.
- **A replace from such a file** takes its schema as `424` describes.
- **The refusal for a file with no schema** stays for files made by older versions.

## Decisions (2026-11-25, the maintainer's)

1. **From the database only where the folder holds no definitions.** A folder with some
   is carried as it stands, though the database has more.
2. **The site is always given the files,** with no option on the command line. (First
   answered as an option off by default, then changed.)
3. **Approval workflows are written too,** beside the types, data types and languages.

## Acceptance criteria

- A whole-site export of a site with types in its database and no schema files carries
  each type, data type, language and approval workflow, and a `schema.toml` at the
  database's version.
- After it, the site's schema folder and schema store hold those files, and a node
  started from them applies nothing and starts, in production.
- A second export carries the files as they stand.
- Replacing another site from the file gives it those types and workflows, and the
  check before it reports the schema it would take.
- An export of a site with schema files carries them byte for byte, as today, and
  writes nothing.
- Where the folder or store cannot be written, the export succeeds, carries the schema,
  and says the site was not given its files.
- Tests on both dialects; `docs/content-transfer.md` says where a file's schema comes
  from and that an export can write a site's schema files.
