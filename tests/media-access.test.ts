/**
 * Story 196: media only the right people can read — rules on folders and
 * items, the defaults new files get, their creator, serving `/media/…`, the
 * Delivery API, the back office's endpoints, transfer and the migration.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMediaOperations, systemActor } from '@crombolo/content'
import {
  isProtectedMedia,
  type MediaItemAccess,
  type MediaRule,
  memberMay,
  nearestMediaRule,
  OPEN_MEDIA,
  SYSTEM_MEDIA_TYPE_KEYS,
  stampedPolicies,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  cromboloPlan,
  MediaAccessRepository,
  MIGRATION_STATE_KEY,
  migrate,
  NodeRepository,
  STATE_CONTENT_APPLIED,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import { type CromboloConfig, fileSystemMediaStore } from '@crombolo/server'
import { type BundleNode, exportBundle, importBundle, writeNode } from '@crombolo/transfer'
import {
  FILE_READ_CHOICES,
  groupRows,
  requestFor,
  summarise,
} from '../packages/backoffice-host/plugin/media-access.js'
import { dialectUnderTest, undoMediaAccess } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const FOLDER = SYSTEM_MEDIA_TYPE_KEYS.Folder
const IMAGE = SYSTEM_MEDIA_TYPE_KEYS.Image
const API = `${BACKOFFICE}/crombolo/api/media-access`

const rule = (over: Partial<MediaRule> = {}): MediaRule => ({
  nodeId: 10,
  publicRead: false,
  readGroups: [],
  writeGroups: [],
  newRead: null,
  newWrite: null,
  memberTypes: [],
  memberMaxBytes: null,
  ...over,
})
const item = (over: Partial<MediaItemAccess> = {}): MediaItemAccess => ({ ...OPEN_MEDIA, ...over })
const ada = { key: 'aaaaaaaa-0000-4000-8000-000000000001', groups: ['Observers'] }
const bob = { key: 'bbbbbbbb-0000-4000-8000-000000000002', groups: ['Staff'] }

describe('who may read and change a media item', () => {
  test('with no rule, anyone may read and no member may change', () => {
    expect(memberMay('read', item(), undefined, undefined)).toBe(true)
    expect(memberMay('write', item(), undefined, ada)).toBe(false)
    expect(isProtectedMedia(item(), undefined)).toBe(false)
  })

  test('a rule lets its read and write groups in, in any case, and nobody else', () => {
    const r = rule({ readGroups: ['observers', 'Staff'], writeGroups: ['Staff'] })
    expect(memberMay('read', item(), r, undefined)).toBe(false)
    expect(memberMay('read', item(), r, ada)).toBe(true)
    expect(memberMay('write', item(), r, ada)).toBe(false)
    expect(memberMay('write', item(), r, bob)).toBe(true)
    expect(memberMay('read', item(), r, { key: 'x', groups: [] })).toBe(false)
    expect(isProtectedMedia(item(), r)).toBe(true)
  })

  test('a rule open to anyone is public again; writing still needs a group', () => {
    const r = rule({ publicRead: true, writeGroups: ['Staff'] })
    expect(memberMay('read', item(), r, undefined)).toBe(true)
    expect(memberMay('write', item(), r, ada)).toBe(false)
    expect(isProtectedMedia(item(), r)).toBe(false)
  })

  test("an item's own policy wins over the rule", () => {
    const r = rule({ readGroups: ['Observers'], writeGroups: ['Observers'] })
    const own = item({ creatorMemberKey: ada.key.toUpperCase() })
    expect(memberMay('read', { ...own, readPolicy: 'public' }, r, undefined)).toBe(true)
    expect(memberMay('write', { ...own, writePolicy: 'public' }, r, ada)).toBe(false)
    expect(memberMay('read', { ...own, readPolicy: 'creator' }, r, ada)).toBe(true)
    expect(memberMay('read', { ...own, readPolicy: 'creator' }, r, bob)).toBe(false)
    expect(memberMay('read', { ...own, readPolicy: 'creator' }, r, undefined)).toBe(false)
    expect(memberMay('write', { ...own, writePolicy: 'creator' }, r, ada)).toBe(true)
    expect(memberMay('read', { ...own, readPolicy: 'none' }, r, ada)).toBe(false)
    expect(memberMay('read', { ...own, readPolicy: 'groups' }, r, ada)).toBe(true)
    expect(memberMay('read', { ...own, readPolicy: 'groups' }, undefined, ada)).toBe(false)
    expect(memberMay('read', item({ readPolicy: 'creator' }), r, ada)).toBe(false)
  })

  test('the nearest rule on the path replaces the ones above it', () => {
    const rules = new Map([
      [10, rule({ nodeId: 10, readGroups: ['Staff'] })],
      [20, rule({ nodeId: 20, publicRead: true })],
    ])
    expect(nearestMediaRule('-1,10,15', rules)?.nodeId).toBe(10)
    expect(nearestMediaRule('-1,10,20,25', rules)?.nodeId).toBe(20)
    expect(nearestMediaRule('-1,30', rules)).toBeUndefined()
  })

  test('a new file gets what the rule above it sets for new files', () => {
    expect(stampedPolicies(undefined)).toEqual({ readPolicy: 'inherit', writePolicy: 'inherit' })
    expect(stampedPolicies(rule({ newRead: 'creator', newWrite: 'none' }))).toEqual({
      readPolicy: 'creator',
      writePolicy: 'none',
    })
  })
})

describe('the Permissions dialog', () => {
  test('shows every member group, keeps one that has gone, and sends only those ticked', () => {
    const rows = groupRows(
      {
        groups: [
          { name: 'staff', read: true, write: false },
          { name: 'Old', read: true, write: true },
        ],
      },
      ['Observers', 'Staff'],
    )
    expect(rows).toEqual([
      { name: 'Observers', read: false, write: false },
      { name: 'Staff', read: true, write: false },
      { name: 'Old', read: true, write: true },
    ])
    expect(
      requestFor({
        hasFile: true,
        own: { publicRead: false, groups: rows, newRead: null, newWrite: 'creator' },
        item: { readPolicy: 'creator', writePolicy: 'inherit' },
      }),
    ).toEqual({
      rule: {
        publicRead: false,
        groups: [
          { name: 'Staff', read: true, write: false },
          { name: 'Old', read: true, write: true },
        ],
        newRead: null,
        newWrite: 'creator',
        memberTypes: [],
        memberMaxBytes: null,
      },
      item: { readPolicy: 'creator', writePolicy: 'inherit' },
    })
    expect(requestFor({ hasFile: false, own: undefined, item: {} })).toEqual({ rule: null })
  })

  test('says who can see it, in words an editor uses', () => {
    expect(summarise({ protected: false })).toBe('Anyone with the link can see this.')
    expect(summarise({ protected: true })).toContain('Only the members chosen here')
    for (const choice of FILE_READ_CHOICES) expect(choice.label).not.toMatch(/policy|inherit|rule/i)
  })
})

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "photo"
name = "Photo"
type = "imageMediaPicker"

[[property]]
alias = "attachment"
name = "Attachment"
type = "upload"
`

async function png(): Promise<Uint8Array<ArrayBuffer>> {
  const source = await Bun.file(join(import.meta.dir, 'fixtures', 'pixel.png')).bytes()
  return new Uint8Array(await new Bun.Image(source).resize(4, 3, { fit: 'fill' }).png().bytes())
}

async function site(config: Partial<CromboloConfig> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'media-access-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const mediaDir = join(root, 'media')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir,
      ...config,
    },
  })
  open.push(h)

  const create = async (type: string, name: string, parent: string | null, values: unknown[]) => {
    const response = await h.post(`${V1}/media`, {
      mediaType: { id: type },
      parent: parent ? { id: parent } : null,
      values,
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201)
      throw new Error(`create ${name}: ${response.status} ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const folder = (name: string, parent: string | null = null) => create(FOLDER, name, parent, [])
  const image = async (name: string, parent: string | null = null) => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set('File', new File([await png()], `${name}.png`))
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    const key = await create(IMAGE, name, parent, [
      {
        alias: 'umbracoFile',
        culture: null,
        segment: null,
        value: { src: '', temporaryFileId: id, crops: [], focalPoint: null },
      },
    ])
    const urls = await h.json<Array<{ urlInfos: Array<{ url: string }> }>>(
      `${V1}/media/urls?id=${key}`,
    )
    return { key, src: urls[0]?.urlInfos[0]?.url as string }
  }
  const group = async (name: string) =>
    (await h.post(`${V1}/member-group`, { name })).headers.get('umb-generated-resource') as string
  const member = async (username: string, groups: string[] = []) => {
    const response = await h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: `${username}@example.test`,
      username,
      password: 'correct-horse-battery',
      isApproved: true,
      groups,
      values: [],
      variants: [{ culture: null, segment: null, name: username }],
    })
    if (response.status !== 201) throw new Error(`member ${username}: ${response.status}`)
    return response.headers.get('umb-generated-resource') as string
  }
  /** A visitor, carrying only the cookie or token given. */
  const visit = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`http://localhost${path}`, { headers, redirect: 'manual' }))
  const signIn = async (username: string) => {
    const response = await h.server.fetch(
      new Request('http://localhost/umbraco/members/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'correct-horse-battery' }),
      }),
    )
    expect(response.status).toBe(200)
    return { cookie: (response.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '' }
  }
  const access = new MediaAccessRepository(h.server.db)
  const protect = async (key: string, groups: string[], extra: Record<string, unknown> = {}) => {
    const saved = await h.put(`${API}/${key}`, {
      rule: {
        publicRead: false,
        groups: groups.map((name) => ({ name, read: true, write: false })),
        newRead: null,
        newWrite: null,
        ...extra,
      },
    })
    expect(saved.status).toBe(200)
    return saved.json() as Promise<{ protected: boolean }>
  }
  /** A page whose upload field holds a file: no media item owns it. */
  const pageWithUpload = async (name: string) => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set('File', new File(['%PDF-1.7'], `${name}.pdf`))
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [
        { alias: 'attachment', culture: null, segment: null, value: { temporaryFileId: id } },
      ],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const read = await h.json<{ values: Array<{ alias: string; value: { src: string } }> }>(
      `${V1}/document/${key}`,
    )
    return { key, src: read.values.find((v) => v.alias === 'attachment')?.value.src as string }
  }
  return {
    h,
    mediaDir,
    folder,
    image,
    group,
    member,
    visit,
    signIn,
    access,
    protect,
    pageWithUpload,
  }
}

