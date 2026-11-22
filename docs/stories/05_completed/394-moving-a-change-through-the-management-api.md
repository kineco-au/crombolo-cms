# 394 — Moving a change through the Management API

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 383, 388

## Story

As a tool that moves work from one copy of a site to another, I want to export a change
and stage it on the other copy through the Management API, signed in as the person doing
it, so that a site can keep its remote protocol switched off and still take changes.

## Context

A change moves between copies of a site (`383`) only over the remote protocol: the export
of a recorded change or an open workspace (`GET changes/{id}/bundle`,
`GET workspaces/{key}/change`) and the import that checks, stages or applies it
(`PUT changes`). A site that runs with `CROMBOLO_REMOTE_ACCESS=off` has none of them,
although everything after staging (the merge preview, `accept`, the merge itself, the
record of changes and revert) is already on the Management API.

A copy whose content is locked (`388`) takes content only by a change, so whichever
route stages and applies one is the one way past the lock, and has to be held at least
as tightly as the remote's.

## Decisions

Taken in planning (2026-11-22).

- **D1: the paths mirror the remote's, on the APIs that already hold them.**
  `GET changes/{id}/bundle` and `PUT changes` go on the changes API
  (`<plugin>/api/changes`), and `GET workspaces/{key}/change` on the workspaces API
  (`<plugin>/api/workspaces`). They are held by the remote's rights alone, not by the
  changes API's Content section check, so an API user or a tool's exchanged sign-in needs
  no section.
- **D2: any real bearer.** A person's access token, a command-line token (351), an API
  user's client-credentials token or an exchanged one (364), each checked only by the
  rights it holds. That is what the remote takes today, without the cookie. The back
  office's own `Bearer [redacted]` with its cookie is refused, as is a cookie alone.
  - A command-line token that leaks can apply changes until it expires. API users apply
    under their own name, not a person's.
  - A site that wants applying held tightly sets D3's
    `CROMBOLO_APPLY_CHANGES_BY=exchange`.
- **D3: an exchange for applying is told apart by its own audience.** A provider opts in
  with `remoteExchange: { applyAudience }`.
  - A token whose `aud` is that value is exchanged for a sign-in marked as issued for
    applying a change; one with the provider's ordinary audience is not.
  - The site refuses to start when `applyAudience` is a back-office sign-in client id or
    the provider's ordinary exchange audience, as D1 of 364 does for the ordinary one.
  - Under `CROMBOLO_APPLY_CHANGES_BY=exchange`, only a sign-in marked that way is
    honoured for *Apply changes*, on these routes and on the remote's `PUT changes`
    alike, so the remote is no way round it. *Pull* is unaffected.
- **D4: the remote's size limit.** `PUT changes` streams to disk up to
  `CROMBOLO_REMOTE_MAX_UPLOAD_GB`. The listening body limit is raised while workspaces
  are on, even with the remote off. Every other route still checks
  `CROMBOLO_MAX_REQUEST_BODY_MB` per request, so it does not widen.
- **D5: `CROMBOLO_REMOTE_ACCESS` governs the remote alone.** The Management API's routes
  are held by their rights, D3's setting and the content lock (388), so `off` and `read`
  both still take changes through them.

## The design

- **Three routes,** the same work as the remote's:
  - `GET changes/{id}/bundle`: a recorded change, as the tarball the remote gives, with
    `Crombolo-Sha256`;
  - `GET workspaces/{key}/change`: an open workspace, as a change;
  - `PUT changes`, with `check`, `stage`, `into`, `editable` and `accept` as on the
    remote, and the tarball as its body.
- **The same rights as the remote:** *Pull* to export; *Apply changes* to check, stage
  or apply; *Install code* as well when the change carries components or the site's own
  code; and, for the merge that follows, what the merge already asks.
- **Rights before the body:** the sign-in and *Apply changes* are checked before any of
  the body is read, so a caller who may not apply cannot make the site take an upload;
  *Install code* once it is unpacked.
- **Bearer only:** a sign-in token in `Authorization`, never a cookie, so another page in
  a person's browser can't send one.
- **The same limits:** D4's size limit, and `Crombolo-Sha256` required and checked.
- **The same answers,** in the Management API's shape: `{message, blockers?|refusals?}`,
  with each conflict and refusal as the remote lists it. A staged change's
  `{workspace, skipped, conflicts}` and an apply's outcome are the remote's bodies.
