---
title: Users and groups
summary: Groups and what they may do, inviting the people in them, approval workflows that ask a group to sign a page off, and webhooks that tell other systems what changed.
order: 4
---

The people who work in the back office are users, and what they may do comes from the groups they are in. A group's name, sections, permissions and languages are part of the site's definitions: built with commands and kept in files you commit. Who is in each group, and where in the tree they start, stay with each environment.

## Groups

```sh
bunx crombolo users groups new editors --name Editors --section content --section media \
  --permission content:read --permission content:update --permission content:publish \
  --language all
bunx crombolo users groups show editors
bunx crombolo users groups list
```

A section is a part of the back office a group may open, and a permission is what it may do there. To see the choices:

```sh
bunx crombolo users groups sections       # each section, and what it holds
bunx crombolo users groups permissions    # each permission, and what it allows
```

A permission is named for its area and its action: `content:publish` publishes pages, `library:publish` publishes Library items, `media:update` changes media, `forms:manage` designs forms and `form-entries:view` reads their entries. A bare `publish` is refused with the areas it could mean. The names the back office keeps, such as `Umb.Document.Publish`, are accepted too; `users groups permissions --verbs` shows each one.

## Changing a group

```sh
bunx crombolo users groups update editors --permission content:delete --remove-section media
bunx crombolo users groups update translators --no-all-languages --language fr-FR
bunx crombolo users groups export marketing           # a group made in the back office becomes the site's
bunx crombolo users groups remove reviewers --move-users-to editors
```

A group made in the back office is listed as such, and is changed from the command line once `users groups export` has made it one of the site's. A group with users in it is removed only with `--move-users-to`, which moves them first. The administrators group stays with each environment.

## Users

```sh
bunx crombolo users invite sam@example.com --name "Sam Lee" --group editors
bunx crombolo users list
bunx crombolo users disable sam@example.com
bunx crombolo users enable sam@example.com
```

`invite` creates the user and prints the link they set their password with, so it works on a site with no e-mail. The link is used once, and expires as an invitation does. `users reset-password` gives a user a new password and ends their sessions, and `users unlock` lets them in again after too many tries.

## Approval workflows

A workflow asks one or more groups to approve a page before it is published:

```sh
bunx crombolo workflows new article-sign-off --name "Article sign-off" \
  --content-type article --approver editors
bunx crombolo workflows stage add article-sign-off legal --approver legal --required all
bunx crombolo workflows stage update article-sign-off legal --send-back editor
bunx crombolo workflows update article-sign-off --self-approval refused --scheduling
bunx crombolo workflows show article-sign-off
```

A workflow covers the content types and branches it names. Its stages run in order: a new stage follows the last ones unless `--after` names others, its approvers are groups the site has, and `--required` says how many of them must approve. A stage sends a page back to its editor, or to a stage before it.

`workflows list` shows each workflow and what is waiting on it. Removing one withdraws the requests waiting on it, and says how many. A page under a workflow is sent for approval from its **Workflow** tab in the back office; `content publish --skip-approval` publishes it anyway, and the audit log records who did.

## Webhooks

A webhook tells another system when something changes:

```sh
bunx crombolo webhooks new searchIndex --url https://search.example/hook \
  --event content-published --event content-unpublished --content-type article
bunx crombolo webhooks update searchIndex --header Authorization=env:SEARCH_TOKEN
bunx crombolo webhooks update searchIndex --no-enabled
bunx crombolo webhooks events
```

`webhooks events` lists the events by name, such as `content-published` and `media-deleted`. A header's value is given as `env:NAME`, with `NAME` set on the server, so a secret is never kept with the site. A change is used from the next delivery, with nothing to apply.

Every change in this guide is checked before anything is written, and takes `--dry-run` and `-o json`.

## Where next

- [Forms](/docs/guides/forms/): forms, and who reads their entries.
- [The `users` commands](/docs/reference/command-line/users/), with every flag.
