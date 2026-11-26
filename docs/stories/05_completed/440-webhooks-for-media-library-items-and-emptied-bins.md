# 440 — Webhooks for media, Library items and emptied bins

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone running a front end or a host off a site's webhooks, I want to hear of every
change to media and Library items, and of a recycle bin emptied, as I do of pages, so that
nothing I cache goes stale without a word.

## Context

Found 2026-11-26, listing the webhook events (`docs/webhooks.md`).

- **Media is half covered.** `mediaWebhookFor` (`packages/content/src/media-operations.ts`)
  raises `Umbraco.MediaSave` and `Umbraco.MediaDelete` only: moving a media item, moving
  it to the bin, restoring it and sorting raise nothing, though the events are there.
- **Library items raise nothing**, saved, published, unpublished or deleted, so a page
  showing one goes stale in a front end's cache.
- **Emptying a recycle bin raises nothing,** for pages or media (`binEmptied` returns none
  in `webhookFor`), so the items deleted for good raise no delete.
- The webhook filter's event types are `Content` and `Media` only.

## Findings (2026-11-26)

Umbraco's own aliases (`src/Umbraco.Core/Constants-WebhookEvents.cs`, read 2026-11-26):
`Umbraco.ContentEmptiedRecycleBin`; for media `mediaMoved`, `mediaMovedToRecycleBin` and
`mediaEmptiedRecycleBin`, with no media sort; and for its element library
`Umbraco.ElementSaved`, `ElementPublish`, `ElementUnpublish`, `ElementDelete`,
`ElementCopied`, `ElementMoved`, `ElementMovedToRecycleBin`, `ElementEmptiedRecycleBin`,
`ElementRolledBack` and `ElementDeletedVersions`, event type `Element`.

## Decisions (2026-11-26, the maintainer's)

1. **Every event is `Crombolo.` and Umbraco's word for it, in one style,** this site's
   existing events included: `Crombolo.ContentSaved`, `Crombolo.ContentPublish`,
   `Crombolo.MediaSave`, `Crombolo.MediaMoved`, `Crombolo.MediaMovedToRecycleBin`,
   `Crombolo.MediaEmptiedRecycleBin`, `Crombolo.MediaSorted` (Umbraco has none),
   `Crombolo.ContentEmptiedRecycleBin`, and Library items as `Crombolo.ElementSaved`,
   `ElementPublish`, `ElementUnpublish`, `ElementDelete`, `ElementCopied`, `ElementMoved`,
   `ElementMovedToRecycleBin`, `ElementEmptiedRecycleBin`, `ElementRolledBack`.
   `Crombolo.ChangePublished` and the workspace events keep their names.
2. **An old name is refused, naming its new one:** a webhook saved, in a site's files, or
   imported from Umbraco naming `Umbraco.ContentSaved` or `mediaMoved` is refused at boot,
   save and import. Stored webhooks are not rewritten; the upgrade notes say what to change.
3. **Emptying a bin raises one event,** listing every item it deleted by key, in deliveries
   of at most 1,000 keys, each with the same event id.
4. **A Library item's change** raises its own event; with `payload = "crombolo"` it carries
   `UsedBy`, the published pages that show it, up to 1,000, saying when there are more.
5. **No narrowing by element type:** a Library event reaches every webhook that hears it.
6. **The rename reaches every use of an event's name** (2026-11-26, a breaking change):
   webhooks, the site's own event handlers (`events` in `crombolo.config.ts`, story 298) and
   extensions' subscriptions (their manifests' events, and `crombolo extension check`), each
   refusing an old name and naming its new one. An extension naming an old event is refused
   at install and left off at start, saying which name to change.
7. **Webhooks stored in the database are renamed by a migration** (2026-11-26): nobody wrote
   those names by hand, and refusing one at boot would leave a site with no screen to fix it
   from. What a person or a package writes (webhook files, `events` handlers, extensions,
   imports) is refused as decision 2 says. Receivers see the new names in `Webhook-Event`.

## Acceptance criteria

- [x] Every event is named as decision 1 says, in the back office's picker with its words,
      sent as `Webhook-Event`; an old name is refused naming the new, at boot, save and import.
- [x] The site's event handlers and extensions' subscriptions use the new names; an old one
      is refused naming the new, at boot, at install and by `crombolo extension check`.
- [x] A media item moved, moved to the bin, restored or sorted raises its event, as a page does.
- [x] A Library item saved, published, unpublished, copied, moved, binned, rolled back or
      deleted raises its event, through every tool that changes one, with `UsedBy` in
      Crombolo's payload.
- [x] Emptying the pages', the media's or the Library's bin raises one event, its keys in
      deliveries of at most 1,000.
- [x] Each payload, Minimal and Crombolo's, says for media and Library items what a page's
      does, ancestors included.
- [x] A migration renames the events of every webhook stored in the database; it names the
      release it ships in.
- [x] `docs/webhooks.md`, the release notes and their upgrade notes (every old name and
      its new one); tests on both databases.

## What was built

- `webhook-events.ts`: every event `Crombolo.` and its word, `Element` an event type;
  `RENAMED_EVENTS` and `eventNameProblem`, used by webhook files and saves, the site's
  `events`, bundles' handlers; `extensionEventNameProblems` reads an extension's code at
  install and in `crombolo extension check`.
- Migration 104 `RenameWebhookEvents` (0.82.0), the stored webhooks' names, with its rewinds.
- Media (`mediaWebhookFor`): moved, binned, restored, sorted, the bin emptied.
- Pages and media: emptying a bin raises one `…EmptiedRecycleBin` with every key in it and
  below (`branchKeys`), and no delete for each (`fromBin`).
- The Library: `elementWebhookFor`; the Library's operations gain delete, restore, emptying
  the bin and rollback, so each is audited and raises its event, and the Management API goes
  through them; `createElementEventSink` raises the webhook with `usedBy`, the published
  pages showing it.
- `webhooks.ts`: `Keys` for a bin, 1,000 to a delivery under one `Webhook-Event-Id`;
  `UsedBy` and `UsedByMore` in Crombolo's payload; Library and bin events narrowed by no
  content type.
- Tests: `webhook-events-440.test.ts`, `content-tree.test.ts`; the rest renamed.
- Docs: `webhooks.md` and the others naming events, the release notes and upgrade notes.