- **Optional: apply only by an exchanged sign-in.** `CROMBOLO_APPLY_CHANGES_BY=exchange`
  (D3). A person's own back-office sign-in, however their groups are set, can then not
  stage or apply one, and the tool that exchanges for them decides when it happens.
  Unset, *Apply changes* is honoured for any sign-in that holds it.
- **The record** names the person, as the remote's import does, and the staged
  workspace is theirs. An exchanged sign-in's record also names its provider and actor,
  as 364 and 366 do.

## How it is built

- **One set of routes, two callers** (`remote-changes.ts`): the Management API makes a
  second `createChangeRoutes`, with no level check (`atLeast` always true), a `problem`
  that answers `{ message, detail?, refusals? }`, and the remote's upload limit.
  `streamBody` (the remote's upload stream, moved here) and `mayApplyChanges` are shared
  by both.
- **Routes** (`server.ts`): `managementChange` matches `PUT changes`,
  `GET changes/{id}/bundle` and `GET workspaces/{key}/change`, ahead of the changes
  API's Content section check. `carriesBearer` answers 401 unless `Authorization`
  holds a real token (not `[redacted]`); the principal is then `authenticate`'s, so a
  person's token, a command-line token, an API user's and an exchanged one all count.
- **Exchange mark:**
  - `RemoteExchangeOptions.applyAudience` (`identity-providers.ts`).
  - `exchangeAudienceClashes` stops the boot when it is a sign-in client id or the
    ordinary audience.
  - The exchange (`remote-people.ts`) verifies either audience, refuses a token naming
    both, and passes `forApplying` to `signInByExchange`.
  - `signInByExchange` (`packages/auth`) gives that token the scope
    `crombolo.apply-changes` (`APPLY_CHANGES_SCOPE`). No migration is needed: the scope
    column was already there.
  - `resolveAccessToken` turns the scope into `exchangedForApplying`, and `principalOf`
    into `viaExchange.forApplying`.
- **Setting:** `applyChangesBy` (`CROMBOLO_APPLY_CHANGES_BY`, `any` or `exchange`),
  validated at boot. The remote's change routes and its `applyChanges` capability use
  `mayApplyChanges` too.
- **Body limit:** `listeningBodyLimit` is raised when workspaces are on. The
  per-request check exempts the Management API's `PUT changes`, and now the remote's own
  `PUT changes`, which until now was held to the usual limit.
- **Tests** (`tests/changes-management-api.test.ts`):
  - the export matches the remote's, for a recorded change (same hash) and an open
    workspace;
  - with the remote off, a change is checked, staged (owned by whoever staged it,
    `editable`) and applied;
  - a cookie alone, and `[redacted]` with a cookie, are refused;
  - a missing or wrong hash, and a body over a lowered limit, are refused;
  - Pull, Apply changes, and Install code for a change carrying code;
  - under `exchange`: the administrator's own token is refused, so is an
    ordinary-audience exchange, and a token naming both audiences; an apply-audience
    one applies; the remote refuses alike;
  - the setting's values, and the boot's audience clashes.
- **Docs:**
  - `docs/changes.md`, "Moving a change without the remote";
  - `docs/api.md`;
  - `docs/operations.md`: `applyAudience`;
  - `docs/remote-protocol.md`: the audience check;
  - `docs/configuration.md`: the settings table;
  - the release notes.

## Acceptance criteria

- [x] **A change exported** through the Management API is the same tarball the remote
      gives, for a recorded change and an open workspace.
- [x] **`PUT changes`** checks, stages and applies as the remote's does, with `into` and
      `editable`.
- [x] **Each right is checked** as the remote checks it, code included.
- [x] **A request with only a cookie** is refused.
- [x] **A missing or wrong `Crombolo-Sha256`,** or a body over the limit, is refused as
      the remote refuses it.
- [x] **With `CROMBOLO_APPLY_CHANGES_BY=exchange`,** a back-office sign-in holding
      *Apply changes* is refused, and an exchanged one for applying a change is taken.
- [x] **With the remote off,** all of it works.
- [x] **`docs/api.md`** lists the routes, the rights and the setting.
