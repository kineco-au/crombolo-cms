/**
 * Story 392: the dictionary in a workspace. Read and changed there through the back
 * office's own calls, as a file of one item per line; Shared does not see it until the
 * merge, which goes three ways by line, an item changed on both sides a conflict. A
 * change in Shared is recorded as the person's; with content locked it is refused.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { ChangeRepository } from '@crombolo/data'
import { WORKSPACE_DICTIONARY } from '../packages/server/src/adapters/workspace-dictionary.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

async function site(extra: Record<string, unknown> = {}) {
  const h = await signedInServer({ config: { workspaces: true, ...extra } })
  open.push(h)
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const item = (name: string, text: string, id = crypto.randomUUID()) => ({
    id,
    name,
    parent: null,
    translations: [{ isoCode: 'en-US', translation: text }],
  })
  const read = async (id: string, workspace?: string) => {
    const response = await send('GET', `${V1}/dictionary/${id}`, undefined, workspace)
    if (response.status !== 200) return undefined
    const body = (await response.json()) as {
      name: string
      translations: Array<{ translation: string }>
    }
    return body.translations[0]?.translation
  }
  return { h, send, opened, item, read }
}

describe(`the dictionary in a workspace (${dialectUnderTest})`, () => {
  test('an item made there is the workspace’s until the merge brings it into Shared', async () => {
    const { send, opened, item, read } = await site()
    const sale = await opened('Spring sale')
    const greeting = item('Greeting', 'Hello')
    expect((await send('POST', `${V1}/dictionary`, greeting, sale.key)).status).toBe(201)
    expect(await read(greeting.id, sale.key)).toBe('Hello')
    expect(await read(greeting.id)).toBeUndefined()

    const roots = await send(
      'GET',
      `${V1}/tree/dictionary/root?skip=0&take=50`,
      undefined,
      sale.key,
    )
    const names = ((await roots.json()) as { items: Array<{ name: string }> }).items.map(
      (i) => i.name,
    )
    expect(names).toContain('Greeting')

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await read(greeting.id)).toBe('Hello')
  })

  test('items changed on each side merge; the same item changed on both is a conflict', async () => {
    const { send, opened, item, read } = await site()
    const a = item('Alpha', 'One')
    const b = item('Bravo', 'Two')
    for (const i of [a, b]) expect((await send('POST', `${V1}/dictionary`, i)).status).toBe(201)

    const sale = await opened('Spring sale')
    const put = (i: typeof a, text: string, workspace?: string) =>
      send(
        'PUT',
        `${V1}/dictionary/${i.id}`,
        { name: i.name, translations: [{ isoCode: 'en-US', translation: text }] },
        workspace,
      )
    expect((await put(a, 'Uno', sale.key)).status).toBe(200)
    expect((await put(b, 'Dos')).status).toBe(200)
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await read(a.id)).toBe('Uno')
    expect(await read(b.id)).toBe('Dos')

    const later = await opened('Autumn sale')
    expect((await put(a, 'Eins', later.key)).status).toBe(200)
    expect((await put(a, 'Un')).status).toBe(200)
    const refused = await send('POST', `${WORKSPACES}/${later.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(await read(a.id)).toBe('Un')
    expect(((await refused.json()) as { blockers: string[] }).blockers.join(' ')).toContain(
      WORKSPACE_DICTIONARY,
    )
    const answered = await send('POST', `${WORKSPACES}/${later.key}/files/resolve`, {
      path: WORKSPACE_DICTIONARY,
      side: 'mine',
    })
    expect(answered.status).toBe(200)
    expect((await send('POST', `${WORKSPACES}/${later.key}/merge`, {})).status).toBe(200)
    expect(await read(a.id)).toBe('Eins')
  })

  test('a deleted item, and its children, go from Shared with the merge', async () => {
    const { send, opened, item, read } = await site()
    const parent = item('Labels', 'Labels')
    const child = { ...item('Labels.Save', 'Save'), parent: { id: parent.id } }
    for (const i of [parent, child])
      expect((await send('POST', `${V1}/dictionary`, i)).status).toBe(201)
    const sale = await opened('Spring sale')
    expect(
      (await send('DELETE', `${V1}/dictionary/${parent.id}`, undefined, sale.key)).status,
    ).toBe(200)
    expect(await read(child.id, sale.key)).toBeUndefined()
    expect(await read(child.id)).toBe('Save')
    // Story 402: a delete is accepted by name or kind, as a page's is.
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(409)
    expect(
      (
        await send('POST', `${WORKSPACES}/${sale.key}/merge`, {
          accept: ['dictionary-item-removed'],
        })
      ).status,
    ).toBe(200)
    expect(await read(parent.id)).toBeUndefined()
    expect(await read(child.id)).toBeUndefined()
  })

  test('importing a dictionary file is done in Shared, saying so', async () => {
    const { send, opened } = await site()
    const sale = await opened('Spring sale')
    const refused = await send('POST', `${V1}/dictionary/import`, {}, sale.key)
    expect(refused.status).toBe(409)
  })

  test('a change in Shared is recorded as the person’s, the dictionary before and after', async () => {
    const { h, send, item } = await site()
    expect((await send('POST', `${V1}/dictionary`, item('Greeting', 'Hello'))).status).toBe(201)
    const changes = new ChangeRepository(h.server.db)
    const { items } = await changes.list()
    const found = []
    for (const change of items)
      for (const i of await changes.itemsOf(change.id))
        if (i.path === WORKSPACE_DICTIONARY) found.push(i)
    expect(found).toHaveLength(1)
    expect(found[0]?.after).toContain('"Greeting"')
  })

  test('with content locked, a dictionary change is refused', async () => {
    const { send, item } = await site({ contentEditing: 'locked' })
    expect((await send('POST', `${V1}/dictionary`, item('Greeting', 'Hello'))).status).toBe(409)
  })
})

describe(`languages in a workspace (${dialectUnderTest})`, () => {
  test('a language added there is the workspace’s until the merge brings it into Shared', async () => {
    const { send, opened } = await site()
    const sale = await opened('Spring sale')
    const danish = {
      isoCode: 'da-DK',
      name: 'Danish',
      isDefault: false,
      isMandatory: false,
      fallbackIsoCode: null,
    }
    expect((await send('POST', `${V1}/language`, danish, sale.key)).status).toBe(201)
    const isos = async (workspace?: string) =>
      (
        (await (
          await send('GET', `${V1}/language?skip=0&take=50`, undefined, workspace)
        ).json()) as {
          items: Array<{ isoCode: string }>
        }
      ).items.map((l) => l.isoCode)
    expect(await isos(sale.key)).toContain('da-DK')
    expect(await isos()).not.toContain('da-DK')

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await isos()).toContain('da-DK')
  })

  test('the default language is not removed there', async () => {
    const { send, opened } = await site()
    const sale = await opened('Spring sale')
    expect((await send('DELETE', `${V1}/language/en-US`, undefined, sale.key)).status).toBe(400)
  })
})
