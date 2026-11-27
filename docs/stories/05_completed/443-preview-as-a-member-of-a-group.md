# 443 — Preview as a member of a group

**Epic:** O — Building a site · **Priority:** should · **Size:** M
**Depends on:** 264

## Story

As an editor, I want to preview a page as a member of a group, or signed out, so that I
can check what each kind of visitor will see without needing access to members' details.

## Context

`264` added a visitor switch to the preview toolbar: signed out, or a real member chosen
with Umbraco's member picker, and only for a user who can open Members
(`/crombolo/crombolo/api/preview-member`, `preview-member.js`, `preview-member-app.js`).
It turned down a made-up member in chosen groups, because a part that looks the member
up would show nothing, and letting any editor choose a member, because it shows a
member's details to someone without Members access.

Preview doesn't apply a page's Public Access rules. It renders the draft whoever the
visitor is, so an editor can always see a protected page. What most editors can't check
is how the page looks **to each kind of visitor**: personalised parts, `site()` queries,
search results and protected media all depend on the member's groups, and only someone
with Members can choose a member. A site may also have no real member in a group yet
(one being built, or one whose members live on the site that serves it, `388`). A group
shows nobody's details, so it can be offered to everyone who previews.

## Decided (2026-11-27)

1. **Preview stays exempt from Public Access.** The chosen visitor changes what the
   page's code sees, never whether the page is shown. Applying the rules once a visitor
   was chosen, and always, were both considered and set aside.
2. **Chosen groups replace the real member.** The switch offers signed out, or a member
   of chosen groups. Previewing as a real member, and its Members-only check, go. This
   reverses part of `264`. A part that reads a member's own properties can no longer be
   checked against a real member in preview.
3. **Anyone who may preview the page** may preview it as chosen groups, and the groups
   are listed by name only. Limiting it to those who may set Public Access was set aside:
   most editors couldn't use it.

## The design

- **The stand-in** is a `RequestMember`:
  - key: the empty UUID, so a lookup by key finds nobody;
  - name: "Preview member";
  - username and email: empty;
  - properties: none;
  - `roles`: the chosen groups' names, which `memberMayOpen`, media's `memberMay`,
    `site()` queries and search read.

  The switch says beside the choice that parts which look the member up show what they
  show for an unknown member.
- **Writes as the stand-in are refused:** `site().members` updating itself, or a form
  sent as the member. Its key is nobody's, so each answers as for an unknown member.
- **The cookie** (`crombolo-preview-member`) carries `g:<group key,…>`, signed with the
  user's id as now.
  - Groups are kept by key and named when rendering, so renaming a group doesn't break a
    preview in progress.
  - A deleted group is dropped, and with none left the preview is signed out.
  - A `264` cookie naming a member is read as signed out.
- **The route** `GET|PUT {pluginPath}/api/preview-member` is for anyone who may preview.
  - `GET` answers `{ groups: [{ key, name }], chosen: { groups } | null }`.
  - `PUT` takes `{ groups: [key…] }`, or `{ groups: [] }` for signed out. An unknown key
    is refused with a sentence.
  - Each switch is recorded in the audit log as `preview as groups`, with the group
    names, or as `preview signed out`.
- **The toolbar** (`preview-member-app.js`) offers "Signed out" and "A member of…"
  (choose groups). Umbraco's member picker goes.
- **The live site never reads the cookie.** Only `renderPreview` does.
- **`MemberAuth.byKey`**, added by `264` for previewing as a member, is removed if
  nothing else uses it.

## Built

- **`packages/server/src/preview-visitor.ts`:** the stand-in (`previewStandIn`, key
  `PREVIEW_STAND_IN_KEY`), the cookie's `g:<keys>` value and its reading
  (`previewGroupKeys`, which answers no groups for anything else, so a `264` cookie naming
  a member is signed out), the group list by name, and the chosen groups that still exist.
- **`server.ts`:** `choosePreviewMember` is open to any signed-in back-office user. `GET`
  answers `{ groups: [{ key, name }], chosen: { groups: [{ key, name }] } | null }`, the
  chosen groups named as they are now. `PUT { groups: [key…] }` refuses a body without a
  list (400) and an unknown key (404, "One of those member groups no longer exists."),
  then records `preview as groups` (names in `entityName` and `detail`, `entityType`
  `memberGroup`) or `preview signed out`. `previewMember`, read only by `renderPreview`,
  turns the cookie into the stand-in, with no Members check.
- **Writes as the stand-in** need nothing new: a page render never writes, and in a write
  scope its key is nobody's, so `site().members` answers "There is no such member." or
  "No member is signed in.". A form posted from a preview goes to the form route, which
  reads the visitor's own member cookie, never the preview's.
- **`MemberAuth.byKey` stays:** a site route called with a member's Delivery API token
  (`memberByToken`) still uses it. Only its "for previewing" note went.
- **Toolbar** (`preview-member-app.js`): "Signed out" and "A member of…", the second a
  list of the groups to tick, the note about parts that look the member up, and a Preview
  button. Umbraco's member picker is gone; the switch shows for everyone.
- **Tests:** `tests/personalised-parts-backoffice.test.ts` ("previewing as a member of a
  group") replaces the real-member tests; the browser journey is in
  `tests/browser/personalised-parts.browser.ts`. The `264` cookie is forged with the
  site's signing secret, so it is a validly signed old cookie that reads as signed out.
- **Docs:** `docs/writing-components.md` (the back office's help for personalised parts)
  and the release notes. `docs/changes.md` describes the history of changes (`381`) and
  has nothing on preview, so it is not changed.

## Acceptance criteria

- [x] **An editor without Members** previews a page as a member of chosen groups.
      Its personalised parts, `site()` queries, search results and protected media
      show what those groups would see, and the page itself is shown whatever its
      Public Access.
- [x] **The site's code** sees a signed-in member in the chosen groups, with no key or
      properties. A lookup by key finds nobody, and a write as the member is refused.
- [x] **No one can preview as a real member,** and a `264` cookie naming one is read as
      signed out.
- [x] **A renamed group** still previews, and a deleted one is dropped.
- [x] **Each switch** is in the audit log.
- [x] **Nothing of the stand-in** reaches a page served outside preview.
- [ ] **Tests:**
  - the stand-in;
  - the cookie, including another user's and a deleted group;
  - the route;
  - the audit;
  - refused writes;
  - the live site ignoring the cookie;
  - `tests/personalised-parts-backoffice.test.ts` updated for the real member's
    removal;
  - the browser suite's journey for the switch.
- [ ] **Docs:** `docs/changes.md` and the release notes updated.
