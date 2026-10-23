# 179 — The assistant leaves the CMS

**Epic:** N — The assistant · **Priority:** should · **Size:** M
**Depends on:** 178

## Story

As the maintainer, I want the AI assistant removed from the CMS completely, so
that the open-source CMS has no model provider, no cloud SDK and no AI feature
of its own, and an assistant is something an extension provides.

## Context

The assistant (`docs/assistant.md`) is early and changes faster than the rest
of the CMS. It is the only reason the CMS depends on `@aws-sdk`, and it ties
the CMS to one provider's API and prices.

An assistant doesn't need to live in the CMS:
- its actions are Management API calls as the person, which back-office code
  can already make;
- its schema changes have the API's document-type and data-type endpoints;
- its model, prompts and proposals can run on a host's own service, which
  178 lets the back office vouch for the person to.

So the CMS keeps no assistant of its own.

**What there is to remove:**
- The package `@crombolo/assistant`, about 2,200 lines: tools, guardrails, the
  agent loop, MCP, the Bedrock provider.
- In the server:
  - `assistant.ts` and `adapters/assistant.ts`;
  - `adapters/schema-proposals.ts` (only the assistant uses it);
  - `CromboloConfig.assistant`;
  - the lazy mount, the audit exclusion and the manifest suppression in
    `ports.ts`.
- In the umbrella: the `bedrock`, `AssistantProvider`, `BedrockOptions`,
  `ConverseInput` and `ConverseResult` exports.
- In the back office: `plugin/assistant/` (the drawer and its client) and
  `ASSISTANT_MANIFEST_ID`.
- In the data package: migration 017, which created the two `assistant_*`
  tables. It is part of the core chain, since 018 starts from
  `STATE_ASSISTANT`, so it stays as history.
- Four test files, the docs page, and mentions in nine other docs, the README,
  the docs site, the demo site's content and `build-template.ts`'s feature
  card.

## Decisions

- **Removed, not deprecated.** The next minor version drops it, and the
  release notes say so and point extension authors at 178 and at
  "Tools a host provides" in `bundles.md`.
- **The tables are dropped by a new core migration**, not by editing 017.
  Changesets still open are not carried anywhere; the release notes say to
  apply or discard them before upgrading.
- **`@crombolo/assistant` is deprecated on npm** with a pointer to the release
  notes. Published versions stay, as they are MIT.
- **130** (the assistant converts Razor views) moves to `06_abandoned`, since
  the feature it extends is leaving, and Epic N closes with this story.

## Findings (2026-10-23)

- **The AWS dependencies are the assistant's alone.** `@aws-sdk/client-bedrock-runtime`,
  `@aws-sdk/credential-provider-node`, `@smithy/node-http-handler` and
  `@smithy/types` are declared only by `packages/assistant`. SES e-mail
  (`server/src/email-ses.ts`) signs its own requests, so the dependency check
  costs nothing else.
- **Importers of `@crombolo/assistant`:**
  - `server/src/assistant.ts`, `adapters/assistant.ts`,
    `adapters/schema-proposals.ts` and `server/package.json`;
  - `crombolo/src/index.ts` and `crombolo/package.json`;
  - four test files, plus `tests/packaging.test.ts`.
- **In the server:**
  - `config.ts` (`assistant: AssistantConfig`);
  - `ports.ts:477-481` (the manifest suppression, `ASSISTANT_MANIFEST_ID` from
    `backoffice-host/src/manifests.ts`);
  - `server.ts`: the lazy mount, start-up status, the route at 1365-1380 and
    the audit exclusion at 1329.

  179's context puts the mount and the exclusion in `ports.ts`; they are in
  `server.ts`.
- **Back office:** `plugin/assistant/` (`client.js`, `drawer.js`,
  `umbraco-package.json`). The branding and editor-type tests name it.
