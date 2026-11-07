/**
 * Story 234: the Settings landing page's cards, grouped, for whoever is looking,
 * and which tree an editor sits beside.
 */
import { describe, expect, test } from 'bun:test'
import {
  advancedToolTitle,
  CARDS,
  crumbsFor,
  settingsCards,
  treeFor,
} from '../packages/backoffice-host/plugin/settings-cards.js'

const dashboard = (alias: string, path: string) => ({
  alias,
  label: alias,
  path: `dashboard/${path}`,
})

const EVERYTHING = {
  structure: true,
  code: true,
  dashboards: [
    dashboard('Umb.Dashboard.HealthCheck', 'health-check'),
    dashboard('Umb.Dashboard.ExamineManagement', 'examine-management'),
    dashboard('Umb.Dashboard.PublishedStatus', 'published-status'),
    dashboard('Umb.Dashboard.ModelsBuilder', 'models-builder'),
    dashboard('Crombolo.Dashboard.Seo', 'search-and-sharing'),
    dashboard('Crombolo.Dashboard.Addresses', 'addresses'),
    dashboard('Umb.Dashboard.RedirectManagement', 'redirect-management'),
    dashboard('Crombolo.Dashboard.Changes', 'changes'),
    dashboard('Crombolo.Dashboard.AuditLog', 'audit-log'),
    dashboard('Crombolo.Dashboard.BackgroundJobs', 'background-jobs'),
    dashboard('Crombolo.Dashboard.Bundles', 'bundles'),
  ],
  advanced: [
    { alias: 'Umb.MenuItem.Relations', label: 'Relations', entityType: 'relations-root' },
    { alias: 'Umb.MenuItem.LogViewer', label: 'Log Viewer', entityType: 'logviewer' },
    { alias: 'Umb.MenuItem.Extensions', label: 'Extension Insights', entityType: 'extension-root' },
    { alias: 'Umb.MenuItem.Webhook', label: 'Webhooks', entityType: 'webhook-root' },
  ],
}

const titles = (groups: ReturnType<typeof settingsCards>) =>
  Object.fromEntries(groups.map((g) => [g.group, g.cards.map((c) => c.title)]))

