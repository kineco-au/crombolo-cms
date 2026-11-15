# 358 — Blueprints from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** S
**Depends on:** 349

## Story

As an editor, I want to save a page as a blueprint and start pages from one
from the CLI, so that a scripted site can use the same starting points editors
use.

## Context

Story 349, G11. Blueprints (Umbraco's content templates) are made from a page
and offered when a page is created. The CLI only carries them in an export
(`site export --with-blueprints`).

## What is there to build on

- **The blueprint port** (`packages/server/src/adapters/blueprints.ts`,
  `createBlueprintPort`) is what the back office's handlers call
  (`packages/api-management/src/handlers/document-blueprint.ts`):
  - `fromDocument(documentKey, { key, name, parentKey }, principal)` copies a page's
    current draft (its values and its variants) under a new key. It names the
    invariant variant `name` and keeps each culture's own name;
  - `forContentType(typeKey, paging)` gives the blueprints of a type, by name;
  - `remove(key)` deletes one for good. Blueprints have no recycle bin;
  - `byKey(key)` and the Settings tree (`treeRoot`, `treeChildren`), with folders.
- **How they are stored.** A blueprint is a document of its own object type
  (`DocumentRepository` with `kind: 'blueprint'`, `packages/data/src/repositories/documents.ts`),
  in a folder tree of its own, never published.
- **A surprise: blueprints don't go through the content operations.** The port writes
  through the repository, so it records no events and no audit. The back office's
  rules live around it:
  - **Sections** (`packages/api-management/src/authorization.ts`):
    - `from-document` and `scaffold` need Content;
    - a type's blueprints need Content;
    - the tree, saving one and deleting one need Settings.
  - **On the page**, making one needs Create (`PostDocumentBlueprintFromDocument:
    [D.Create]`). `Umb.Document.CreateBlueprint` is pruned to Create
    (`packages/core/src/permissions.ts`). `mayAt` (`packages/content/src/policy.ts`)
    is the check that operations use.
  - **The audit**: the HTTP audit layer (`packages/api-management/src/audit.ts`)
    writes `content` / `DocumentBlueprint` / `Create` for one made from a page, and
    `Delete` for one deleted.

  The CLI therefore checks the same things itself, and writes its entry through the
  command's `static audit`, as `dictionary import` does.
- **Starting a page from one** is two steps in the back office. `scaffold` answers
  the blueprint's values under a fresh key, and the page is then created as any page
  is, so the content operations, approvals included, apply. `content new`
  (`packages/cli/src/commands/content/new.ts`) builds its values with
  `withValuesSet(site, …, existing, sets, …)` (`support/pages.ts`). The blueprint's
  values are what goes in as `existing`, so `--set` changes them as it changes a
  page's.
- **Names aren't unique.** The back office lets two blueprints share a name, even for
  one type. A name given on the command line is resolved within its type, and
  refused when it matches more than one, with their keys listed.

## Decisions

None. `fromDocument`, `forContentType`, `remove` and the content operations'
`create` are already the back office's code. The rules around them (sections,
Create on the page, the audit entry) are fixed by the back office, and the plan
copies them.

## Plan

1. **`support/blueprints.ts`**, for the three commands and `content new`:
   - `withBlueprints(work)`: the site's database, `createBlueprintPort` (with the node
     state, as `ports.ts` makes it) and the page site from `withPages`;
   - `findBlueprint(port, ref, typeKey?)`: by key, or by name within a type
     (`forContentType`), or across every type by walking the tree. No match is "There
     is no blueprint called …"; two or more are refused with their keys listed.
2. **`content blueprint new <name> --from <page>`**, with `access: 'site'` and the
   Content section:
   - the page found by `findPage`;
   - for a signed-in person, `mayAt(person, [DocumentPermissions.Create], chain)`,
     where `chain` is the page's ancestry from its node path. A refusal says "You may
     not make a blueprint from this page.";
   - a name already used by a blueprint of that type is refused, since `--blueprint`
     names it later. The hint says `content blueprint remove` frees it;
   - `port.fromDocument(page.key, { key, name, parentKey: null }, principal)`, as the
     signed-in person or the command line;
   - `static audit`: `content`, `Create`, `DocumentBlueprint`, with `auditKey` set to
     the new key;
   - it prints "Saved "/About" as the blueprint "Landing page" (contentPage)".
3. **`content blueprint list [--type <alias>]`**, with `access: 'site'` and the
   Content or Settings section:
   - with `--type`, `forContentType`; otherwise the tree, walked;
   - one line each: name, type and folder, with the key in `-o json`.
4. **`content blueprint remove <name> [--type <alias>] [--yes]`**, with
   `access: 'site'` and the Settings section, as the back office's delete:
   - it asks first at a terminal, as `recycle-bin empty` does, since it can't be
     undone;
   - `static audit`: `content`, `Delete`, `DocumentBlueprint`.
5. **`content new <path> --type <alias> --blueprint <name>`**:
   - the blueprint is resolved within the type. One of another type is refused:
     "“Landing page” is a blueprint for Content page, not News page.";
   - `--type` may be left out when `--blueprint` is given, since the blueprint has
     one;
   - its values are `existing` for `withValuesSet`, so `--set` and `--set-file` change
     what it gives;
   - the page is named by the path, and the blueprint's other languages come with it;
   - the page is then made through `operations.create` or `createAndPublish`, as
     today, so placement, approvals and the audit are unchanged.
6. **Words.** "blueprint" is the back office's word, and the help says what one is:
   "a page's values saved as a starting point for new pages of its type".
7. **Docs.**
   - `docs/building-a-site-from-the-cli.md`, "Pages": starting pages from a
     blueprint;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
8. **Tests.**
   - `tests/content-blueprints-cli.test.ts`:
     - `new` from a page with values in two languages, and its name taken for that
       type refused;
     - `list`, all and by `--type`;
     - `remove` by name, an ambiguous name refused with its keys, and `--yes`;
     - `content new --blueprint` with and without `--set`, without `--type`, and a
       blueprint of one type refused for another;
     - the audit entries for `new` and `remove`, and the page's own `Create`;
     - at `sign-in`: a person without Create on the page refused for `new`, and one
       without Settings refused for `remove`.
   - SQLite only: no table or column changes, only the existing port and repository.
   - No browser tests: nothing in the back office changes.

## Acceptance criteria

- [ ] `crombolo content blueprint new <name> --from <page>` saves a page's values as a
      blueprint of its type
- [ ] `content blueprint list [--type <alias>]` and `content blueprint remove <name>`
- [ ] `content new <path> --type <alias> --blueprint <name>` starts the page from the
      blueprint, `--set` changing what it gives
- [ ] `-o json`; audited
- [ ] Tests for each, including a blueprint of one type refused for another
- [ ] The CLI reference regenerated
