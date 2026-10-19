# 160 — Signing in to a remote from CI

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

> **Needs elaboration before work starts.** This is security critical: it
> decides what a machine may do to a live site without a person present. The
> open questions below must be answered, and the threat model written into this
> story and reviewed, before any of it is built.

## Story

As a developer running a deploy pipeline, I want the CLI to sign in to a remote
site without a person approving it in a browser, so that `crombolo push`,
`pull` and `whoami` can run unattended in CI.

## Context

`crombolo login` uses the OAuth device flow (`packages/cli/src/remote/client.ts`):
it prints a code that a person approves at `<backoffice>/device`, and keeps the
tokens in the operating system's keychain only (`Bun.secrets`,
`packages/server/src/remote-credentials.ts`). There is no way to hand the CLI a
credential through the environment, and a CI runner usually has no keychain. So
every remote flow (story 108, and story 167 after it) needs a human, which is
the one thing a pipeline cannot supply.

The site already has machine identities: API users with client credentials
(story 034, `CROMBOLO_API_CLIENT_ID` / `_SECRET`, `crombolo api-client rotate`).
The remote endpoints check a person's remote permissions (pull, push, approve);
whether and how an API user can hold those is undecided.

## Open questions

These are the decisions to make, with the options found so far. None is
settled.

1. **Which credential.** The client-credentials grant against an API user, a
   long-lived personal access token minted from the back office or the CLI, a
   short-lived token exchanged from the CI provider's OIDC identity (GitHub
   Actions, GitLab), or more than one.
2. **What it may do.** Which remote permissions a machine identity can hold;
   whether push is allowed at all without a person's approval, or a machine
   push always waits as a pending approval (story 108's approval step); scoping
   by environment.
3. **How it is stored and handed over.** Environment variables only, a file,
   or an in-memory keychain when the OS has none; what is never written to
   disk; what `whoami` reveals.
4. **Lifetime and revocation.** Expiry, rotation, revoking one pipeline's
   credential without touching others, and what the audit log records for a
   machine actor.
5. **Brute force and leakage.** Rate limits on the token endpoint, refusal over
   plain HTTP, keeping secrets out of logs, error envelopes and `--help`.
6. **Conformance.** What a third-party remote (the hosting platform, story 158)
   must implement, and how `@crombolo/remote-conformance` checks it.

## Acceptance criteria

To be written once the open questions are answered. At minimum:

- [ ] A threat model for unattended remote access, reviewed and recorded here
- [ ] `push`, `pull` and `whoami` run in CI with no person present, using the
      chosen credential, and fail with `auth` (exit 4) and a hint when it is
      missing, wrong or expired
- [ ] The credential never appears in output, logs or error envelopes
- [ ] Every action taken with it is audited as that machine identity
- [ ] `docs/remote-protocol.md` and the remote conformance suite cover it
- [ ] Tests on SQLite and Postgres
