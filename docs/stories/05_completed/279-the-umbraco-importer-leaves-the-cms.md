# 279 — The Umbraco importer leaves the CMS

**Epic:** H — Importing a site · **Priority:** should · **Size:** M
**Depends on:** 278

## Story

As a maintainer of the CMS, I want `crombolo import umbraco` and its package
gone from this repository, so that moving from Umbraco has one home,
in Crombolo Cloud, and the CMS carries no code it does not use.

The command carried a deprecation notice from `105`. It now refuses, saying
where a move from Umbraco is offered.

## Acceptance criteria

- [x] `packages/import-umbraco`, `crombolo import umbraco report` and `apply`,
      `packages/cli/src/support/umbraco.ts` and the dependency on
      `@kineco-au/bacpac-importer` are removed; `crombolo import <file>`
      stays, as whole-site files are the CMS's own, and `crombolo import umbraco`
      says where to go.
- [x] The tests and fixtures that served only the importer go with it
      (`tests/import-umbraco*.ts`, `tests/support/umbraco-import.ts`,
      `tests/fixtures/umbraco`), and `tests/url-options.test.ts`,
      `tests/shard-weights.json` and `scripts/check-sql.ts` stop naming it.
- [x] `docs/umbraco-import.md` is removed; the README, `docs/architecture.md`,
      `docs/bundles.md`, `docs/testing.md`, `docs/operations.md`,
      `docs/overview.md`, the CLI's reference and the site's documentation
      pages say that a move from Umbraco is offered by Crombolo Cloud.
- [x] `072` and `190` leave this board with the importer.
- [ ] The release notes name the removed command. Published versions of
      `@crombolo/import-umbraco` stay on the registry, deprecated.
