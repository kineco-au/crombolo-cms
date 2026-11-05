# 274 — Who else is editing a page

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** L
**Depends on:** 172

## Story

As an editor, I want to see who else has the page I am editing open, and
when their changes conflict with mine, to compare the two and keep what I
choose, so that two people working on one page do not lose each other's
work.

## Context

On Umbraco's roadmap ("Editor Collaboration", planned, no date), checked
2026-11-05. Crombolo stops an older copy overwriting a newer one (story
`172`), but the second editor learns of it only on saving, and must reload
and edit again. The server-events channel (`/umbraco/serverEventHub`) already
reaches every open back office and could carry presence.

## Decision to make before starting

- Presence first and comparing later, as two stories, or both together.
- Whether comparing works per property, keeping one side or the other, or
  within a text value.

## Acceptance criteria

- [ ] An open page shows the avatars of the other users who have it open, on
      any node of a cluster, gone within seconds of their leaving.
- [ ] A save refused because the page changed offers to compare it with the
      newer version, property by property, and to keep either side.
- [ ] Presence is not stored as a version and sends no notification e-mail.
- [ ] Tests, and a browser test with two users.
