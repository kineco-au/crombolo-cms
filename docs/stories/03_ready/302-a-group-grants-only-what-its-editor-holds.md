# 302 — A group grants only what its editor holds

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As an administrator who gives someone the Users section, I want them to manage groups
without being able to grant more than they hold themselves, so that the Users section
is not a way into every page, every verb and every language.

## Context

Creating or updating a group (`validate`, `adapters/users.ts:851`) checks a
non-administrator's sections, and that a start node is within their own. It does not
check:
- root access (`documentRootAccess`, `mediaRootAccess`, `elementRootAccess`);
- the permission verbs, default and granular, including the remote verbs
  `Crombolo.Remote.ApplyStructure` and `InstallCode`;
- the languages, or `hasAccessToAllLanguages`.

Someone may update a group they belong to (`isMember`). So a Users-section user can
give their own group root access, every verb and every language. Where the site's
remote takes structure and code, that reaches views and code too.

Umbraco's `UserGroupService.ValidateAccess` holds a non-administrator to what they
already have. This should behave the same.

## The design

For a caller who is not an administrator, on create and on update:
- **Root access:** only for a tree where they have root access themselves.
- **Verbs:** each default and granular verb must be one they hold, by the same rules
  that decide their own access. A granular verb on a page needs that verb on the page.
- **Remote verbs:** never, from anyone but an administrator.
- **Languages:** only languages they may edit; `hasAccessToAllLanguages` only if they
  have it.
- **On update,** only what changes is held to this, so an existing grant they don't
  hold can stay on a group they edit, but can't be added.
- **A refusal** is `Unauthorized` with the first grant they lack, as Umbraco answers.

## Acceptance criteria

- [ ] A Users-section user without root access can't give a group root access to
      content, media or elements.
- [ ] They can't add a verb they don't hold, default or granular, nor any remote verb.
- [ ] They can't add a language they can't edit, nor all languages.
- [ ] Editing a group that already holds such a grant, without adding to it, succeeds.
- [ ] An administrator is unaffected.
