# 160 — Signing in to a remote from CI

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

> **Security critical.** It decides what a machine may do to a live site
> without a person present. The decisions were made on 2026-11-02, and the
> threat model below was reviewed and building approved the same day.

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
The remote endpoints check a person's remote permissions (pull, push, approve).
This story does not use API users (decision 1).

## What the code has (surveyed 2026-11-02)

- **Remote requests:** the remote endpoints accept any back-office access
  token: opaque, stored hashed in `auth_token`, lasting 20 minutes. A request
  acts as the token's user, through `authenticate()` and `principalFrom` in
  `server.ts`.
- **The CLI** signs in only with the device grant and keeps tokens only in the
  operating system's keychain (`remote-credentials.ts`, `support/remote.ts`).
  It reads no credential from the environment.
- **The token endpoint** (`auth/src/routes.ts`) already has a
  `client_credentials` grant for API users. The one seeded API user is an
  administrator. This story does not use it.
- **Remote permissions** are `Crombolo.Remote.Pull`, `PullFull`, `Push` and
  `PushProtected`, held through user groups.
  - **Protected environments:** a push to one needs `--force` and a typed
    name. With `CROMBOLO_REMOTE_APPROVALS`, it also needs approval by someone
    else who holds `PushProtected` (`remote.ts`, `decide()`).
- **Missing whatever the credential:**
  - a rate limit on the token endpoint;
  - refusing `http://` remotes;
  - redacting bearer tokens and the `Crombolo-Passphrase` header in the CLI;
  - marking a machine actor in the audit log;
  - a conformance check of anything but the device grant.

## Decisions (2026-11-02)

1. **The credential is the CI provider's OIDC identity token**, exchanged for
   a short-lived site token. Nothing long-lived is stored anywhere.
   - **Providers:** GitHub Actions and GitLab CI (gitlab.com, and a
     self-managed GitLab named in config).
   - **Turned down:** client credentials against API users, which the server
     half-supports, because they bring back a long-lived secret. Personal
     access tokens, because they need new storage, are long-lived, and tie a
     pipeline to one person's account.
2. **A CI identity may push to protected environments when its trust rule
   says so**, so a production deploy can be fully automated. Keeping every CI
   push to a protected environment waiting for a person was turned down.
   **A CI identity never approves** a push, its own or anyone's.
3. **Trust rules are per site, in its database, managed in Settings** by
   administrators, and every change is audited. Rules in the site's files were
   turned down: a pull request widening trust would take effect on deploy,
   and production's rules would ship beside every other environment's.
4. **Only the OIDC path.** CI with no identity token (Jenkins, a cron job)
   cannot push or pull unattended. No client-credentials alternative is
   planned.

5. **Story 167 adds to what a rule can hold and where it applies**
   (2026-11-02). Rules can also hold `Crombolo.Remote.ApplyStructure`. Every
   remote route answers only up to the site's `CROMBOLO_REMOTE_ACCESS` level,
   which is `off` by default. Whichever story ships first adds the variable.

**On a developer's machine nothing changes:** `crombolo login`, the device
grant, the keychain, acting as that person. The CLI uses, in order:
1. a CI identity token when one is present;
2. the keychain's sign-in;
3. otherwise it fails with `auth` and a hint naming both.

There is no local token issuer for testing the CI path. A real pipeline
against a staging site tests it.

## Threat model (to review)

| Threat | Mitigation |
| --- | --- |
| A forged identity token | Signature checked against the issuer's published keys, fetched over HTTPS from its OIDC discovery and cached. `iss` must be an allowed issuer, `aud` the site's own audience, and `exp`, `nbf` and `iat` current. A token valid for more than an hour is refused. |
| A real token from someone else's repository | Only a trust rule admits a token. Each rule names an issuer and must match its subject exactly: repository or project, and branch, tag or environment. There are no wildcards across owners. A token matching no rule is refused, and the refusal is audited. |
| A token replayed | The site token lasts at most 15 minutes with no refresh. An identity token's `jti` is accepted once. |
| A leaked or misused pipeline | Each rule grants only the remote permissions it lists. An administrator disables it in Settings and its tokens stop working at once. The rule shows when it was last used. |
| Fully automated production pushes (decision 2) | Only a rule that names `PushProtected`. Settings says plainly what that grants. Such a push is audited with the pipeline run that made it. |
| A machine approving pushes | Refused: `decide()` rejects a CI principal, whatever its permissions. |
| Brute force on the token endpoint | Failed exchanges are rate-limited per address and per issuer. |
| A token over plain HTTP | The CLI refuses an `http://` remote except `localhost`, and the server refuses the exchange over plain HTTP unless it is behind a proxy that says HTTPS. |
| Secrets in logs, output or errors | The identity token and site token are never printed, logged or put in an error envelope. The CLI redacts `Authorization` and `Crombolo-Passphrase`, and keeps tokens in memory only. |
| Not knowing who did it | Audit rows name the rule and say the actor is CI, with the repository, branch and run it came from. |
| An unavailable issuer | Its keys are cached. With none cached the exchange fails closed. |

