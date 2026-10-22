# 056 — An app renders a form itself

**Epic:** F — Headless · **Priority:** could · **Size:** M
**Depends on:** 051

## Story

As a front-end developer, I want a form's fields, pages and rules as data, and
a way to submit it from the browser, so that forms editors build in the
backoffice appear in my app.

## Context

Submitting already speaks JSON: `POST /crombolo/forms/<formKey>` with
`Accept: application/json` answers `200 {ok, message, entryId}` or
`422 {ok: false, errors}` ([`forms.md`](../../forms.md), "Submitting"). Two
things stop an app using it:

- there is no way to read a form's definition; only the `<Form>` component
  renders one, server-side
- the anti-spam token is an HMAC over `formKey|renderedAt`, signed while the
  page renders, so an app has nowhere to get one, and without it the timing
  guard refuses the submission

A `formPicker` property in the Delivery API is today only a reference.

## Acceptance criteria

- [x] `GET .../forms/{key}` answers the form as data: pages, fieldsets, fields
      with their type, label, help text, choices (prevalue sources resolved),
      validation and conditions, and the thank-you message or redirect, in the
      requested culture
- [x] The answer includes a fresh token, so the timing guard and the honeypot
      apply to an app's submissions as to a rendered form
- [x] A `formPicker` property can be expanded to the same shape
- [x] File uploads work from `fetch` with `multipart/form-data`
- [x] Field and workflow types from a bundle (story 095) describe themselves in
      the definition, so an app can recognise a type it does not know
- [x] Documented in `forms.md`; tests for reading, submitting and the guards

## What was built

- **The shape**, `apiForm` and `apiFormReference` in
  `packages/api-delivery/src/forms.ts`: a whitelist of what a visitor sees and
  answers, field types described from the registry (`FormTypes`, so a bundle's
  types carry their bundle and declared settings), and `submit` with the token
  fields, the honeypot and the page field.
- **`GET v2/forms/{key}`** through a `forms` port: `byKey` (key, then alias)
  and `shaper(culture, request)`, which the server builds from
  `PublishedCache.formTools` — a new synchronous resolver of choice sources and
  page addresses — signing a token for now with the site's form key and making
  `action` absolute on the CMS's origin. `no-store`.
- **The form picker**: `deliveryValue` now writes `apiFormReference`, or the
  shape when expanded (`OutputContext.form`), and an answer that drew a form is
  `no-store`. *Found on the way:* it used to write the stored definition, so a
  public Delivery API exposed every picked form's workflows and their settings.
- **Submissions** were already multipart and answered JSON; they now carry CORS
  headers on the Delivery API's origins and answer a pre-flight, and take their
  culture from `Accept-Language` before the referer, since an app's referer is
  its own site.
- Tests: `tests/delivery-forms.test.ts` (the shape and what it leaves out, a
  bundle type, a cross-origin multipart submission with a file, a refused one,
  the pre-flight, the form picker plain and expanded).
