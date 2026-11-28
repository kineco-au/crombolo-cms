/**
 * A workspace's colour, chosen by its owner from the palette (migration 109): stored,
 * answered in its view, cleared back to the one it is given, and refused when not one.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  colourOf,
  givenColour,
  groupedByColour,
  PALETTE,
  rememberColours,
} from '../packages/backoffice-host/plugin/workspace-client.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const send = (who: Harness, method: string, path: string, body?: unknown) =>
  who.call(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe(`a workspace's colour (${dialectUnderTest})`, () => {
  test('is chosen by its owner, answered in its view, cleared with null, and refused when not a colour', async () => {
    const h = await signedInServer({ config: { workspaces: true } })
    open.push(h)
    const opened = await send(h, 'POST', WORKSPACES, { name: 'Spring sale' })
    const sale = (await opened.json()) as { key: string; colour: string | null }
    expect(sale.colour).toBeNull()

    const chosen = await send(h, 'PATCH', `${WORKSPACES}/${sale.key}`, { colour: '#B45309' })
    expect(chosen.status).toBe(200)
    expect(((await chosen.json()) as { colour: string }).colour).toBe('#b45309')
    const listed = await h.json<{ items: Array<{ key: string; colour: string | null }> }>(
      WORKSPACES,
    )
    expect(listed.items.find((w) => w.key === sale.key)?.colour).toBe('#b45309')

    expect((await send(h, 'PATCH', `${WORKSPACES}/${sale.key}`, { colour: 'red' })).status).toBe(
      400,
    )

    const cleared = await send(h, 'PATCH', `${WORKSPACES}/${sale.key}`, { colour: null })
    expect(((await cleared.json()) as { colour: string | null }).colour).toBeNull()

    // Only its owner chooses it.
    const editor = await signInAsGroup(h, 'editor', 'ed@example.com')
    const refused = await send(editor, 'PATCH', `${WORKSPACES}/${sale.key}`, { colour: '#2e7d32' })
    expect(refused.status).not.toBe(200)
    expect(
      ((await h.json(`${WORKSPACES}/${sale.key}`)) as { colour: string | null }).colour,
    ).toBeNull()
  }, 30_000)
})

describe('colours in the back office', () => {
  test('a workspace shows the colour its owner chose, else the one its key gives it', () => {
    const key = 'aa000000-0000-4000-8000-000000000001'
    rememberColours([{ key, colour: null }])
    expect(colourOf(key)).toBe(givenColour(key))
    rememberColours([{ key, colour: '#6d28d9' }])
    expect(colourOf(key.toUpperCase())).toBe('#6d28d9')
    rememberColours([{ key, colour: null }])
    expect(colourOf(key)).toBe(givenColour(key))
  })

  test('the list is grouped by colour, in the palette order, each colour marked where it starts', () => {
    const rows = ['a', 'b', 'c', 'd'].map((k) => ({
      key: `bb00000${k}-0000-4000-8000-000000000000`,
    }))
    rememberColours([
      { key: rows[0]?.key, colour: PALETTE[2] },
      { key: rows[1]?.key, colour: PALETTE[0] },
      { key: rows[2]?.key, colour: PALETTE[2] },
      { key: rows[3]?.key, colour: PALETTE[0] },
    ])
    const grouped = groupedByColour(rows)
    expect(grouped.map((r: { key: string }) => r.key)).toEqual([
      rows[1]?.key,
      rows[3]?.key,
      rows[0]?.key,
      rows[2]?.key,
    ])
    expect(grouped.map((r: { startsColour: boolean }) => r.startsColour)).toEqual([
      false,
      false,
      true,
      false,
    ])
  })
})
