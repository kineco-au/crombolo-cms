# 277 — The back office on Umbraco 19

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** L
**Depends on:** 235

## Story

As an editor, I want the back office on Umbraco 19's client, so that I get
its fixes and features, shared Library elements in block editors among them,
and Crombolo keeps pace with the client it is built on.

## Context

Found 2026-11-05, planning story `272`. The fork (story `235`) is on Umbraco
18.2.0, and 18.3.0 is out. 19.0.0-beta1 came out on 2026-10-28, and 19.0.0 is
expected in December 2026. Shared Library elements inside block editors
("Reusable Content of Blocks", PR #22448 and its follow-ups) are only in
19. Their editing UI comes from this move, and story `272`, after it, makes the
server take what that UI saves (decided 2026-11-13).

Moving means a new `umbraco/upstream` snapshot, rebasing every `Crombolo: …`
commit on `umbraco/crombolo` onto it, and taking 19's Management API contract
(`packages/contracts/OpenApi.json`), with `coverage:api` showing what 19
added or changed.

## Acceptance criteria

- [ ] `umbraco/upstream` holds 19.0.0, and `umbraco/crombolo` carries every
      Crombolo change rebased onto it, each still its own commit.
- [ ] The contract is 19's; `coverage:api` lists nothing new that is unbuilt,
      and each change is handled or listed as a divergence.
- [ ] Block values saved by the 18.x client, without layout keys, open and
      save in 19's.
- [ ] The vendor, module-graph, outbound and boot checks pass, and the browser
      suite passes.
- [ ] `docs/backoffice-hosting.md` names the release, and the release notes
      say what editors will notice.