- **Data:** migration 017 (`schema/assistant.ts`) created `assistant_changeset`
  and `assistant_change`. 018 starts from its state, so it stays.
  `tests/support/db.ts`'s rewind already drops both tables when it replays
  from before 017.
- **Elsewhere:**
  - `compose.yaml`, `apps/site/crombolo.config.ts`, `scripts/build-template.ts`
    (the feature card);
  - the README;
  - three demo content nodes and `sites/crombolo/docs/guides/configuration.md`;
  - `docs/architecture.md`, `audit-log.md`, `configuration.md`,
    `diagnostics.md`, `operations.md`, `packaging-and-upgrades.md`,
    `schema-at-runtime.md` and `umbraco-import.md`;
  - `tests/schema-import.test.ts` and `tests/security.test.ts`, which mention
    it.
- **Story 130** is in `03_ready`, and there is no `06_abandoned` folder yet.

## Plan

1. **Migration 048 (`DropAssistantTables`, the next minor release).**
   `DROP TABLE IF EXISTS assistant_change`, then `assistant_changeset`, on both
   dialects. `IF EXISTS` makes a replay harmless, so the release rewinds
   (`upgrade-from-release`, the integration upgrade, `permissions.test.ts`)
   only reset the state and ledger to before 048. As with 046 and 047, the
   version is bumped to that release when the migration is added.
2. **Remove the package:**
   - `packages/assistant`, and its entries in the root `package.json`, the
     umbrella's dependencies, the publish list and `packaging.test.ts`;
   - `bun install` to drop the AWS packages from `bun.lock`.
3. **The server:**
   - remove `assistant.ts`, `adapters/assistant.ts` and
     `adapters/schema-proposals.ts`;
   - in `server.ts`, remove the mount, the start-up status, the route and the
     audit exclusion;
   - in `ports.ts`, remove the manifest suppression;
   - in `config.ts`, remove `assistant`.

   `loadConfig` refuses an `assistant` key: "The AI assistant was removed in
   0.26 (story 179): see the release notes, and 'Tools a host provides' in
   docs/bundles.md."
4. **The umbrella:** drop the `bedrock`, `AssistantProvider`, `BedrockOptions`,
   `ConverseInput` and `ConverseResult` exports.
5. **The back office:** remove `plugin/assistant/` and `ASSISTANT_MANIFEST_ID`,
   and update the branding and editor-type tests.
6. **A dependency check** (`tests/packaging.test.ts`) fails when any
   workspace package declares `@aws-sdk/*` or `@smithy/*`.
7. **Configuration:**
   - drop `CROMBOLO_ASSISTANT_MODEL` and `CROMBOLO_ASSISTANT_MCP` from
     `compose.yaml` and `apps/site/crombolo.config.ts`;
   - reword the AWS variables in `settings.ts` for SES only;
   - regenerate `docs/configuration.md` (`bun run docs:config`).
8. **Docs and content:**
   - delete `docs/assistant.md`;
   - reword or remove every mention listed above, including the demo nodes
     and its docs guide;
   - drop the feature card in `build-template.ts`, then rebuild the template;
   - correct `audit-log.md`'s claim that the router records the assistant's
     changes.
9. **Stories:** 130 moves to a new `06_abandoned` with a line saying why, the
   index shows it, and Epic N is marked closed.
10. **Release notes:**
    - the removal, and that an `assistant` key now refuses to start;
    - apply or discard open changesets before upgrading, because migration 048
      drops their tables;
    - `@crombolo/assistant` is deprecated on npm;
    - how a host provides such a tool now (177, 178).

    The deprecation itself (`npm deprecate @crombolo/assistant …`) is
    outward-facing, so it is done when this ships, on the maintainer's say-so,
    not as part of the build.
11. **Tests:** both dialects' full suites, and the integration suite, because
    the migration chain changes.

## What was built

