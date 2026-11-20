/**
 * Story 382: each kind of change to the definitions and files has its class, by a
 * table in `@crombolo/core`, and what a removal or a rename is must be accepted
 * by a person. A file's change is told item by item, each with an id to accept
 * it by.
 */
import { describe, expect, test } from 'bun:test'
import { ACCEPTED_BY_NAME, CHANGE_CLASSES, costlier, needsAcceptance } from '@crombolo/core'
import { describeFileChange, unaccepted } from '@crombolo/schema'

const PAGE = `[content-type]
alias = "page"
name = "Page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "summary"
name = "Summary"
type = "textstring"
`

const describe_ = (before: string | null, after: string | null) =>
  describeFileChange('content-types/page.toml', before, after, { definition: true })

describe('the classes of a change', () => {
  test('every kind has one of the four, and every removal or rename is accepted by name', () => {
    for (const cls of Object.values(CHANGE_CLASSES))
      expect(['none', 'additive', 'data-requiring', 'breaking']).toContain(cls)
    for (const kind of ACCEPTED_BY_NAME) expect(needsAcceptance(kind)).toBe(true)
    expect(needsAcceptance('property-added')).toBe(false)
    expect(needsAcceptance('property-editor-changed')).toBe(true)
    expect(costlier('additive', 'breaking')).toBe('breaking')
    expect(costlier('data-requiring', 'none')).toBe('data-requiring')
  })

  test('a change that only adds needs nothing accepted', () => {
    const items = describe_(
      PAGE,
      `${PAGE}\n[[property]]\nalias = "intro"\nname = "Intro"\ntype = "textstring"\n`,
    )
    expect(items.map((i) => i.id)).toEqual(['property-added:page.intro'])
    expect(unaccepted(items, [])).toEqual([])
  })

  test('a removed property is retired, and a changed editor loses data: each accepted', () => {
    const after = PAGE.replace(
      '[[property]]\nalias = "summary"\nname = "Summary"\ntype = "textstring"\n',
      '',
    ).replace('type = "textstring"', 'type = "textarea"')
    const items = describe_(PAGE, after)
    expect(items.map((i) => [i.id, i.class])).toEqual([
      ['property-editor-changed:page.title', 'breaking'],
      ['property-retired:page.summary', 'additive'],
    ])
    expect(unaccepted(items, []).map((i) => i.id)).toHaveLength(2)
    expect(unaccepted(items, ['property-retired', 'property-editor-changed:page.title'])).toEqual(
      [],
    )
  })

  test('renames, rules and variation are told apart', () => {
    const keyed = PAGE.replace(
      'alias = "title"',
      'key = "11111111-1111-4111-8111-111111111111"\nalias = "title"',
    )
    const items = describe_(
      keyed,
      keyed
        .replace('alias = "title"', 'alias = "heading"')
        .replace(
          'name = "Summary"\ntype = "textstring"',
          'name = "Summary"\ntype = "textstring"\nmandatory = true',
        ),
    )
    expect(items.map((i) => i.kind)).toEqual(['property-renamed', 'property-made-mandatory'])
  })

  test('a type and a file added or removed', () => {
    expect(describe_(null, PAGE).map((i) => i.kind)).toEqual(['type-added'])
    expect(describe_(PAGE, null).map((i) => [i.kind, i.accept])).toEqual([['type-retired', true]])
    expect(
      describeFileChange('components/old.tsx', 'x', null, { definition: false }).map((i) => i.id),
    ).toEqual(['file-removed:components/old.tsx'])
  })
})
