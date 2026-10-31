# 229 — A workflow nobody can approve says so

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 028

## Story

As an editor sending a page for approval, I want to be told when a stage has
nobody who can approve it, so that a page does not wait forever for an approval
that cannot come.

## Context

Found 2026-10-31. `approvalsNeeded` (`packages/core/src/workflows.ts`) never
asks for fewer than one approval, and only a member of a stage's groups gives
one. A stage naming a group that does not exist, or one with no members, can
never be approved: a page sent through it waits, and nothing explains why.

## Decision to make before starting

- Whether sending is refused while a stage on the path has nobody to approve it,
  or allowed with a warning, the request waiting until someone joins the group.

## Acceptance criteria

- [ ] A status check (group Content) names each workflow stage whose groups do
      not exist or have no members.
- [ ] Sending a page through such a stage follows the decision above, with a
      message naming the stage and its groups.
- [ ] The workflow designer marks a stage naming a group that does not exist.
- [ ] Tests on both engines.
