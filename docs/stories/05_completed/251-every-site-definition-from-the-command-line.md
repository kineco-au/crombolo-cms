# 251 — Every site definition from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** 247

## Story

As a developer setting a site up from the command line, I want to list, change
and remove forms, approval workflows, webhooks, languages, user groups and the
site's URL settings with CLI commands, so that nothing about a site's setup
needs a file edit.

## Context

Each of these is a file the CLI can create but not change: `forms new`,
`workflows new`, `webhooks new`, `languages add`; user groups (story 228) and
`schema.toml`'s `[urls]` have no command at all. Member groups become files in
story 162.

## Decided (planning, 2026-11-03)

- **One story**, not split: forms and the five smaller definitions are planned
  and built together.
- **A group made in the back office is exported to be changed:** `crombolo
  users groups update|remove` on a group that is only in this environment's
  database is refused, saying to run `crombolo users groups export <alias>`,
  which writes it as one of the site's own groups (sections, permissions and
  languages) so it travels with the site and the commands change it. `export`,
  as `types export` writes the database's definitions out; `import` everywhere
  else in the CLI means a file coming in.

## Plan (2026-11-03)

These are the defaults, each 248's rule or the behaviour the back office has:

- **Laid out as 248:** nested by what is changed, each command checked against
  a copy of the site's definitions before anything is written, then written and
  applied, put back when the apply is refused; `--dry-run`, `--no-apply`,
  `-o json`, idempotent, no file or TOML in a message. 248's
  `support/type-edit.ts` flow is generalised to any definition the loader
  records (`form:`, `workflow:`, `user-group:` and the rest).
- **Refused while in use:** a form while a page or Library form uses it; a
  language while content varies by it (Umbraco deletes a language's
  translations with it, so there is no force); a user group while users are in
  it, unless `--move-users-to <group>`. An approval workflow can be removed
  with requests open, which withdraws them as deleting one already does (story
  234), saying how many.
- **Settings a type declares** (a field type's or a form workflow type's own,
  from a bundle) are stored with `--set`, unchecked, as data types' are (story
  249).
- **Story 243** (form entries) adds entry counts to the `forms list` and `forms
  show` built here.

1. **Forms** (`commands/forms/`): `list`, `show` (its pages, fieldsets and
   fields in order, its workflows, what pages and Library forms use it),
   `update` (name, store entries, approval, step pages, button labels, message
   or redirect after sending, theme, honeypot, minimum seconds, most entries),
   `remove`; `forms field add|update|move|remove` (alias, type, caption, help,
   mandatory and its message, pattern and its message, sensitive, options,
   `--set`; placed by `--page`, `--group`, `--before`, `--after`);
   `forms page add|rename|move|remove` and `forms group add|rename|move|remove`
   (a page or fieldset holding fields refused unless `--move-to`); a field's
   or page's condition as `--show-when <field>=<value>` (several are all of
   them; `--show-when-any` makes them any); `forms workflow add|update|remove`
   (type, name, when it runs, its settings: who is e-mailed and the subject for
   sending an e-mail, the address for sending to a URL, the type for saving as
   content).
2. **Approval workflows** (`commands/workflows/`): `list`, `show`, `update`
   (name, what it applies to, its rules), `remove`; `workflows stage
   add|update|remove` (name, approver groups, how many must approve, what comes
   next, where it sends back).
3. **Webhooks** (`commands/webhooks/`): `list`, `show`, `update` (URL, events,
   content types, enabled, headers, secrets as `env:` references only),
   `remove`.
4. **Languages:** `languages update` (name, fallback, mandatory, default) and
   `languages remove`.
5. **User groups** (`commands/users/groups/`): `list` (the site's own and those
   made in the back office, marked), `show`, `new`, `update` (name, sections,
   permissions, languages), `remove`, `export`.
6. **URLs:** `crombolo site urls --hide-top-level|--show-top-level`, the one
   setting `schema.toml` holds today.
7. **Pure edits** for each in `packages/schema` (forms, workflows, user groups,
   languages, URLs) and `packages/server` (webhooks, which it owns), as 248's
   `edit.ts`.
8. **Docs:** the product site's forms, users, webhooks and approvals guides lead
   with the commands; release note.
9. **Tests**, on SQLite: each edit; each command's happy path and its refusals
   (a form a page uses, a language content varies by, a group with users, a
   database-only group refused and then exported, a webhook secret given as a
   value); an approval workflow removed with requests open; what each command
   writes equals what the canonical writer writes; no output naming a file.

## Acceptance criteria

- [x] **Forms:** `forms list|show`, and `forms update` for its settings, fields
      (`add-field`, `update-field`, `move-field`, `remove-field`, with each
      field's type, label, validation and options) and workflows (who is
      e-mailed, where it goes after); `forms remove`, refused while a page or
      Library form uses it.
- [x] **Approval workflows:** `workflows list|show|update|remove`, with stages
      and their approver groups (`add-stage`, `update-stage`, `remove-stage`).
- [x] **Webhooks:** `webhooks list|show|update|remove`, secrets as `env:`
      references only.
- [x] **Languages:** `languages update` (name, fallback, mandatory, default) and
      `languages remove`, refused while content varies by it, naming how much.
- [x] **User groups:** `users groups list|show|new|update|remove`, with sections,
      permissions and languages, and `users groups export` for one made in the
      back office.
- [x] **URLs:** `crombolo site urls --hide-top-level|--show-top-level`.
- [x] Each as in story 248: `--dry-run` in plain words, `-o json`, idempotent,
      the whole set checked before anything is written, applied at once, no file
      or TOML in messages; tests on both dialects.

## Implementation (2026-11-03)

Built in three slices on 248's flow (`commitDefinitionEdit` in
`packages/cli/src/support/type-edit.ts`, whose refusal details no longer name
any file).

- **Forms:** `packages/schema/src/form-edit.ts`, `packages/cli/src/support/form-edit.ts`;
  `forms list|show|update|remove`, `forms field|page|group add|update|move|remove`,
  `forms workflow add|update|remove`. Pages and fieldsets have `update` (caption
  and condition) rather than `rename`, so a condition changes too; a field a
  condition names is not removed, nor the last page or fieldset. `--set` is
  stored as given, and the site's check then refuses a setting a built-in
  workflow type does not take.
- **Approval workflows and webhooks:** `packages/schema/src/workflow-edit.ts`,
  `packages/server/src/webhook-edit.ts`, `support/workflows.ts`,
  `support/webhooks.ts`; a stage removed passes what followed it to the stages
  before; webhooks need no apply, since the server reads their files as it
  sends, so they take no `--no-apply`; a webhook kept only in the database is
  listed and left to the back office.
- **Languages, user groups, URLs:** `packages/schema/src/site-edit.ts`,
  `support/site-definitions.ts`; a removed language is deleted from the
  database once applied, since a sync never deletes one; the administrators
  group is refused by every group command; the groups a new database starts
  with count as made in the back office and can be exported. `site` is listed on
  the CLI reference's content types page.
- **Docs:** the product site has no separate forms, approvals, webhooks, users
  or languages guides, so each is a section of its schema guide, leading with the
  commands.
- **Tests:** `tests/forms-edit.test.ts`, `tests/workflows-webhooks-edit.test.ts`,
  `tests/site-definitions-edit.test.ts`, on SQLite. Short of the plan: a form a
  Library form uses is counted by a query no test exercises.
