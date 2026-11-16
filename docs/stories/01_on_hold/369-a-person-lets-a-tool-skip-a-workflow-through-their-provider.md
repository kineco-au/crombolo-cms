# 369 — A person lets a tool skip a workflow, through their provider

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** 367

## Story

As a person whose host's tool acts for me, I want to let that tool publish over a
workflow I could skip myself, by consenting to it at my provider, so that a tool I
trust doesn't have to wait for approvals I would give myself, and a tool I haven't
trusted never can.

## Context

- **367** gates an exchanged sign-in as the command line: it never skips a workflow,
  and a whole-site push is refused while any page workflow exists. The only way round
  it is the person's own command-line sign-in with `--skip-approval`.
- **A flag the tool sends can't be the override:** the tool would grant itself the
  skip. The grant has to come from the person, signed by someone other than the tool.
- **Providers already ask people for this kind of thing:** a delegated permission (a
  scope) on the remote's app, which the person, or an administrator for the
  organisation, consents to on the provider's own consent screen. The provider then
  signs it into the token: `scp` for Entra, `scope` for the others.

## The design

- **The provider names the scope:** `remoteExchange: { skipWorkflowScope:
  'Workflow.Skip' }`. Unset, nothing changes.
- **The skip applies only when:**
  - the provider's signed token carries the scope, read after every 364 check;
  - the person could skip without the tool: `publishersMaySkip` with Publish on the
    page, or an administrator for a whole-site push.
- **What it covers:** page publishes, unpublishes and branch publishes, and the
  whole-site push 367 refuses.
- **The audit** records each skip: "approval skipped, granted through Microsoft", with
  the person and the actor (366).
- **Taking it back:** the person, or an administrator, revokes consent at the provider;
  the next exchange is without it. A sign-in already made keeps it for its 15 minutes.
- **Entra:** a delegated permission on the remote's app registration, marked as
  needing admin consent where the organisation wants that. `operations.md` gives the
  steps.

## Open questions

- **Per session, not per app:** a provider's consent lasts until revoked, so a tool
  can ask for the scope again without the person seeing it. Asking in the back office
  for each sign-in instead ("Acme console asks to publish over workflows; allow?") is
  stronger and about M: a waiting state, a screen, a notice and expiry. Decide which
  when this story is planned.

## Threat model

| Threat | Mitigation |
| --- | --- |
| The tool granting itself the skip | The scope is read only from the provider's signed token, never from the request. |
| A skip beyond the person's own rights | The person must be able to skip without the tool; the scope only passes that on. |
| A consent left in place | Revoked at the provider; every use is audited with the person and the tool. |

## Acceptance criteria

- [ ] With `skipWorkflowScope` set and the scope in the token, an exchanged sign-in
      skips a workflow its person could skip, and the audit says so.
- [ ] Without the scope, or for a person who couldn't skip, it is gated as in 367.
- [ ] A whole-site push follows the same rule.
- [ ] `docs/workflows.md`, `docs/remote-protocol.md` and `docs/operations.md`
      describe it.
