/**
 * A page's template picker shows every component in a tree of its folders, says
 * which the page's content type allows, and narrows the tree to a search;
 * allowing one adds it to the type's list once.
 */
import { describe, expect, test } from 'bun:test'
import { componentTemplates } from '@crombolo/server'
import {
  componentName,
  filterTree,
  templateTree,
  withAllowed,
} from '../packages/backoffice-host/plugin/template-picker-model.js'

const TEMPLATES = [
  { id: 'A', name: 'Home page', alias: 'pages/homePage' },
  { id: 'B', name: 'Blog post', alias: 'pages/blogPost' },
  { id: 'C', name: 'Hero', alias: 'blocks/hero' },
  { id: 'D', name: 'Root', alias: 'root' },
  { id: 'E', name: 'Card', alias: 'shared/cards/card' },
]

describe('the tree', () => {
  test('is the folders under components/, nested, by name, with loose components at the root', () => {
    const tree = templateTree(TEMPLATES, [])
    expect(tree.folders.map((f) => f.name)).toEqual(['blocks', 'pages', 'shared'])
    expect(tree.items.map((t) => t.name)).toEqual(['Root'])
    const shared = tree.folders.find((f) => f.name === 'shared')
    expect(shared?.folders.map((f) => [f.name, f.path])).toEqual([['cards', 'shared/cards']])
    expect(shared?.folders[0]?.items.map((t) => t.name)).toEqual(['Card'])
  })

  test('says of each component whether the type allows it', () => {
    const pages = templateTree(TEMPLATES, ['a']).folders.find((f) => f.name === 'pages')
    expect(pages?.items.map((t) => [t.name, t.allowed])).toEqual([
      ['Blog post', false],
      ['Home page', true],
    ])
  })
})

describe('a search', () => {
  test('keeps the components whose name holds it, and the folders leading to them', () => {
    const found = filterTree(templateTree(TEMPLATES, []), 'CAR')
    expect(found.items).toEqual([])
    expect(found.folders.map((f) => f.name)).toEqual(['shared'])
    expect(found.folders[0]?.folders[0]?.items.map((t) => t.name)).toEqual(['Card'])
  })

  test('of nothing is the whole tree, and of no match is an empty one', () => {
    const tree = templateTree(TEMPLATES, [])
    expect(filterTree(tree, '  ')).toBe(tree)
    const none = filterTree(tree, 'lighthouse')
    expect([none.folders, none.items]).toEqual([[], []])
  })
})

describe('allowing one', () => {
  test('adds it to the type’s templates, once', () => {
    expect(withAllowed([{ id: 'A' }], 'B')).toEqual([{ id: 'A' }, { id: 'B' }])
    expect(withAllowed([{ id: 'A' }], 'a')).toEqual([{ id: 'A' }])
    expect(withAllowed(undefined, 'A')).toEqual([{ id: 'A' }])
  })
})

describe('components nothing names yet', () => {
  test('are in the tree, by the last part of their path, and never allowed', () => {
    const tree = templateTree(
      [{ id: null, name: componentName('shared/cards/card'), alias: 'shared/cards/card' }],
      ['A'],
    )
    expect(tree.folders[0]?.folders[0]?.items).toEqual([
      { id: null, name: 'card', alias: 'shared/cards/card', allowed: false },
    ])
  })

  test('are joined to the template rows by alias, every one on disk listed', () => {
    expect(
      componentTemplates(
        ['blocks/hero', 'pages/homePage'],
        [
          { key: 'K1', alias: 'pages/homePage' },
          { key: 'K2', alias: 'gone/old' },
        ],
      ),
    ).toEqual([
      { alias: 'blocks/hero', id: null },
      { alias: 'gone/old', id: 'K2' },
      { alias: 'pages/homePage', id: 'K1' },
    ])
  })
})