## Plan

1. **Trust rules** (migration 061, `remote_trust_rule`). Each has a key, a
   name, the issuer, the subject it matches (repository or project, and branch,
   tag or environment), its remote permissions, whether it is disabled, who made
   it, and when it was made and last used. A repository and its methods, with
   the claim matching as a pure function for each provider (GitHub:
   `repository`, `ref`, `environment`; GitLab: `project_path`, `ref`,
   `environment`).
2. **The exchange** at the token endpoint: RFC 8693 token exchange
   (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
   `subject_token_type=…:jwt`).
   - **Verifying the token:** `jose`, with each issuer's keys cached.
   - **Issuers:** GitHub's and gitlab.com's are allowed by default.
     `CROMBOLO_REMOTE_OIDC_ISSUERS` adds a self-managed GitLab.
   - **What it issues:** a site token of at most 15 minutes with no refresh.
     Its principal is the rule, not a person: CI, holding exactly the rule's
     remote permissions and nothing else. How it sits in `auth_token` and
     `principalFrom` is settled when building.
   - **Discovery** advertises the grant and the audience to request.
3. **The server's checks:**
   - `decide()` refuses a CI principal;
   - failed exchanges are rate-limited;
   - the exchange needs HTTPS;
   - `jti`s are accepted once;
   - audit rows say CI, the rule, and the run's repository, branch and id.
4. **The CLI** (`support/remote.ts`, `remote/client.ts`):
   - **GitHub Actions:** reads `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN`
     (the job needs `permissions: id-token: write`) and asks for the site's
     audience.
   - **GitLab:** reads `CROMBOLO_ID_TOKEN`, from the job's `id_tokens`.
   - **Exchanging:** the identity token is exchanged in memory, and again on
     a 401.
   - **Hardening:** an `http://` remote is refused except `localhost`, and
     secrets are redacted everywhere.
   - **`whoami`:** says "CI, by the rule <name>" and lists its permissions.
5. **Settings: a "CI access" card** in the Developers group, for
   administrators only.
   - **Lists** the rules, with what each matches and grants, and when it was
     last used.
   - **Adds, edits, disables and deletes** a rule, and says plainly when a
     rule may change protected environments.
   - **A CLI command for administrators** under their own sign-in: `crombolo
     remote trust list|add|disable|remove`.
6. **Protocol and conformance.**
   - **`docs/remote-protocol.md`:** the exchange, its claims and the
     principal.
   - **`@crombolo/remote-conformance`:** checks that discovery advertises the
     grant, and that a bad or unmatched token gets 401 with no detail leaked.
7. **Docs:** `docs/operations.md` gains how to deploy from GitHub Actions and
   from GitLab, with a workflow and a job to copy. Plus the release notes.
8. **Tests.**
   - **A test issuer:** a key pair and a JWKS served inside the test, allowed
     through `CROMBOLO_REMOTE_OIDC_ISSUERS`.
   - **Covered:**
     - the claim matching;
     - each refusal (signature, issuer, audience, expiry, lifetime, replay,
       no rule, disabled rule);
     - the permissions held;
     - protected pushes with and without `PushProtected`;
     - a CI principal refused as approver;
     - the audit rows;
     - the rate limit;
     - redaction;
     - `whoami`;
     - the CLI's choice of sign-in.
   - **Both databases.** The browser covers the Settings card.

## Acceptance criteria

