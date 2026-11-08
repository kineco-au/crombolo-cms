/**
 * Story 298: site code writes pages by alias, and handles content events. The
 * pure parts: values to and from the stored shape, what the config's `events`
 * may say, who hears an event, and how the audit names the code that acted.
 */
import { describe, expect, test } from 'bun:test'
import { actorNote, userActor } from '@crombolo/content'
import type { DocumentValue } from '@crombolo/core'
import {
  documentName,
  eventVia,
  fromDocumentValues,
  isOwnChange,
  siteEventOf,
  siteEventProblems,
  subscribersFor,
  toDocumentValues,
} from '@crombolo/server'

const PROPERTIES = [
  { alias: 'title', variesByCulture: true },
  { alias: 'price', variesByCulture: false },
]
const value = (alias: string, culture: string | null, v: unknown): DocumentValue => ({
  alias,
  culture,
  segment: null,
  value: v,
})

describe('values by alias', () => {
  test('a plain value for an invariant property, by culture for one that varies', () => {
    expect(
      toDocumentValues({ price: 12, title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' } }, PROPERTIES),
    ).toEqual({
      values: [
        value('price', null, 12),
        value('title', 'en-GB', 'Hi'),
        value('title', 'fr-FR', 'Salut'),
      ],
    })
  })

  test('a plain value of a varying property goes to the culture given', () => {
    expect(toDocumentValues({ title: 'Hi' }, PROPERTIES, { culture: 'en-GB' })).toEqual({
      values: [value('title', 'en-GB', 'Hi')],
    })
  })

  test('is laid over what the page holds, the rest kept', () => {
    const existing = [value('price', null, 1), value('title', 'en-GB', 'Old')]
    expect(toDocumentValues({ price: 2 }, PROPERTIES, { existing })).toEqual({
      values: [value('price', null, 2), value('title', 'en-GB', 'Old')],
    })
  })

  test('refuses a property the type has not got, and a varying one with no culture', () => {
    const refused = toDocumentValues({ colour: 'red', title: 'Hi' }, PROPERTIES)
    expect('errors' in refused && refused.errors.map((e) => e.field)).toEqual(['colour', 'title'])
  })

  test('read back by alias, by culture where the property varies', () => {
    expect(
      fromDocumentValues(
        [value('price', null, 12), value('title', 'en-GB', 'Hi'), value('title', 'fr-FR', 'Salut')],
        PROPERTIES,
      ),
    ).toEqual({ price: 12, title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' } })
  })

  test('a name, or one per culture', () => {
    const variant = (culture: string | null, name: string) =>
      ({ culture, segment: null, name }) as never
    expect(documentName({ variants: [variant(null, 'Home')] })).toBe('Home')
    expect(
      documentName({ variants: [variant('en-GB', 'Home'), variant('fr-FR', 'Accueil')] }),
    ).toEqual({
      'en-GB': 'Home',
      'fr-FR': 'Accueil',
    })
  })
})

describe('the config’s events', () => {
  test('name events the site raises, each a function', () => {
    expect(siteEventProblems({ 'Umbraco.ContentPublish': () => {} })).toEqual([])
    expect(siteEventProblems({ 'Umbraco.Nothing': () => {}, 'Umbraco.ContentSaved': 3 })).toEqual([
      'The site handles "Umbraco.Nothing", which is not an event this site raises.',
      'The site\'s handler for "Umbraco.ContentSaved" is not a function.',
    ])
  })

  test('the site hears what it handles, except a handler’s own change to its page', () => {
    const key = '11111111-2222-3333-4444-555555555555'
    const publish = { alias: 'Umbraco.ContentPublish', key }
    const handles = (alias: string) => alias === 'Umbraco.ContentPublish'
    expect(subscribersFor(publish, undefined, [], [], handles)).toEqual(['site'])
    expect(
      subscribersFor(
        { ...publish, via: eventVia('Umbraco.ContentSaved', key) },
        undefined,
        [],
        [],
        handles,
      ),
    ).toEqual([])
    // A handler's change to another page is heard.
    const other = eventVia('Umbraco.ContentSaved', '99999999-2222-3333-4444-555555555555')
    expect(subscribersFor({ ...publish, via: other }, undefined, [], [], handles)).toEqual(['site'])
    expect(isOwnChange({ key, via: `route POST /x` })).toBe(false)
  })

  test('an event as a handler receives it', () => {
    expect(
      siteEventOf({
        alias: 'Umbraco.ContentPublish',
        key: 'k',
        contentTypeAlias: 'listing',
        cultures: ['en-GB'],
        actor: { kind: 'user', name: 'Site code' },
      }),
    ).toEqual({
      alias: 'Umbraco.ContentPublish',
      key: 'k',
      contentType: 'listing',
      cultures: ['en-GB'],
      actor: { kind: 'user', name: 'Site code' },
    })
  })
})

describe('the audit', () => {
  test('names the site code a change came through', () => {
    const principal = { id: 'u', name: 'Site code' } as never
    expect(actorNote(userActor(principal, { via: 'route POST /api/listings' } as never))).toBe(
      'through route POST /api/listings',
    )
    expect(
      actorNote(
        userActor(principal, {
          via: eventVia('Umbraco.ContentPublish', '11111111-2222-3333-4444-555555555555'),
        } as never),
      ),
    ).toBe('through event Umbraco.ContentPublish')
    expect(actorNote(userActor(principal))).toBeUndefined()
  })
})