describe(`protected media (${dialectUnderTest})`, () => {
  test('a folder protects what is in it: members of its groups and editors may read, nobody else, and never from a cache', async () => {
    const s = await site()
    const observers = await s.group('Observers')
    await s.member('ada', [await s.group('Staff')])
    await s.member('cy', [])
    await s.member('obi', [observers])
    const photos = await s.folder('Photos')
    const photo = await s.image('Heron', photos)
    const open = await s.image('Open')

    // Before any rule, as today.
    const before = await s.visit(photo.src)
    expect(before.status).toBe(200)
    expect(before.headers.get('cache-control')).toContain('public')

    expect((await s.protect(photos, ['Observers'])).protected).toBe(true)
    const anonymous = await s.visit(photo.src)
    expect(anonymous.status).toBe(404)
    expect((await s.visit(`${photo.src}?width=2&height=2`)).status).toBe(404)
    const outsider = await s.signIn('cy')
    expect((await s.visit(photo.src, outsider)).status).toBe(404)
    const staff = await s.signIn('ada')
    expect((await s.visit(photo.src, staff)).status).toBe(404)

    const observer = await s.signIn('obi')
    const allowed = await s.visit(photo.src, observer)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('cache-control')).toBe('private, no-store')
    const crop = await s.visit(`${photo.src}?width=2&height=2`, observer)
    expect(crop.status).toBe(200)
    expect(crop.headers.get('cache-control')).toBe('private, no-store')

    // An editor with the Media section reads it too.
    const editor = await s.h.call(photo.src)
    expect(editor.status).toBe(200)
    expect(editor.headers.get('cache-control')).toBe('private, no-store')

    // Outside the folder nothing changed.
    expect((await s.visit(open.src)).headers.get('cache-control')).toContain('public')
  })

  test('a nearer rule replaces the folder’s: stricter, or public again; a file’s own setting wins', async () => {
    const s = await site()
    await s.group('Observers')
    const outer = await s.folder('Outer')
    const inner = await s.folder('Inner', outer)
    const deep = await s.image('Deep', inner)
    const shallow = await s.image('Shallow', outer)
    await s.protect(outer, ['Observers'])
    expect((await s.visit(deep.src)).status).toBe(404)

    // The inner folder is public again.
    await s.h.put(`${API}/${inner}`, {
      rule: { publicRead: true, groups: [], newRead: null, newWrite: null },
    })
    expect((await s.visit(deep.src)).status).toBe(200)
    expect((await s.visit(shallow.src)).status).toBe(404)

    // A file's own setting: public inside the protected folder.
    const own = await s.h.put(`${API}/${shallow.key}`, {
      item: { readPolicy: 'public', writePolicy: 'inherit' },
    })
    expect(own.status).toBe(200)
    expect((await s.visit(shallow.src)).status).toBe(200)

    // Taking the inner rule off: it follows the outer folder again.
    expect((await s.h.del(`${API}/${inner}`)).status).toBe(200)
    expect((await s.visit(deep.src)).status).toBe(404)
    const described = await s.h.json<{
      own: unknown
      inherited: { from: { name: string }; groups: Array<{ name: string }> }
    }>(`${API}/${deep.key}`)
    expect(described.own).toBeNull()
    expect(described.inherited.from.name).toBe('Outer')
    expect(described.inherited.groups.map((g) => g.name)).toEqual(['Observers'])
  })

  test('a folder sets who may see and change files added later, stamped on each, and the creator is recorded', async () => {
    const s = await site()
    await s.group('Observers')
    const uploads = await s.folder('Uploads')
    const earlier = await s.image('Earlier', uploads)
    await s.protect(uploads, ['Observers'], { newRead: 'creator', newWrite: 'none' })
    const later = await s.image('Later', uploads)
    expect(await s.access.itemAccess(earlier.key)).toEqual(OPEN_MEDIA)
    expect(await s.access.itemAccess(later.key)).toEqual({
      readPolicy: 'creator',
      writePolicy: 'none',
      creatorMemberKey: null,
    })

    // A member's file: only they may read it.
    const ada = await s.member('ada', [])
    const operations = createMediaOperations({
      db: s.h.server.db,
      repository: { nodeState: { version: '1.0.0', revision: '0' } },
      events: { record: async () => {} },
    })
    const placed = await s.image('Placed')
    const values = (await operations.repository.byKey(placed.key))?.values ?? []
    const created = await operations.create(systemActor('member upload'), {
      key: crypto.randomUUID(),
      contentTypeKey: IMAGE,
      parentKey: uploads,
      values,
      variants: [{ culture: null, segment: null, name: 'Theirs' }],
      creatorMemberKey: ada,
    })
    expect(created).toMatchObject({ ok: true })
    const theirs = created.ok ? created.key : ''
    expect(await s.access.itemAccess(theirs)).toEqual({
      readPolicy: 'creator',
      writePolicy: 'none',
      creatorMemberKey: ada,
    })
    // Saving keeps both.
    const saved = await operations.save(systemActor('edit'), theirs, {
      contentTypeKey: IMAGE,
      parentKey: uploads,
      values,
      variants: [{ culture: null, segment: null, name: 'Theirs, renamed' }],
    })
    expect(saved.ok).toBe(true)
    expect((await s.access.itemAccess(theirs))?.creatorMemberKey).toBe(ada)

    const described = await s.h.json<{ item: { creator: { name: string } } }>(`${API}/${theirs}`)
    expect(described.item.creator.name).toBe('ada')
  })

  test('the creator alone reads a file only they may see', async () => {
    const s = await site()
    const ada = await s.member('ada', [])
    await s.member('bea', [])
    const mine = await s.image('Mine')
    await s.access.setItemAccess(mine.key, { readPolicy: 'creator', writePolicy: 'creator' })
    await s.access.setCreator(mine.key, ada)
    expect((await s.visit(mine.src)).status).toBe(404)
    expect((await s.visit(mine.src, await s.signIn('bea'))).status).toBe(404)
    const read = await s.visit(mine.src, await s.signIn('ada'))
    expect(read.status).toBe(200)
    expect(read.headers.get('cache-control')).toBe('private, no-store')
  })

  test('a back-office user reads within their media start nodes, and needs the Media section', async () => {
    const s = await site()
    await s.group('Observers')
    const theirs = await s.folder('Theirs')
    const others = await s.folder('Others')
    const inside = await s.image('Inside', theirs)
    const outside = await s.image('Outside', others)
    await s.protect(theirs, ['Observers'])
    await s.protect(others, ['Observers'])
    const created = await s.h.post(`${V1}/user-group`, {
      name: 'librarians',
      alias: 'librarians',
      sections: ['Umb.Section.Media'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: false,
      documentStartNode: null,
      mediaRootAccess: false,
      mediaStartNode: { id: theirs },
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: ['Crombolo.Media.Read', 'Crombolo.Media.Update'],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const librarian = await signInAsGroup(s.h, 'librarians')
    open.push(librarian)
    expect((await librarian.call(inside.src)).status).toBe(200)
    expect((await librarian.call(outside.src)).status).toBe(404)
    expect((await librarian.call(`${API}/${others}`)).status).toBe(403)
    expect((await librarian.call(`${API}/${theirs}`)).status).toBe(200)

    const writer = await signInAsGroup(s.h, 'writer')
    open.push(writer)
    expect((await writer.call(inside.src)).status).toBe(404)
    expect((await writer.call(`${API}/${theirs}`)).status).toBe(403)
  })

  test('a file in the recycle bin is read only by an editor', async () => {
    const s = await site()
    const binned = await s.image('Binned')
    expect((await s.h.put(`${V1}/media/${binned.key}/move-to-recycle-bin`, {})).status).toBe(200)
    expect((await s.visit(binned.src)).status).toBe(404)
    expect((await s.h.call(binned.src)).status).toBe(200)
  })

  test('a key no media item owns is not served, but a page’s own upload still is', async () => {
    const s = await site()
    mkdirSync(join(s.mediaDir, 'abcd1234'), { recursive: true })
    writeFileSync(join(s.mediaDir, 'abcd1234', 'stray.txt'), 'nobody owns me')
    expect((await s.visit('/media/abcd1234/stray.txt')).status).toBe(404)
    expect((await s.h.call('/media/abcd1234/stray.txt')).status).toBe(404)
    expect((await s.visit('/media/nothing/at-all.png')).status).toBe(404)

    const brochure = await s.pageWithUpload('Brochure')
    expect(brochure.src).toMatch(/^\/media\/[0-9a-f]{8}\/brochure\.pdf$/)
    const served = await s.visit(brochure.src)
    expect(served.status).toBe(200)
    expect(served.headers.get('cache-control')).toContain('public')
    // Deleted for good, its file is no longer anyone's.
    expect((await s.h.del(`${V1}/document/${brochure.key}`)).status).toBe(200)
    expect(
      await s.h.server.db.query('SELECT url FROM node_file WHERE url = ?', [brochure.src]),
    ).toEqual([])
  })

  test('the API: audited writes, the groups to choose from, and refusals', async () => {
    const s = await site()
    await s.group('Observers')
    const folder = await s.folder('Folder')
    const empty = await s.h.json<{
      own: unknown
      inherited: unknown
      hasFile: boolean
      protected: boolean
      memberGroups: string[]
    }>(`${API}/${folder}`)
    expect(empty).toMatchObject({ own: null, inherited: null, hasFile: false, protected: false })
    expect(empty.memberGroups).toContain('Observers')

    const refused = await s.h.put(`${API}/${folder}`, {
      rule: { publicRead: false, groups: [], newRead: 'everyone', newWrite: null },
    })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { reason: string }).reason).toContain('new files')
    expect((await s.h.put(`${API}/${folder}`, { item: { readPolicy: 'anyone' } })).status).toBe(400)
    expect((await s.h.call(`${API}/${crypto.randomUUID()}`)).status).toBe(404)
    expect((await s.visit(`${API}/${folder}`)).status).toBe(401)

    await s.protect(folder, ['Observers'], { newRead: 'groups', newWrite: 'creator' })
    const rows = await s.h.server.db.query<{ action: string; entity_key: string }>(
      "SELECT action, entity_key FROM audit_entry WHERE entity_type = 'MediaAccess'",
    )
    expect(rows.map((row) => row.action)).toEqual(['Save'])
    expect(rows[0]?.entity_key).toBe(folder)
  })

  test('a store with a public address: open files go there, protected ones never do', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'media-access-store-'))
    dirs.push(root)
    const s = await site({
      mediaStore: fileSystemMediaStore(root, { publicUrlPrefix: 'https://cdn.example.test' }),
    })
    await s.group('Observers')
    const open = await s.image('Open')
    const folder = await s.folder('Private')
    const closed = await s.image('Closed', folder)
    await s.protect(folder, ['Observers'])

    const sent = await s.visit(open.src)
    expect(sent.status).toBe(302)
    expect(sent.headers.get('location')).toStartWith('https://cdn.example.test/')
    expect((await s.visit(closed.src)).status).toBe(404)
    const streamed = await s.h.call(closed.src)
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('location')).toBeNull()
    expect(streamed.headers.get('cache-control')).toBe('private, no-store')
    const crop = await s.h.call(`${closed.src}?width=2&height=2`)
    expect(crop.status).toBe(200)
    expect(crop.headers.get('content-type')).toBe('image/png')
    expect(crop.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe(`protected media in the Delivery API (${dialectUnderTest})`, () => {
  const deliveryApi = {
    enabled: true,
    media: { enabled: true },
    memberAuthorization: {
      clientCredentialsFlow: {
        enabled: true,
        associatedMembers: [
          { userName: 'obi', clientId: 'obi', clientSecret: 'obi-secret' },
          { userName: 'cy', clientId: 'cy', clientSecret: 'cy-secret' },
        ],
      },
    },
  }

  test('lists leave a protected item out, its item answers 401 or 403, and a reference keeps only its name', async () => {
    const s = await site({ deliveryApi })
    const observers = await s.group('Observers')
    await s.member('obi', [observers])
    await s.member('cy', [])
    const photos = await s.folder('Photos')
    const photo = await s.image('Heron', photos)
    const open = await s.image('Open', photos)
    await s.protect(photos, ['Observers'])
    await s.h.put(`${API}/${open.key}`, { item: { readPolicy: 'public', writePolicy: 'inherit' } })
    s.h.server.cache.invalidate()

    const token = async (id: string) => {
      const response = await s.h.server.fetch(
        new Request('http://localhost/umbraco/delivery/api/v1/security/member/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: `umbraco-member-${id}`,
            client_secret: `${id}-secret`,
          }).toString(),
        }),
      )
      expect(response.status).toBe(200)
      return {
        authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}`,
      }
    }
    const api = (path: string, headers: Record<string, string> = {}) =>
      s.visit(`/umbraco/delivery/api/v2/media${path}`, headers)
    const names = async (response: Response) =>
      ((await response.json()) as { items: Array<{ name: string }> }).items.map((m) => m.name)

    // The folder itself and the item in it are closed; the item set public is not.
    expect(await names(await api('?fetch=children:/'))).toEqual([])
    expect(await names(await api('?fetch=children:/photos'))).toEqual(['Open'])
    expect((await api(`/item/${photo.key}`)).status).toBe(401)
    const outsider = await token('cy')
    expect((await api(`/item/${photo.key}`, outsider)).status).toBe(403)
    const observer = await token('obi')
    expect((await api(`/item/${photo.key}`, observer)).status).toBe(200)
    expect(await names(await api('?fetch=children:/photos', observer))).toEqual(['Heron', 'Open'])
    const items = (await (await api(`/items?id=${photo.key}&id=${open.key}`)).json()) as Array<{
      name: string
    }>
    expect(items.map((m) => m.name)).toEqual(['Open'])

    // The same member's token opens the file at its address.
    expect((await s.visit(photo.src, observer)).status).toBe(200)
    expect((await s.visit(photo.src, outsider)).status).toBe(404)

    // A page picking it: only its key and name for someone who cannot read it.
    const typeKey = (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key as string
    const page = await s.h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [
        {
          alias: 'photo',
          culture: null,
          segment: null,
          value: [
            {
              key: crypto.randomUUID(),
              mediaKey: photo.key,
              mediaTypeAlias: 'Image',
              crops: [],
              focalPoint: null,
            },
          ],
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    const pageKey = page.headers.get('umb-generated-resource') as string
    await s.h.put(`${V1}/document/${pageKey}/publish`, { publishSchedules: [] })
    const read = async (headers: Record<string, string> = {}) =>
      (
        (await (
          await s.visit(`/umbraco/delivery/api/v2/content/item/${pageKey}`, headers)
        ).json()) as { properties: { photo: Array<Record<string, unknown>> } }
      ).properties.photo
    expect(await read()).toEqual([{ id: photo.key, name: 'Heron' }])
    expect((await read(observer))[0]).toMatchObject({ id: photo.key, url: photo.src })
  })
})

describe(`media permissions travel (${dialectUnderTest})`, () => {
  test('a rule, the defaults, a file’s own setting and its creator round-trip through a bundle', async () => {
    const source = await site()
    await source.group('Observers')
    const ada = await source.member('ada', [])
    const folder = await source.folder('Uploads')
    const photo = await source.image('Photo', folder)
    await source.protect(folder, ['Observers'], { newRead: 'creator', newWrite: 'none' })
    await source.access.setItemAccess(photo.key, { readPolicy: 'creator', writePolicy: 'none' })
    await source.access.setCreator(photo.key, ada)
    const root = await new NodeRepository(source.h.server.db).byKey(folder)
    if (!root) throw new Error('no folder')
    const { set } = await exportBundle(source.h.server.db, {
      roots: [root],
      asGiven: [folder],
      descendants: true,
      snapshot: 'drafts',
      blueprints: false,
      withBlobs: false,
      siteName: 'Source',
      nodeId: 'source',
    })
    const byKey = new Map(set.nodes.map((n: BundleNode) => [n.key, n]))
    expect(byKey.get(folder)?.mediaAccess).toEqual({
      rule: {
        publicRead: false,
        groups: [{ name: 'Observers', read: true, write: false }],
        newRead: 'creator',
        newWrite: 'none',
      },
    })
    expect(byKey.get(photo.key)?.mediaAccess).toEqual({
      readPolicy: 'creator',
      writePolicy: 'none',
      creator: ada,
    })
    // Written and read back as a file says it.
    const written = JSON.parse(writeNode(byKey.get(folder) as BundleNode))
    expect(written.mediaAccess.rule.groups).toEqual([
      { name: 'Observers', read: true, write: false },
    ])

    const target = await site()
    await target.group('Observers')
    await importBundle(target.h.server.db, set, { nodeId: 'target' })
    expect(await target.access.byNodeKey(folder)).toMatchObject({
      publicRead: false,
      groups: [{ name: 'Observers', read: true, write: false }],
      newRead: 'creator',
      newWrite: 'none',
    })
    expect(await target.access.itemAccess(photo.key)).toEqual({
      readPolicy: 'creator',
      writePolicy: 'none',
      creatorMemberKey: ada,
    })
  })
})

describe(`the migration (${dialectUnderTest})`, () => {
  test('rewinds, and applied again finds every media item’s file and every page’s upload', async () => {
    const s = await site()
    await s.group('Observers')
    const folder = await s.folder('Kept')
    const photo = await s.image('Photo', folder)
    const brochure = await s.pageWithUpload('Brochure')
    await s.protect(folder, ['Observers'])
    const db = s.h.server.db

    await undoMediaAccess(db)
    await db.exec("DELETE FROM migration_history WHERE name = 'AddMediaAccess'")
    await db.exec('UPDATE key_value SET value = ? WHERE key = ?', [
      STATE_CONTENT_APPLIED,
      MIGRATION_STATE_KEY,
    ])
    expect((await migrate(db, cromboloPlan)).applied).toEqual([
      'AddMediaAccess',
      'AddMediaPagingIndexes',
      'AddMediaMemberUploads',
    ])
    const found = await new MediaAccessRepository(db).byUrl(photo.src)
    expect(found?.key).toBe(photo.key)
    expect(found?.access).toEqual(OPEN_MEDIA)
    expect(await new MediaAccessRepository(db).ownedElsewhere([brochure.src])).toBe(true)
    expect((await s.visit(brochure.src)).status).toBe(200)
    // The rules themselves were the migration's to make, and are gone with it.
    expect(await new MediaAccessRepository(db).allRules()).toEqual([])
  })
})
