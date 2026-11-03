---
title: Forms
summary: Build a form from the command line — its fields, pages, conditions and what happens when it is sent — pick it on a page, and render it.
order: 3
---

A form is part of the site's definitions, like a content type: it is built and changed with commands, checked before anything is written, and kept in files you commit. Its entries are content, kept in each environment's database and read in the back office's **Forms** section.

## A first form

```sh
bunx crombolo forms new contact --name "Contact us"
bunx crombolo forms field add contact message --type long-answer --caption Message --mandatory
bunx crombolo forms workflow add contact --type send-email --name "Tell the team" \
  --to team@example.com --subject "New enquiry"
```

A new form starts with a name and an e-mail field. `forms show contact` lists its pages, fieldsets and fields in order, and its workflows. `forms list` lists every form, with what uses it.

## Fields

```sh
bunx crombolo forms field add contact topic --type dropdown --option Sales --option Support --after email
bunx crombolo forms field add contact company --type short-answer --caption Company
bunx crombolo forms field update contact message --caption "Your message" --placeholder "How can we help?"
bunx crombolo forms field move contact company --before message
bunx crombolo forms field remove contact company
```

A field's type is one of `short-answer`, `long-answer`, `email`, `number`, `date`, `checkbox`, `dropdown`, `single-choice`, `multiple-choice`, `file-upload`, `data-consent`, `title-and-description`, `rich-text` or `hidden`, or one a bundle adds. The names written as one word, such as `longAnswer`, work too.

A field takes `--mandatory`, a `--pattern` its answer must match, a `--default`, `--option` for each choice, and `--sensitive` for an answer only people allowed to see sensitive answers can read. `--set` stores any other setting by name, read as JSON when it parses, for a field type a bundle adds as much as a built-in one.

## Pages and fieldsets

```sh
bunx crombolo forms page add contact --caption "About you"
bunx crombolo forms field move contact company --page 2
bunx crombolo forms group add contact --page 1 --caption Address --columns 2
bunx crombolo forms page remove contact 2 --move-fields-to 1
```

A page or fieldset is named by its caption or its number, counting from 1. A fieldset is looked for on the first page unless `--page` says otherwise. A page that still holds fields is removed only with `--move-fields-to`.

## Conditions

```sh
bunx crombolo forms field add contact company --type short-answer --show-when topic=Sales
bunx crombolo forms field update contact company --show-when topic=Sales --show-when-any --show-when topic=Partners
bunx crombolo forms field update contact company --show-always
```

`--show-when field=value`, or `field!=value`, shows a field, page or fieldset only when another field has that answer. Give several for all of them, add `--show-when-any` for any of them, and `--show-always` takes the condition away. A field a condition names is not removed until the condition goes.

## When it is sent

A workflow runs when the form is sent, or when an entry is approved with `--on approve`:

```sh
bunx crombolo forms workflow add contact --type send-email --name "Tell the team" \
  --to team@example.com --subject "New enquiry"
bunx crombolo forms workflow add contact --type send-to-url --name "Into the CRM" --url https://crm.example/forms
bunx crombolo forms workflow update contact "Tell the team" --set cc=sales@example.com --on approve
bunx crombolo forms workflow remove contact "Into the CRM"
```

The built-in workflows are `send-email`, `send-to-url` and `save-as-content`; a bundle may add more. A workflow is named by its name. Each change is checked as the form is, so a setting a built-in workflow does not take is refused.

The message shown after sending, or the page to go to instead, is the form's own:

```sh
bunx crombolo forms update contact --message "Thanks, we will be in touch" --redirect-to /Home/Thanks
```

## On a page

A page picks a form with a property of the `formPicker` data type:

```sh
bunx crombolo types property add contentPage contactForm --type formPicker --name "Contact form"
bunx crombolo content update "/Home/Visit us" --set contactForm=contact
```

The view renders it with `<Form>`:

```tsx
import { Form, type PageProps } from '@crombolo/crombolo'

export default function ContentPage({ model, submission }: PageProps) {
  return (
    <main>
      <h1>{model.text('title')}</h1>
      <Form form={model.value('contactForm')} submission={submission} />
    </main>
  )
}
```

`<Form>` draws every page, field and condition, checks the answers on the server, and shows the message once it is sent.

## Removing a form

```sh
bunx crombolo forms remove oldSurvey
```

A form a page or a Library form uses is not removed until nothing does.

Every change in this guide takes `--dry-run`, to say what would change and change nothing, and `-o json`.

## Where next

- [Users and groups](/docs/guides/users-and-groups/): who reads the entries.
- [The `forms` commands](/docs/reference/command-line/types/), with every flag.
