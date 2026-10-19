# 167 — Changing a remote site piece by piece

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 160

> **Needs elaboration before work starts.** Like story 160 this is security
> critical: it widens what can be done to a live site over the network. The
> approach below is a candidate, not a decision.

## Story

As a developer whose sites run somewhere I cannot open a shell, I want to apply
a seed (story 163) or per-environment settings (story 166) to a remote site
over HTTPS, so that setting up and updating a hosted environment needs neither
the back office nor database access.

## Context

The remote protocol (story 108, `docs/remote-protocol.md`) moves **whole
sites**: `pull` takes a site file, `push` replaces the remote's content, schema
and files, keeping its people and domains. There is no remote operation finer
than that. Locally, every other command opens the site's database directly
(`packages/cli/src/support/people.ts`, `support/publish.ts`), which works for a
laptop, a container reached with `docker exec`, or a CI job with network access
to a Postgres database — and not for a hosted site.

## Open question

**How the CLI changes a remote site beyond a whole-site push — deferred.** The
options found so far:

- **(a) Local database only.** Document running the CLI against the target's
  database and media store from CI, or inside its container. No new protocol;
  needs network access to the database, which a hosted platform will not give.
- **(b) A Management API client.** Granular commands call the API with the
  machine identity from story 160. Powerful, but every command gains a second
  implementation, and the CLI starts mirroring the API, which Epic P avoided.
- **(c) A remote "import a bundle" job.** An optional extension of the remote
  protocol that merges a bundle (a seed's, or a package) rather than replacing
  the site, with the import's own check, approval and revert, under the
  credential from story 160.

Each needs: who may run it, whether it waits for a person's approval, what is
audited, how a refused or half-applied change is reported and undone, and what
a third-party remote must implement to conform.

## Acceptance criteria

To be written once the open question is answered and story 160's threat model
exists. At minimum:

- [ ] A seed can be applied to a remote site without a shell on it or access
      to its database
- [ ] The remote checks the change before applying it and reports findings as a
      local `seed apply --dry-run` does
- [ ] Every change is audited as the identity that made it, and can be reverted
- [ ] `docs/remote-protocol.md` and the conformance suite cover it
- [ ] Tests on SQLite and Postgres
