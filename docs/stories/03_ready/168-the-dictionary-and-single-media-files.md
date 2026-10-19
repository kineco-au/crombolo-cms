# 168 — The dictionary and single media files

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a developer setting a site up from the command line, I want to write the
dictionary as a file I can read, and to upload one media file with its alt text,
so that the last small pieces of setup need neither the back office nor a
hand-made XML file.

## Context

The dictionary moves in and out as Umbraco's `.udt` XML (`crombolo dictionary
import|export`): fine for carrying it between sites, not something anyone
writes by hand. `crombolo media import <dir>` uploads a directory tree (story
153) but not a single file, and sets no alt text or focal point.

## Acceptance criteria

- [ ] `crombolo dictionary import` and `export` also take a TOML file — a key,
      its children, and a value per culture — chosen by extension; the same
      format is accepted in seed files (story 163) when that lands
- [ ] `crombolo dictionary set <key> --culture <iso> <value>` and
      `dictionary list [--missing <iso>]`, to find untranslated keys
- [ ] `crombolo media import <file> [--under <path>] [--name] [--alt]
      [--focal x,y]` uploads one file
- [ ] Idempotent, `--dry-run`, `-o json`, audited
- [ ] Tests on SQLite and Postgres
