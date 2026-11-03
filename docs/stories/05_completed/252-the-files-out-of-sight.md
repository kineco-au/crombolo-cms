# 252 — The files out of sight

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** 248, 249, 250, 251, 253

## Story

As someone setting a site up, I want the CLI and its messages to
describe the site in its own terms (types, properties, forms, groups) and never
ask me to open or understand a schema file, so that the CLI is the way a site is
set up and the files are only what gets committed.

## Context

Once stories 247–251 give every definition a command, what is left is how the
CLI and the docs talk. Today `types check` and the sync report findings by
file and line, `crombolo init` and the getting-started guide show the
`schema/` layout, and several error messages tell the reader to edit a file.
The files stay as they are: the deploy unit, committed, reviewed in a diff, and
editable by hand for anyone who prefers to; they are simply not the interface.

## Decided (planning, 2026-11-03)

- **Waits for 253.** The flow test creates its pages by command, so 252 is built
  after story 253 gives pages commands. Content files are not hidden by 252:
  they are content, and 253 decides how commands relate to them.
- **Definition first; the file only when it cannot be read.** A finding or
  refusal names the definition and the command that changes it: "The content
  type "Content page": its property "body" has a setting "width" it does not
  take". A hand-edited file that does not read as a definition at all, such as a
  TOML syntax error, is named by its file and line, since whoever edited it knows
  the file. The follow-on errors a broken file causes elsewhere are dropped, such
  as "unknown type" in every type that names one defined in it. `-o json` keeps
  the file and line on every finding.
- **`site show`, beside `status`** (2026-11-03). `crombolo status` stays about
  whether the environment works: database, schema version, bundles, problems.
  `site show` is what the site is. Each one's output points at the other.
- **The version is raised when the site is shipped** (building, 2026-11-03).
  The end-to-end test found that production refuses definitions changed under
  an unchanged version, and that only a hand edit of the file could change it.
  `bundle build` of the site itself, and `push`, now raise it a minor step
  when the definitions changed since this version was first applied here. The
  database's history shows that through each applied version's hash. There is
  no migration and no level is worked out: major and patch steps are left to a
  person.
- **The guides are story 256**, which also gives forms and users guides of
  their own. 252 is the CLI, and the integration test of the whole flow.

## Plan (2026-11-03, revised after 253)

Today, for reference:
- Problems are `SyncReport` problems of `{ file, path, message }`, printed by
  `describeProblem` as `schema/content-types/content-page.toml
  (tab[0].property[1].width): …`. There is no line number, and a file that
  cannot be read is named by a made-up path (`schema/content-types/homePage`).
- About 36 messages in `packages/cli/src` name a schema file or `schema/`. On
  top of those, a `created <path>` line comes from:
  - `types new`, `forms new`, `workflows new`, `webhooks new`;
  - `languages add`, which also reports "No languages.toml";
  - `types sync`, `types check` and `upgrade check`.

1. **Where a problem is.** A function in `packages/schema` turns a problem into
   `{ definition: { kind, alias, name }, part?: { property | tab | group |
   field | stage | … }, file, line? }`.
   - The definition comes from `LoadedSchema.files` read backwards.
   - The part comes from the path (`tab[0].property[1]` gives that property's
     alias).
   - The line comes from finding the key in the file's text.
   - The parsers stop reporting a type as unknown when the file that defines it
     failed to read; that one problem is reported instead.
2. **Messages.** `describeProblem` and the check and sync reports print the
   definition, its part, the problem in plain words and the command that fixes
   it. The `--json` output gains `definition`, `file` and `line`. Each message
   that names a file is rewritten in the same terms:
   - `created  schema/…` becomes "The content type "Article" is added";
   - "No languages.toml" becomes "The site is in English (en-US) only".

   Commands whose job is files stay as they are: `types rewrite`,
   `types export`, `generate`, `bundle build`, `bundle export` and `domains`.
   Content files are content (253): a refusal in one, such as two blocks
   sharing an alias, still names the file.

   While these are rewritten, `bundle apply` stops printing some details as
   `[object Object]` (seen while building 253).
