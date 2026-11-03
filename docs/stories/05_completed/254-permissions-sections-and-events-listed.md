# 254 — Permissions, sections and events listed

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone setting up user groups and webhooks from the command line, I want
to list the permissions, sections and events I can name, in plain words, so
that I am not guessing at names I can only find in the back office or the
source.

## Context

Found by the walkthrough in `docs/building-a-site-from-the-cli.md`:

- `users groups new --permission` takes names such as `Umb.Document.Read`, and
  `--section` takes section names. Nothing lists either. A wrong one is refused
  ("is not a permission verb"), but the refusal does not say what is allowed.
- `webhooks new --event` takes `Umbraco.ContentPublish` and the like, with the
  same problem.
- Names differ in style between commands. `types new data-type --editor` takes
  `block-list` and `long-answer`-style names, while `forms field add --type`
  takes `longAnswer`. The walkthrough's first try at a form field was refused
  for that reason alone.

## Decided (planning, 2026-11-03)

- **Plain permission names are `area:action`, always.** For example
  `content:read`, `content:publish`, `media:update`, `library:publish`,
  `forms:manage`, `form-entries:view` and `remote:push`. Read, publish, update,
  delete and move each exist for pages, Library items, media and forms, so a
  bare `read` would be a guess. It is refused, with the names it could mean.
- **The files keep the verbs.** A group's file and the database store
  `Umb.Document.Read`, as the back office does, so nothing already written
  changes. The commands take either name. Plain names are what they show.

## Plan (2026-11-03)

Today, for reference:
- **Sections** are already plain words (`content`, `media`, `forms`; see
  `SECTION_ALIASES` in `packages/core/src/sections.ts`). A wrong one is refused
  with the list. What they lack is a line on what each opens.
- **Permissions** are verbs in `packages/core/src/permissions.ts`:
  `DocumentPermissions`, `ElementPermissions`, `ElementContainerPermissions`,
  `MediaPermissions`, `FormPermissions` and `RemotePermissions`. A wrong one is
  refused as "not a permission verb", with no list.
- **Events** are `WEBHOOK_EVENTS` in `packages/api-management/src/webhook-events.ts`,
  eleven of them, each with a display name ("Content Published"). Bundles
  cannot add events, so the list is fixed.
- **Field types:** `forms field add --type` and `forms workflow add --type` take
  camel case (`longAnswer`, `sendEmail`). `types new data-type --editor` takes
  kebab case (`block-list`).

1. **Names, in `@crombolo/core`:**
   - `PERMISSION_NAMES`: one entry per verb, `{ name, verb, says }`. The area
     comes from the verb's group:
     - `content` (documents), `library` (elements), `library-folders`
       (element folders);
     - `media`, `forms` (view, manage), `form-entries` (view, manage,
       sensitive), `remote`.

     The action is the verb's key in kebab case, so `PropertyValueRead` is
     `content:property-value-read` and `CultureAndHostnames` is
     `content:culture-and-hostnames`. `says` is a line in plain words: "Read
     pages", "Publish Library items".
   - `permissionVerb(name)` takes a plain name or a verb, and gives the verb,
     or the names a bare action could mean.
   - `SECTION_NAMES`: each section with a line on what it opens.
   - `eventName(alias)` and `eventAlias(name)`: `content-published` ↔
     `Umbraco.ContentPublish`, the plain name made from the event's display
     name.
2. **The listing commands**, each with `-o json`:
   - `crombolo users groups permissions`: the names, grouped by area, each
     with its line. `--verbs` adds the stored verb.
   - `crombolo users groups sections`: each section and what it opens, plus
     an extension's sections when a wired bundle adds one.
   - `crombolo webhooks events`: each event's plain name and what raises it.
3. **Plain names taken:**
   - `users groups new|update --permission` and `webhooks new|update --event`
     take a plain name or today's.
   - An unknown name is refused, listing the allowed names, or for a bare
     action the areas it could mean.
   - `users groups show` and `webhooks show|list` print plain names, and
     `-o json` gives both.
   - The group file parser's refusal ("is not a permission verb") lists the
     permissions command.
4. **One naming style for types:**
   - `forms field add|update --type` and `forms workflow add --type` take
     kebab case (`long-answer`, `send-email`), as `--editor` does. Camel case
     still works.
   - `--editor` takes camel case too (`blockList`).
   - A bundle's field type is matched the same way, case-insensitively,
     through its kebab form.
   - The files keep the camel-case names.
5. **Tests:**
   - each listing, text and JSON;
   - a plain permission, section and event accepted, and the verb stored;
   - a bare action refused with its areas;
   - an unknown name refused with the list;
   - `long-answer` and `send-email` accepted, and `longAnswer` still accepted.
6. **Docs:**
   - the walkthrough's step 4 rewritten with plain names, and its row in
     "The gaps" removed;
   - the release note;
   - the CLI reference, regenerated.

## Implementation (2026-11-03)

- **Names:** `packages/core/src/permission-names.ts`.
  - `PERMISSION_NAMES` has an entry per verb: `area:action`, with the action
    being the verb's key in kebab case. Each entry has a line of its own.
  - `permissionVerb` takes a plain name or a verb, case-insensitively. A bare
    action is refused with the names it could mean, and an unknown one with
    where to look.
  - `permissionName` turns a stored verb back into its plain name.
  - `SECTION_NAMES` gives each section a line, and `eventName` makes an
    event's plain name from its display name.
- **The CLI:** `support/names.ts`.
  - `permissionVerbs`, `sectionNames` and `eventAliases` turn what was typed
    into what is stored. They refuse with the names allowed, as an unknown one was refused before.
  - A section takes its plain name, its manifest alias
    (`Umb.Section.Media`), or an extension's dotted alias.
  - `users groups new|update`, `webhooks new|update`, `users groups show` and
    `webhooks show|list` use them. Examples and flag help now give plain
    names.
- **Listings:** `users groups permissions` (`--verbs` adds the stored verb),
  `users groups sections` and `webhooks events`.
  - Sections a wired bundle adds are not listed. That would mean loading the
    bundles, so the listing says such a section is named by its own alias,
    which is accepted.
- **Types in either style:**
  - `typeNamed` in `support/form-edit.ts` matches a field or workflow type by
    its letters alone, ignoring case and dashes. It checks against the
    built-in types and those of wired bundles (`formTypesFor`).
  - `presetDataType` matches `--editor` the same way.
- **Group files:** the parser's refusal of an unknown verb now names
  `users groups permissions --verbs`.
- **Tests:** `tests/plain-names.test.ts`:
  - the names on their own;
  - each listing, in text and JSON;
  - a group by plain names, kept as verbs and shown by plain names;
  - a bare action, and an unknown section and event, refused with the names
    allowed;
  - a webhook by plain event names;
  - form field and workflow types in kebab case, and camel case still.
- **Docs:** the walkthrough's step 4 now uses plain names, and its rough edge
  and its row in the gaps table are gone. The release note is added.

## Acceptance criteria

- [x] `crombolo users groups permissions` and `crombolo users groups sections`
      list each one, with a line on what it allows; `crombolo webhooks events`
      lists the events. Each takes `-o json`.
- [x] Each command accepts a plain name (`content:read`, `content:publish`,
      `content`, `content-published`) alongside the one it takes today, and a
      refusal of an unknown name lists the allowed ones. A bare `read` is
      refused with the areas it could mean.
- [x] `forms field add --type` and `forms workflow add --type` take the same
      kebab-case names as `--editor`, and the camel-case ones still work.
- [x] Tests for each listing, a plain name accepted, and a refusal that lists
      the allowed names.
