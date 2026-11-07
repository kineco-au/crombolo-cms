# 287 — A template's element has its name

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As a template author, I want an element picked from the Library to give me its name, so
that I can show it, as I can a picked page's or media item's.

## Context

`PublishedContent` and `PublishedMedia` both have `name`. `PublishedElement`
(`packages/render/src/values.ts`) has `key`, `contentType` and `properties`, and no name.

A block has no name of its own, which is why it was left out. A Library element does:
editors name it, and it lists by that name. A common use is a list of labels, such as a
blog post's categories, where the element's name is the only text it has, and its type
has no properties to read instead. In Umbraco 18 a view reads these with `x.Name`, so a
view moved from Umbraco has nothing to become.

## Decisions before implementation

- **`name` on `PublishedElement`,** the Library element's name in the page's culture when
  it varies, with the same fallback as a page's.
- **A block's element has `name` as `null`,** since it has none, rather than an empty string
  that reads as a real value.
- **`crombolo generate`'s types say so:** `string | null`.

## Acceptance criteria

- [x] `(model.value('picked') as PublishedElement[])[0].name` is the element's name.
- [x] A culture-variant element gives its name in the page's culture, with its fallback.
- [x] A block's `content.name` is `null`.
- [x] The Delivery API's picked elements carry the name too.
- [x] Covering tests; `docs/rendering.md` lists it, and the release notes say what changed.

## Technical notes

- `packages/render/src/values.ts`: `PublishedElement`, and the `Umbraco.ElementPicker` case
  in `convertValue`, which takes its elements from `context.element(key)`, so the name
  comes from what that supplies.

## Findings (2026-11-07)

- **Only two places build a `PublishedElement`:** `elementFrom` in `values.ts`, for blocks,
  and the view build in `published-cache.ts`, for the Library. So a block's `null` is the
  default and only the Library path supplies a name.
- **`PublishedElementNode` has no name to pass on.** The node needs `name` and `names`, from
  `adapters/documents.ts`'s `loadElements`.
- **The Delivery API writes `name: ''` for every element** (`api-delivery/src/output.ts`), and
  `ApiElement.name` in `delivery-client` is a `string`.
- **`crombolo generate` needs no change.** `TypedElement` extends `PublishedElement`, and a
  picker's generated type is `PublishedElement` or a `TypedElement`, so `string | null`
  follows from the class. The story's third decision is met by the type alone, which a
  test should pin.
- **Preview uses published elements.** `loadElements` is the only source and there is no
  draft path, so a template in preview shows an element's published name.
- **There are two fallbacks for a culture's name,** `nameIn` and `contentOf`. `contentOf` also
  treats an empty name as missing, so it is the one a page shows.
- **A varying element is only in the views of cultures it is published in,** so the fallback
  only matters for an invariant element or one with an empty name in that culture.

## Decisions (2026-11-07)

- **`name: string | null` on `PublishedElement`,** set from a new optional `name` in its
  constructor's `init`, so a block needs no change.
- **The fallback is `contentOf`'s,** taken out as one small function both use, so a page and
  an element cannot drift apart.
- **The Delivery API keeps `name` a string:** `element.name ?? ''`, so a block still sends `''`,
  and `ApiElement` and existing clients are unchanged.

## Plan

1. `PublishedElementNode` gains `name` and `names?`, and `loadElements` fills them from
   `loadPublished`, whose rows already have both.
2. `published-cache.ts` extracts the name fallback from `contentOf` and passes it to
   `new PublishedElement`.
3. `values.ts` gains `readonly name: string | null`, defaulting to `null`, and `init.name`.
4. `api-delivery/src/output.ts`'s `apiElement` writes `element.name ?? ''`.
5. `docs/rendering.md`'s Element Picker row and block row say what `name` is, and the release
   notes say what changed. Its interface at line 380 describes a far wider shape than the
   class, with `name: string`, and gets corrected to `string | null`.

### Tests

- `tests/elements.test.ts`, in "published elements in a template": a picked element's name, an
  element whose type has no properties, and two cultures with different names.
- `tests/value-converters.test.ts`: a block's `content.name` and `settings.name` are `null`.
- The Delivery API, with a picked element's name and a block's `''`.
- `crombolo generate` output type-checks against `.name` being `string | null`.

### Risks

- **A template that printed `key` for lack of a name** is unaffected, as nothing is removed.
- **`null` in a JSX expression renders nothing,** so a template that does not check a block's
  name shows an empty space rather than an error.

## Implementation (2026-11-07)

- `PublishedElement.name` is `string | null`, set by the Library path alone.
- `nameFor` in `published-cache.ts` is the one fallback, used by `contentOf` and elements.
  `nameIn`, used for URLs, is left as it was.
- The Delivery API sends `element.name ?? ''`, so `ApiElement.name` stays a string.
- `crombolo generate` needed no change.

## Out of scope

- Names on blocks.