- [x] The threat model above is reviewed and agreed before building starts
- [x] `push`, `pull` and `whoami` run in GitHub Actions and GitLab CI with no
      person present, through a trust rule. They fail with `auth` (exit 4) and
      a hint when the identity token is missing, refused or unmatched
- [x] A rule grants only its listed permissions. One with `PushProtected`
      pushes to a protected environment; one without cannot. No CI principal
      can approve a push
- [x] Administrators manage rules in Settings and with `crombolo remote trust`,
      every change is audited, and disabling a rule stops its tokens at once
- [x] Nothing changes for a developer signing in with `crombolo login`
- [x] No credential appears in output, logs or error envelopes. `http://`
      remotes are refused except `localhost`. Failed exchanges are rate-limited
- [x] Every CI action is audited as CI, with its rule and pipeline run
- [x] `docs/remote-protocol.md` and the conformance suite cover the exchange
- [x] Tests on SQLite and Postgres

## Implementation (2026-11-02)

- **Data** (migration 061, `AddRemoteTrust`):
  - **`remote_trust_rule`:** issuer, repository, ref kind and value,
    permissions, disabled, who made it, last used.
  - **`remote_ci_token`:** the token's hash, its rule, the identity token's
    issuer and `jti` (unique together), the run's claims, and its expiry.
  - **`RemoteTrustRepository`** (`data/src/repositories/remote-trust.ts`).
    Saving, disabling or deleting a rule deletes its tokens. A token resolves
    only while current and while its rule is live.
- **Server** (`server/src/remote-ci.ts`):
  - **Verifying:** with `jose`, already a dependency. Each issuer's key set
    comes from its OIDC discovery and is cached. A local `http://` issuer is
    allowed only on this machine, for tests.
  - **`runClaims`** reads GitHub's and GitLab's claims in one shape, and
    **`ruleMatches`** compares them exactly.
  - **`readRuleInput`** refuses wildcards, unknown providers and anything but
    remote permissions.
  - **The exchange** answers every refusal with the same 400 and audits the
    reason. `AttemptLimiter` slows refusals per address and per issuer.
    Plain HTTP is refused except on this machine.
  - **The principal** is the rule. `Principal.ci` marks it, and it carries
    only the rule's remote permissions.
- **Remote** (`remote.ts`):
  - **Discovery** has `auth.ci` and the `ci-sign-in` capability.
  - **Routes:** `POST token`; `GET me`; the trust endpoints for
    administrators, never CI. The back office reaches the trust endpoints at
    `<backoffice>/crombolo/api/remote-trust`, since the remote's own path is
    outside the back office's.
  - **CI tokens** are accepted on the remote's routes only. `decide()`
    refuses CI before looking at the job.
  - **Audit rows** add the run's repository, ref and run.
- **Config:** `CROMBOLO_REMOTE_OIDC_ISSUERS` adds a self-managed GitLab.
- **CLI:**
  - **`remote/ci.ts`** reads GitHub's request URL and token, or GitLab's
    `CROMBOLO_ID_TOKEN`, and exchanges the identity token in memory, again
    once spent.
  - **`RemoteClient`** takes a token source in place of the keychain.
  - **`discover()`** refuses a remote over plain HTTP that is not on this
    machine.
  - **`whoami`** shows CI as its rule.
  - **`remote trust list|add|disable|enable|remove`.**
- **Back office:** the **CI access** Settings tool, for administrators, in
  Developers (`ci-access.js`, `ci-access-words.js`).
- **Conformance:** a remote advertising `ci-sign-in` must describe the
  exchange, and refuse an unverifiable token with `invalid_grant` without
  repeating it.
- **Tests:** `tests/remote-ci.test.ts`, 19 tests, with a test issuer signing
  real RS256 tokens. They cover:
  - claims and matching;
  - each refusal, with its audit row;
  - the permissions a token holds;
  - protected pushes with and without `PushProtected`;
  - CI refused as an approver;
  - replay, disabling, expiry and the rate limit;
  - HTTPS;
  - managing rules, administrators only;
  - the CLI finding and exchanging a token and keeping it out of errors.

  `remote.test.ts` follows discovery's new capability.
- **Not built:** a browser test of the CI access screen. Its API is
  unit-tested.