- **The contract rule changed** (your decision, 2026-10-23): breaking changes
  are allowed before 1.0.
  - `mayShipContract(release)` in `data/src/migrations.ts` allows a contract
    in any 0.x release and, from 1.0, only in `x.0.0`. Bundles follow it
    against their own versions.
  - The rule's docs are updated in `packaging-and-upgrades.md`, `bundles.md`
    and `operations.md`, and its tests in `migrations.test.ts` and
    `bundle-tables-rules.test.ts`.
- **Migration 048, `DropAssistantTables`**, a contract of 017 in 0.26.0. It
  drops both tables with `IF EXISTS`, so the release rewinds only reset the
  state and the ledger (`upgrade-from-release`, the integration upgrade,
  `permissions.test.ts`). The umbrella's migration declaration is now
  `breaking`, as `release:version` writes it. The two tests that assumed an
  all-expand plan now take each step's own kind.
- **Removed:**
  - the `packages/assistant` package;
  - `server/src/assistant.ts`, `adapters/assistant.ts` and
    `adapters/schema-proposals.ts`;
  - the server's lazy mount, start-up status, route and audit exclusion;
  - the manifest suppression and `ASSISTANT_MANIFEST_ID`;
  - `plugin/assistant/`;
  - `CromboloConfig.assistant`, and the umbrella's `bedrock` exports;
  - the four assistant test files and `docs/assistant.md`.
- **Refusal:** `loadConfig` refuses an `assistant` key, naming the release
  notes and "Tools a host provides" (`tests/assistant-removed.test.ts`).
- **The cloud SDK is gone:** `bun.lock` has no `@aws-sdk` or `@smithy` entries,
  and `packaging.test.ts` fails if any package declares one.
- **Configuration and content:**
  - `AWS_PROFILE`, read only by the assistant, is removed, as are its
    `~/.aws` mount and the assistant variables in `compose.yaml`;
  - the other AWS variables now describe SES only;
  - the reference site's config no longer has `assistant`;
  - the template's assistant feature card is now "Edits that never overwrite
    each other" (172);
  - the docs, the README and the docs site's configuration guide no longer
    mention the assistant;
  - `audit-log.md` no longer claims the router records the assistant's
    changes.
- **Stories:** 130 is in `06_abandoned` with the reason, and Epic N is marked
  closed.
- **Release notes:**
  - the removal;
  - apply or discard open changesets first;
  - the refused key, and the gone exports and variables;
  - upgrade a cluster in one step rather than one server at a time;
  - how a host provides such a tool now.
- **Not done here:** `npm deprecate @crombolo/assistant` is a publishing step,
  left for the maintainer when this ships.

## Acceptance criteria

- [x] Nothing in the repository imports `@crombolo/assistant`, and the package
      is gone from the workspace, the publish list and `packaging.test.ts`.
- [x] `@crombolo/crombolo` no longer exports `bedrock` or the assistant's
      types, and `defineConfig` refuses an `assistant` key, naming this story
      and the release notes rather than silently ignoring it.
- [x] No package depends on `@aws-sdk/*`, `@smithy/*` or
      `@aws-sdk/credential-provider-node`, which a dependency check holds.
- [x] A core migration drops `assistant_changeset` and `assistant_change` on
      both dialects; 017 is unchanged.
- [x] The back office has no assistant header app, and the branding and
      editor-type tests no longer list it.
- [x] `CROMBOLO_ASSISTANT_MODEL` and `CROMBOLO_ASSISTANT_MCP` are gone from
      `compose.yaml` and `apps/site/crombolo.config.ts`. The AWS variables'
      descriptions in `settings.ts` and `configuration.md` no longer mention
      the assistant; they stay for SES.
- [x] `docs/assistant.md` is removed, and every other mention is gone or
      reworded: the README, the docs listed above, the docs site, the demo
      content and its scaffolds.
- [x] The release notes announce the removal, the dropped tables, the npm
      deprecation, and how a host provides such a tool now (177, 178).
- [x] Both dialects' suites pass.
