/**
 * Story 380: the merge's plan, pure. Each language goes live or comes down as the
 * workspace left it; publishing what Shared took down since is a finding; and a
 * page whose parent Shared deleted, or that Shared moved, cannot go as it is.
 */
import { describe, expect, test } from 'bun:test'
import { fieldWords, mergeBlockers, planWorkspaceMerge } from '@crombolo/content'
import type { WorkspacePageMerge, WorkspacePending } from '@crombolo/data'

const page = (over: Partial<WorkspacePageMerge> = {}): WorkspacePageMerge => ({
  key: 'k1',
  nodeId: 10,
  made: false,
  level: 1,
  contentTypeKey: 't',
  parentKey: null,
  sharedHead: 2,
  baseEvent: 1,
  fields: [{ field: '@name', base: 'Home', mine: 'Home', theirs: 'Home' }],
  published: { base: true, mine: true, theirs: true, here: false, sharedEdited: false },
  cultures: [],
  ...over,
})

const pending = (over: Partial<WorkspacePending>): WorkspacePending => ({
  key: 'k2',
  nodeId: 20,
  name: 'About',
  kind: 'move',
  targetParentId: 30,
  sortOrder: null,
  baseParentId: -1,
  baseSortOrder: 0,
  baseEventId: 5,
  ...over,
})

describe('a merge plan', () => {
  test('publishes the languages the workspace published, and takes down the ones it unpublished', () => {
    const plan = planWorkspaceMerge(
      [
        page({
          published: { base: true, mine: true, theirs: true, here: true, sharedEdited: false },
          cultures: [
            { iso: 'en-US', base: true, mine: true, theirs: true },
            { iso: 'da-DK', base: true, mine: false, theirs: true },
            { iso: 'de-DE', base: false, mine: false, theirs: false },
          ],
        }),
      ],
      [],
      new Map(),
    )
    expect(plan.pages[0]).toMatchObject({
      publish: { cultures: ['en-US'] },
      unpublish: { cultures: ['da-DK'] },
    })
  })

  test('publishing a page Shared took down since is a finding to accept', () => {
    const plan = planWorkspaceMerge(
      [
        page({
          published: { base: true, mine: true, theirs: false, here: true, sharedEdited: false },
        }),
      ],
      [],
      new Map(),
    )
    expect(plan.findings.map((f) => f.id)).toEqual(['unpublished-since:k1'])
    expect(mergeBlockers(plan, [])).toHaveLength(1)
    expect(mergeBlockers(plan, ['unpublished-since:k1'])).toEqual([])
  })

  test('a move cannot go where Shared moved the page, or under a parent it deleted', () => {
    const moved = planWorkspaceMerge([], [pending({})], new Map([[20, { parentId: 40, head: 5 }]]))
    expect(mergeBlockers(moved, [])).toEqual(['"About" was moved in Shared since.'])
    const orphaned = planWorkspaceMerge([], [pending({ kind: 'orphaned' })], new Map())
    expect(orphaned.pending[0]?.conflict).toContain('Its parent was deleted in Shared')
    const fine = planWorkspaceMerge([], [pending({})], new Map([[20, { parentId: -1, head: 9 }]]))
    expect(mergeBlockers(fine, [])).toEqual([])
  })

  test('a delete cannot go once Shared changed the page since', () => {
    const plan = planWorkspaceMerge(
      [],
      [pending({ kind: 'delete' })],
      new Map([[20, { parentId: -1, head: 6 }]]),
    )
    expect(mergeBlockers(plan, [])).toEqual(['"About" was changed in Shared since.'])
  })

  test('names fields in words', () => {
    expect(fieldWords('title||')).toBe('title')
    expect(fieldWords('title|en-US|')).toBe('title (en-US)')
    expect(fieldWords('@name:da-DK')).toBe('its name in da-DK')
    expect(fieldWords('@template')).toBe('its template')
  })
})