3. **`crombolo init`** prints what it set up ("A site called "Riverside Bakery",
   on SQLite") rather than each file, and its next steps are commands:
   `types new`, `components new`, `content new` and `bun start`. `schema/` is
   named once, as what to commit. `--verbose` lists the files.
4. **`crombolo site show`.** One page that answers "what is this site":
   - its name, languages and URL settings;
   - its types, counted by kind;
   - its forms, workflows, user groups and webhooks;
   - each with the command that shows more.

   It reads the same sources as `types list` and the 251 list commands, and
   takes `-o json`. It goes in the existing `site` topic, beside `site urls`.
   `status` ends with a line pointing at `site show`, and `site show` at
   `status`.
5. **Hand edits.** A definition changed in its file is checked and applied as
   one changed by a command, and the commands then work on it. A test edits a
   file by hand, then runs `types property update` on it.
6. **The flow, as an integration test** (`tests/integration/cli-site.integration.ts`).
   It goes from `crombolo init` to:
   - types, a block list and views;
   - pages made by command (253): `content new`, `content block add` with an
     alias, `content publish`;
   - a form, a group, a workflow, a webhook;
   - pages that render;
   - the pages exported with `bundle export --source`, then a bundle built and
     applied to a second site, which serves the same pages.

   It asserts that no command's text output mentions TOML, `.toml` or
   `schema/`, apart from `init`'s one line.
7. Docs: the CLI reference (generated) and the release note. The guides are
   story 256.

## Implementation (2026-11-03)

- **Where a problem is:** `packages/schema/src/locate.ts`, `locateProblems`.
  - It reads each definition file once. A file's header table gives the
    definition: its kind, with an element type told from a content type, its
    alias and its name.
  - **Parts:** an indexed path (`tab[0].property[1].width`) is walked through
    the file to the part's alias or name. A whole-set check's path
    (`property "body".type`) names the part already.
  - **Lines:** a table and key map of the file gives the line. A named part's
    key is looked for inside that part's own table.
  - **Files that won't read:** Bun's TOML error carries no line, so
    `syntaxErrorLine` in `reader.ts` finds it. It is the first line from which
    every longer start of the file fails to read, which a multi-line array does
    not throw off.
  - **Follow-on problems:** one that names, in quotes, the alias a file that
    won't read appears to define is dropped. That alias is matched from the
    file's `alias = "…"` line.
  - **Keys:** the key after the part (`settings.subject`) is kept. The reader's
    own words, such as "is required", name no key, so it is put in front of
    them: "its workflow "Tell us": subject is required". This was added while
    building 254.
  - **Definitions not yet written:** `types new`, `forms new` and the rest
    check a definition before writing its file. These are named from the
    check's path (`schema/forms/contact`).
- **The words:** `support/describe.ts`.
  - `describeLocated` writes: the definition, its part, the problem, and the
    command that changes it in backticks.
  - `problemsOf` gives each problem as `{ text, message, definition, part,
    file, line }`. It is used by `types check` and `types sync`, by every
    refusal through `refuseProblems`, by applying definitions and by the
    edit-flow check.
  - **Error details:** `reportFailure` in `classify.ts` prints an object detail
    by its `text` or `message`. That is also the fix for `bundle apply`'s
    `[object Object]`.
- **Messages reworded:**
  - `types new`, `forms new`, `workflows new`, `webhooks new` and
    `languages add` print `added    the content type "Page"`. View files are
    code, so `components new` and a type's new view are still named.
  - `languages list`, and the summaries of `languages add`, `types sync`,
    `types check` and `upgrade check`.
  - "There is no crombolo site here", in place of "No schema directory at …".
  - The boot banner's "the database is ahead of the site's definitions".
- **`init`:**
  - It prints the site's name, its database, its template and its front end.
  - One line names `schema/` as what to commit.
  - A plain site's next steps are `types new`, `content new --publish` and
    `bun start`.
  - `--verbose` lists the files.
- **The version:** `raiseVersionIfChanged` in `support/types.ts`.
  - It compares the first current state at the files' version with the files'
    hash. When they differ, it writes the next minor version and applies it.
  - `bundle build` calls it when it builds the site it is run in, not with
    `--check` or `--template`. `push` calls it unless `--dry-run`.
  - The sync's refusal names those commands rather than `schema.toml`.
- **`site show`:** `commands/site/show.ts`, from the definitions plus the
  database's own groups and webhooks. `status` ends with a pointer to it, and
  it with one to `status`.
- **Tests:**
  - `tests/site-terms.test.ts`:
    - the locator: parts, lines, a file that won't read and its follow-on
      problems, and a definition not yet written;
    - the CLI: a hand edit then changed by command, `types check` in words and
      in JSON, a refusal with no `[object Object]`, the new commands' output,
      `site show`, and `init` with and without `--verbose`.
  - `tests/integration/cli-site.integration.ts` builds the whole site by
    command and checks that the bundle serves the same pages on a second site.
  - `new-site.integration.ts` and `upgrade.integration.ts` were updated for the
    new wording.

## Acceptance criteria

- [x] **Messages:** every CLI finding and refusal names the definition (the
      content type "Article", its property "Summary") and the command that
      changes it, not a file and line; `-o json` keeps the file and line for
      tools.
- [x] **`crombolo init`** and its next steps lead with commands; the scaffolded
      `schema/` is mentioned once, as what to commit.
- [x] **A site described in one place:** `crombolo types list` and
      `crombolo site show` (its languages, URL settings, groups, forms,
      workflows, webhooks) are what a person reads to know the site.
- [x] **A hand edit is still welcome:** a definition edited in its file is read,
      checked and applied exactly as one made by a command, and the commands
      then work on it.
- [x] A test walks a site from `crombolo init` to a working site with forms,
      groups and a deploy using commands alone and asserts no command's output
      mentions TOML or a schema path.