describe('the Settings landing page', () => {
  test('an administrator sees every tool, grouped and in order', () => {
    expect(titles(settingsCards(EVERYTHING))).toEqual({
      Site: [
        'Search & sharing',
        'Page addresses',
        'Redirects',
        'Webhooks',
        'Logs',
        'Search indexes',
        'Background jobs',
      ],
      Health: ['Health check', 'Published status', 'Relations'],
      History: ['Changes', 'Audit log'],
      // Story 238: after History, a developer's tool, then installing bundles.
      Developers: ['Extension insights', 'Types for code'],
      Extensions: ['Bundles'],
    })
  })

  test('each card goes to the address the tool already has', () => {
    const cards = settingsCards(EVERYTHING).flatMap((g) => g.cards)
    const path = (title: string) => cards.find((c) => c.title === title)?.path
    expect(path('Health check')).toBe('dashboard/health-check')
    expect(path('Logs')).toBe('workspace/logviewer')
    for (const card of cards)
      expect([card.title, card.description?.length]).not.toEqual([card.title, undefined])
  })

  test('someone without a tool, or a tree, sees no card for it, and an empty group goes', () => {
    const groups = settingsCards({
      dashboards: [dashboard('Crombolo.Dashboard.Seo', 'search-and-sharing')],
      advanced: [],
    })
    expect(titles(groups)).toEqual({ Site: ['Search & sharing'] })
  })

  test('a dashboard we have no words for, from no bundle, is a card under Other, by its own label', () => {
    const groups = settingsCards({
      dashboards: [
        { alias: 'Acme.Dashboard.Stock', label: 'Stock levels', path: 'dashboard/stock' },
      ],
    })
    expect(groups).toEqual([
      {
        group: 'Other',
        cards: [
          {
            alias: 'Acme.Dashboard.Stock',
            path: 'dashboard/stock',
            group: 'Other',
            title: 'Stock levels',
          },
        ],
      },
    ])
  })

  test("a bundle's card carries the description its manifest gives", () => {
    const cards = settingsCards({
      dashboards: [
        {
          alias: 'Acme.Dashboard.Stock',
          label: 'Stock levels',
          description: 'What is on the shelves.',
          path: 'dashboard/stock',
        },
      ],
      advanced: [
        {
          alias: 'Crombolo.MenuItem.Redirects',
          label: 'Redirects',
          description: 'Rules you add by hand.',
          entityType: 'crombolo-redirects',
        },
      ],
    }).flatMap((g) => g.cards)
    expect(cards.map((c) => [c.title, c.description])).toEqual([
      ['Stock levels', 'What is on the shelves.'],
      ['Redirects', 'Rules you add by hand.'],
    ])
  })

  test('a bundle has a group of its own, after ours, by its name and linking to it', () => {
    const groups = settingsCards({
      dashboards: [
        {
          alias: 'Acme.Dashboard.Stock',
          label: 'Stock',
          path: 'dashboard/stock',
          bundle: { name: 'Acme', packageName: '@acme/stock' },
        },
        { alias: 'Loose.Dashboard', label: 'Loose', path: 'dashboard/loose' },
      ],
      advanced: [
        {
          alias: 'Crombolo.MenuItem.Redirects',
          label: 'Redirects',
          bundle: { name: 'Redirects', packageName: '@crombolo/simple-redirects' },
          entityType: 'crombolo-redirects',
        },
      ],
    })
    // A bundle's group links to the bundle in the Bundles section.
    expect(groups.map((g) => [g.group, g.bundle?.path, g.cards.map((c) => c.title)])).toEqual([
      ['Other', undefined, ['Loose']],
      ['Acme', 'section/settings/dashboard/bundles/installed?bundle=%40acme%2Fstock', ['Stock']],
      [
        'Redirects',
        'section/settings/dashboard/bundles/installed?bundle=%40crombolo%2Fsimple-redirects',
        ['Redirects'],
      ],
    ])
  })

  test('every card we have words for names a group that is shown', () => {
    for (const words of Object.values(CARDS))
      expect(['Site', 'Health', 'History', 'Developers', 'Extensions']).toContain(words.group)
  })
})

describe('which tree an editor sits beside', () => {
  test('types, data types and languages beside Structure; components, styles and scripts beside Code', () => {
    for (const type of [
      'document-type',
      'document-type-folder',
      'media-type',
      'member-type-root',
      'data-type',
      'language',
    ])
      expect([type, treeFor(type)]).toEqual([type, 'structure'])
    for (const type of ['partial-view', 'partial-view-folder', 'template', 'stylesheet', 'script'])
      expect([type, treeFor(type)]).toEqual([type, 'code'])
  })

  test('the tools that were in the Advanced tree sit beside none', () => {
    for (const type of ['logviewer', 'webhook-root', 'extension-root', 'relations-root', undefined])
      expect(treeFor(type)).toBeUndefined()
  })
})

describe('the trail above a Settings page', () => {
  test('every page but the landing page starts at Settings, then names where it is', () => {
    const home = { label: 'Home', home: true }
    expect(crumbsFor({})).toEqual([home, { label: 'Settings' }])
    expect(crumbsFor({ title: 'Health check' })).toEqual([
      home,
      { label: 'Settings', path: '' },
      { label: 'Health check' },
    ])
    // A tree is reached from the menu under Content, which says where it is.
    expect(crumbsFor({ tree: 'structure' })).toEqual([])
  })

  test("an Advanced tool's editor is named by its card, from the entity it opened", () => {
    const advanced = EVERYTHING.advanced
    expect(advancedToolTitle(advanced, 'logviewer')).toBe('Logs')
    expect(advancedToolTitle(advanced, 'webhook-root')).toBe('Webhooks')
    expect(advancedToolTitle(advanced, 'webhook')).toBe('Webhooks')
    expect(advancedToolTitle(advanced, 'document-type')).toBeUndefined()
    expect(advancedToolTitle(advanced, undefined)).toBeUndefined()
  })
})
