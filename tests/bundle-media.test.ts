/**
 * Story 198: a server bundle creating and changing media as the member — the
 * `media` capability, recognising a file by its first bytes, an image stored
 * upright and without its metadata, the folder's allow-list and size limit,
 * the boot refusing a missing folder, and the back office's warning.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { route } from '@crombolo/common'
import { mediaAuditEntryFor, memberActor } from '@crombolo/content'
import {
  checkMemberUpload,
  DEFAULT_UPLOAD_SETTINGS,
  detectFileType,
  SYSTEM_MEDIA_TYPE_KEYS,
} from '@crombolo/core'
import { MediaAccessRepository, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import {
  type BundleRouteContext,
  createServer,
  decodePng,
  encodePng,
  loadConfig,
  outboxActor,
  prepareMemberImage,
  readExifTiff,
  readWithin,
  type ServerBundle,
  type ServerHandle,
  stripWebp,
  VERSION,
  validateServerBundles,
} from '@crombolo/server'
import {
  bundleWarningFor,
  bytesOf,
  megabytesOf,
  requestFor,
  usedByText,
} from '../packages/backoffice-host/plugin/media-access.js'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest } from './support/db.ts'
import { concat, contains, exifTiff, jpegWithExif, pngWithExif } from './support/exif.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

/**
 * A picture red only in its top-left corner, `block` pixels square, so which
 * way up it is can be read back; a block survives a JPEG's compression.
 */
const marked = (width: number, height: number, block = 1) => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const red = i % width < block && Math.floor(i / width) < block
    data.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  }
  return encodePng({ width, height, data })
}
const redAt = (png: Uint8Array) => {
  const pixels = decodePng(png)
  for (let i = 0; i < pixels.width * pixels.height; i++)
    if ((pixels.data[i * 4] as number) > 128)
      return [i % pixels.width, Math.floor(i / pixels.width)]
  return undefined
}
const PHOTO_FACTS = {
  orientation: 6,
  takenAt: '2026:10:28 09:15:00',
  offset: '+10:00',
  latitude: -27.4705,
  longitude: 153.026,
  altitude: 27,
  make: 'SecretCam',
}
const phonePhoto = async () =>
  jpegWithExif(await new Bun.Image(marked(30, 20, 6)).jpeg({ quality: 95 }).bytes(), PHOTO_FACTS)

describe('recognising a file', () => {
  test('by its first bytes', async () => {
    const png = marked(2, 2)
    const jpeg = await new Bun.Image(png).jpeg().bytes()
    const webp = await new Bun.Image(png).webp().bytes()
    const text = (value: string) => new TextEncoder().encode(value)
    const ftyp = (major: string, ...compatible: string[]) => {
      const brands = [major, '\0\0\0\0', ...compatible].join('')
      const box = concat(new Uint8Array(4), text(`ftyp${brands}`))
      new DataView(box.buffer).setUint32(0, box.length)
      return box
    }
    expect(detectFileType(jpeg)).toBe('jpeg')
    expect(detectFileType(png)).toBe('png')
    expect(detectFileType(webp)).toBe('webp')
    expect(detectFileType(text('GIF89a……'))).toBe('gif')
    expect(detectFileType(text('%PDF-1.7'))).toBe('pdf')
    expect(detectFileType(text('ID3\x04'))).toBe('mp3')
    expect(detectFileType(text('RIFF\0\0\0\0WAVEfmt '))).toBe('wav')
    expect(detectFileType(ftyp('avif', 'mif1', 'miaf'))).toBe('avif')
    expect(detectFileType(ftyp('heic', 'mif1'))).toBe('heic')
    expect(detectFileType(ftyp('isom', 'iso2', 'mp41'))).toBe('mp4')
    expect(detectFileType(ftyp('qt  '))).toBe('mov')
    expect(detectFileType(text('<!doctype html><script>'))).toBeUndefined()
    expect(detectFileType(new Uint8Array())).toBeUndefined()
  })

  test('its content, its extension and the list must agree, and the site must allow it', async () => {
    const jpeg = await new Bun.Image(marked(2, 2)).jpeg().bytes()
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    const allowed = ['jpeg', 'png']
    expect(checkMemberUpload('photo.JPG', jpeg, allowed)).toMatchObject({
      ok: true,
      type: { id: 'jpeg' },
    })
    // A page renamed to look like a photo.
    expect(checkMemberUpload('photo.jpg', html, allowed)).toMatchObject({ ok: false, status: 415 })
    // A photo named as something else.
    expect(checkMemberUpload('photo.png', jpeg, allowed)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('named .png'),
    })
    expect(checkMemberUpload('photo.jpg', jpeg, ['png'])).toMatchObject({
      ok: false,
      reason: 'A JPEG image cannot be uploaded here.',
    })
    // An empty list refuses everything.
    expect(checkMemberUpload('photo.jpg', jpeg, [])).toMatchObject({ ok: false })
    expect(checkMemberUpload('photo', jpeg, allowed)).toMatchObject({ ok: false, status: 400 })
    const strict = { ...DEFAULT_UPLOAD_SETTINGS, disallowedExtensions: ['jpg'] }
    expect(checkMemberUpload('photo.jpg', jpeg, allowed, strict)).toMatchObject({
      ok: false,
      reason: 'This site does not accept .jpg files.',
    })
  })
})

describe("a photo's metadata", () => {
  test('EXIF is read for which way up, when and where', () => {
    expect(readExifTiff(exifTiff(PHOTO_FACTS))).toEqual({
      orientation: 6,
      takenAt: '2026-10-28T09:15:00+10:00',
      location: { latitude: -27.4705, longitude: 153.026, altitude: 27 },
    })
    expect(
      readExifTiff(exifTiff({ latitude: 51.5, longitude: -0.1278, altitude: -3 })).location,
    ).toEqual({ latitude: 51.5, longitude: -0.1278, altitude: -3 })
    expect(readExifTiff(new Uint8Array([1, 2, 3]))).toEqual({})
  })

  test('a JPEG is stored upright with every metadata block gone, and what it said is returned', async () => {
    const photo = await phonePhoto()
    expect(contains(photo, 'SecretCam')).toBe(true)
    const prepared = await prepareMemberImage(photo, 'jpeg')
    for (const secret of [
      'Exif',
      'SecretCam',
      'secret-xmp',
      'secret-comment',
      'http://ns.adobe.com',
    ])
      expect(contains(prepared.bytes, secret)).toBe(false)
    expect(prepared.facts).toEqual({
      width: 20,
      height: 30,
      takenAt: '2026-10-28T09:15:00+10:00',
      location: { latitude: -27.4705, longitude: 153.026, altitude: 27 },
    })
    // Turned a quarter clockwise: the top-left corner is now top-right.
    const [x, y] = redAt(await new Bun.Image(prepared.bytes).png().bytes()) as number[]
    expect(x).toBeGreaterThanOrEqual(12)
    expect(y).toBeLessThan(3)
  })

  test('every EXIF orientation is applied to a PNG, and its text and EXIF chunks go', async () => {
    const expected: Record<number, [number, number, number, number]> = {
      1: [3, 2, 0, 0],
      2: [3, 2, 2, 0],
      3: [3, 2, 2, 1],
      4: [3, 2, 0, 1],
      5: [2, 3, 0, 0],
      6: [2, 3, 1, 0],
      7: [2, 3, 1, 2],
      8: [2, 3, 0, 2],
    }
    for (const [orientation, [width, height, x, y]] of Object.entries(expected)) {
      const source = pngWithExif(marked(3, 2), {
        orientation: Number(orientation),
        make: 'SecretCam',
      })
      const prepared = await prepareMemberImage(source, 'png')
      expect(prepared.facts).toMatchObject({ width, height })
      expect(redAt(prepared.bytes)).toEqual([x, y])
      expect(contains(prepared.bytes, 'eXIf')).toBe(false)
      expect(contains(prepared.bytes, 'secret-text')).toBe(false)
    }
  })

  test('a WebP loses its EXIF and XMP chunks; a GIF its comments, keeping its frames', async () => {
    const webp = await new Bun.Image(marked(4, 4)).webp().bytes()
    const chunk = (type: string, body: string) => {
      const data = new TextEncoder().encode(body)
      const head = concat(new TextEncoder().encode(type), new Uint8Array(4))
      new DataView(head.buffer).setUint32(4, data.length, true)
      return concat(head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array())
    }
    const tagged = concat(webp, chunk('EXIF', 'SecretCam'), chunk('XMP ', 'secret-xmp'))
    new DataView(tagged.buffer).setUint32(4, tagged.length - 8, true)
    const stripped = stripWebp(tagged)
    expect(contains(stripped, 'SecretCam')).toBe(false)
    expect(contains(stripped, 'secret-xmp')).toBe(false)
    expect(new DataView(stripped.buffer).getUint32(4, true)).toBe(stripped.length - 8)
    expect(await new Bun.Image(stripped).metadata()).toMatchObject({ width: 4, height: 4 })
    expect((await prepareMemberImage(tagged, 'webp')).facts).toMatchObject({ width: 4 })

    // A 1×1 GIF with a comment and an XMP application block.
    const gif = Uint8Array.from([
      ...new TextEncoder().encode('GIF89a'),
      1,
      0,
      1,
      0,
      0x80,
      0,
      0,
      0,
      0,
      0,
      255,
      255,
      255,
      0x21,
      0xfe,
      14,
      ...new TextEncoder().encode('secret-comment'),
      0,
      0x21,
      0xff,
      11,
      ...new TextEncoder().encode('XMP DataXMP'),
      10,
      ...new TextEncoder().encode('secret-xmp'),
      0,
      0x21,
      0xf9,
      4,
      0,
      10,
      0,
      0,
      0,
      0x2c,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      2,
      2,
      0x4c,
      0x01,
      0,
      0x3b,
    ])
    const prepared = await prepareMemberImage(gif, 'gif')
    expect(contains(prepared.bytes, 'secret-comment')).toBe(false)
    expect(contains(prepared.bytes, 'secret-xmp')).toBe(false)
    expect(contains(prepared.bytes, Uint8Array.from([0x21, 0xf9]))).toBe(true)
    expect(prepared.facts).toMatchObject({ width: 1, height: 1 })
  })

  test('an image that cannot be re-encoded is refused rather than stored with its metadata', async () => {
    const fake = new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0mif1heicExif-and-nothing-else')
    await expect(prepareMemberImage(fake, 'heic')).rejects.toThrow(/not uploaded/)
    await expect(prepareMemberImage(marked(2, 2), 'tiff')).rejects.toThrow(/not uploaded/)
  })
})

describe('an upload is read only while it fits', () => {
  test('reading stops as soon as the limit is passed', async () => {
    let pulled = 0
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1
          if (pulled > 10) controller.close()
          else controller.enqueue(new Uint8Array(1000))
        },
      })
    expect(await readWithin(stream(), 2500)).toBeUndefined()
    expect(pulled).toBeLessThan(5)
    pulled = 0
    expect((await readWithin(stream(), 20_000))?.byteLength).toBe(10_000)
  })
})

describe('declaring media', () => {
  const bundle = (over: Partial<ServerBundle> = {}): ServerBundle =>
    ({
      id: 'observations',
      section: 'content',
      capabilities: ['media'],
      routes: [],
      ...over,
    }) as ServerBundle
  const problems = (b: ServerBundle) =>
    validateServerBundles(
      [b],
      [
        stubBundlePackage('observations', {
          field: {
            id: 'observations',
            server: 'observations',
            schemaVersion: 3,
            permissions: ['media.read', 'media.write', 'member.delegate'],
          },
        }),
      ],
      VERSION,
    )

  test('the capability needs folders by path and a size limit, and names known types', () => {
    expect(
      problems(bundle({ media: { folders: ['/Observations/Photos'], maxBytes: 1000 } })),
    ).toEqual([])
    expect(problems(bundle()).join()).toContain('needs { folders')
    expect(problems(bundle({ media: { folders: [], maxBytes: 1000 } })).join()).toContain(
      'names no folders',
    )
    expect(
      problems(bundle({ media: { folders: ['Observations', '/a//b'], maxBytes: 1000 } })),
    ).toHaveLength(2)
    expect(problems(bundle({ media: { folders: ['/A'], maxBytes: 0 } })).join()).toContain(
      'maxBytes',
    )
    expect(
      problems(bundle({ media: { folders: ['/A'], maxBytes: 10, types: ['jpeg', 'exe'] } })).join(),
    ).toContain('"exe"')
    expect(
      problems(bundle({ capabilities: [], media: { folders: ['/A'], maxBytes: 10 } })).join(),
    ).toContain('not the "media" capability')
  })
})

describe('the back office', () => {
  const used = [
    { key: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Photos', bundles: ['Observations'] },
  ]
  const media = `${V1}/media/aaaaaaaa-0000-4000-8000-000000000001`

  test('warns before renaming, moving or deleting a folder a bundle uses', () => {
    const rename = bundleWarningFor('PUT', media, { variants: [{ name: 'Pictures' }] }, used)
    expect(rename?.headline).toBe('Rename Photos?')
    expect(rename?.content).toContain('Observations')
    expect(rename?.content).not.toMatch(/bundle|path|boot/i)
    expect(bundleWarningFor('PUT', media, { variants: [{ name: 'photos' }] }, used)).toBeUndefined()
    expect(bundleWarningFor('PUT', `${media}/move`, {}, used)?.headline).toBe('Move Photos?')
    expect(bundleWarningFor('PUT', `${media}/move-to-recycle-bin`, {}, used)?.headline).toBe(
      'Delete Photos?',
    )
    expect(bundleWarningFor('DELETE', media, undefined, used)?.headline).toBe('Delete Photos?')
    expect(
      bundleWarningFor('PUT', `${V1}/media/bbbbbbbb-0000-4000-8000-000000000002`, {}, used),
    ).toBeUndefined()
    expect(usedByText(['Observations'])).toBe("Used by Observations to store members' files.")
  })

  test('the Permissions dialog sends the file types and the size limit', () => {
    expect(bytesOf('2')).toBe(2 * 1024 * 1024)
    expect(bytesOf('')).toBeNull()
    expect(bytesOf('-1')).toBeNull()
    expect(megabytesOf(1.5 * 1024 * 1024)).toBe('1.5')
    expect(megabytesOf(null)).toBe('')
    const sent = requestFor({
      inherit: false,
      read: 'private',
      write: 'private',
      groups: [],
      members: [],
      newRead: null,
      newWrite: null,
      memberTypes: ['jpeg'],
      memberMaxBytes: 1000,
    })
    expect(sent.rule).toMatchObject({ memberTypes: ['jpeg'], memberMaxBytes: 1000 })
  })
})

describe('the member in the audit log', () => {
  test('names the member and what they acted through, and never as a user', () => {
    const actor = memberActor(
      { key: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Ada', groups: ['Observers'] },
      { via: 'Observations' },
    )
    expect(mediaAuditEntryFor({ type: 'created', key: 'k' }, actor)).toMatchObject({
      userKey: null,
      userName: 'Ada',
      source: 'request',
      detail: 'A member, through Observations (aaaaaaaa-0000-4000-8000-000000000001)',
    })
    expect(outboxActor(actor)).toEqual({
      kind: 'member',
      name: 'Ada',
      userKey: null,
      memberKey: 'aaaaaaaa-0000-4000-8000-000000000001',
    })
  })
})

// --- On a real site -----------------------------------------------------------

const BUNDLE = 'observations'
const SITE = `/${BUNDLE}`
type Obs = BundleRouteContext<'media'>
const PASSWORD = 'correct-horse-battery'
const PACKAGE = {
  '@acme/observations': {
    json: {
      crombolo: {
        id: BUNDLE,
        server: BUNDLE,
        name: 'Observations',
        permissions: ['media.read', 'media.write', 'member.delegate'],
      },
    },
  },
}
const answer = (result: { ok: boolean; status?: number }) =>
  Response.json(result, { status: result.ok ? 200 : (result.status ?? 500) })

/** What a site's bundle would write: members add, read, change and remove photos. */
const observations = (media: Record<string, unknown> = {}): ServerBundle =>
  ({
    id: BUNDLE,
    section: 'media',
    capabilities: ['media'],
    media: { folders: ['/Observations/Photos'], maxBytes: 300_000, ...media },
    routes: [
      route<unknown, unknown, Obs>(
        `${SITE}/photos`,
        {
          POST: async (request, { url, bundle }) =>
            answer(
              await bundle.media.create({
                folder: url.searchParams.get('folder') ?? '',
                name: url.searchParams.get('name') ?? 'Photo',
                fileName: url.searchParams.get('file') ?? undefined,
                file: request,
              }),
            ),
        },
        { members: true },
      ),
      route<unknown, unknown, Obs>(
        `${SITE}/photos/:key`,
        {
          GET: async (_request, { params, bundle }) => {
            const item = await bundle.media.get(params.key as string)
            return item ? Response.json(item) : new Response('Not Found', { status: 404 })
          },
          PUT: async (request, { url, params, bundle }) =>
            answer(
              await bundle.media.update(params.key as string, {
                name: url.searchParams.get('name') ?? undefined,
                ...(url.searchParams.get('file')
                  ? { file: request, fileName: url.searchParams.get('file') as string }
                  : {}),
              }),
            ),
          DELETE: async (_request, { params, bundle }) =>
            answer(await bundle.media.delete(params.key as string)),
        },
        { members: true },
      ),
      route<unknown, unknown, Obs>(
        `${SITE}/list`,
        {
          GET: async (_request, { url, bundle }) =>
            answer(await bundle.media.list(url.searchParams.get('folder') ?? '')),
        },
        { members: true },
      ),
      route<unknown, unknown, Obs>(
        `${SITE}/file/:key`,
        {
          GET: (_request, { params, url, bundle }) =>
            bundle.media.crop(
              params.key as string,
              url.searchParams.get('width')
                ? { width: Number(url.searchParams.get('width')) }
                : undefined,
            ),
        },
        { members: true },
      ),
      route<unknown, unknown, Obs>(`${SITE}/anyone`, {
        POST: async (request, { bundle }) =>
          answer(
            await bundle.media.create({ folder: '/Observations/Photos', name: 'x', file: request }),
          ),
      }),
      route<unknown, unknown, Obs>(
        'list',
        {
          GET: async (_request, { url, bundle }) =>
            answer(await bundle.media.list(url.searchParams.get('folder') ?? '')),
        },
        { audience: 'backoffice' },
      ),
    ],
  }) as ServerBundle

const deliveryApi = {
  enabled: true,
  memberAuthorization: {
    clientCredentialsFlow: {
      enabled: true,
      associatedMembers: ['ada', 'bob', 'cy'].map((name) => ({
        userName: name,
        clientId: name,
        clientSecret: `${name}-secret`,
      })),
    },
  },
}

const harnesses: Harness[] = []
const servers: ServerHandle[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const h of harnesses.splice(0)) await h.db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A site with members and an Observations folder, set up before the bundle is
 * wired, then booted again with it: as a site adds a bundle to folders it has.
 */
async function realSite(media: Record<string, unknown> = {}) {
  const root = siteDeclaring('bundle-media', PACKAGE)
  dirs.push(root)
  const sqliteFile = join(root, 'site.sqlite')
  const config = {
    siteDir: root,
    sqliteFile,
    mediaDir: join(root, 'media'),
    deliveryApi,
  }
  const first = await signedInServer({ config })
  harnesses.push(first)

  const create = async (name: string, parent: string | null) => {
    const response = await first.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201) throw new Error(`folder ${name}: ${response.status}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const group = async (name: string) =>
    (await first.post(`${V1}/member-group`, { name })).headers.get(
      'umb-generated-resource',
    ) as string
  const member = async (username: string, groups: string[] = []) => {
    const response = await first.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: `${username}@example.test`,
      username,
      password: PASSWORD,
      isApproved: true,
      groups,
      values: [],
      variants: [{ culture: null, segment: null, name: username }],
    })
    if (response.status !== 201) throw new Error(`member ${username}: ${response.status}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const observers = await group('Observers')
  const members = {
    ada: await member('ada', [observers]),
    bob: await member('bob'),
    cy: await member('cy', [observers]),
  }
  const top = await create('Observations', null)
  const photos = await create('Photos', top)
  const closed = await create('Closed', photos)
  const elsewhere = await create('Elsewhere', null)
  const rule = (memberTypes: string[], memberMaxBytes: number | null) => ({
    rule: {
      publicRead: false,
      groups: [{ name: 'Observers', read: true, write: true }],
      newRead: null,
      newWrite: 'creator',
      memberTypes,
      memberMaxBytes,
    },
  })
  expect(
    (
      await first.put(
        `${BACKOFFICE}/crombolo/api/media-access/${photos}`,
        rule(['jpeg', 'png'], 200_000),
      )
    ).status,
  ).toBe(200)
  expect(
    (await first.put(`${BACKOFFICE}/crombolo/api/media-access/${closed}`, rule([], null))).status,
  ).toBe(200)

  await first.db.close()
  harnesses.splice(harnesses.indexOf(first), 1)
  const h = await signedInServer({
    keepDatabase: true,
    config: { ...config, bundles: [observations(media)], nodeId: 'with-bundle' },
  })
  harnesses.push(h)

  const tokens = new Map<string, string>()
  const tokenFor = async (name: string) => {
    if (tokens.has(name)) return tokens.get(name) as string
    const issued = await h.server.fetch(
      new Request(`${ORIGIN}/umbraco/delivery/api/v1/security/member/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: `umbraco-member-${name}`,
          client_secret: `${name}-secret`,
        }).toString(),
      }),
    )
    expect(issued.status).toBe(200)
    const { access_token } = (await issued.json()) as { access_token: string }
    tokens.set(name, access_token)
    return access_token
  }
  /** A call to the bundle as a member, by their Delivery API token. */
  const as = async (
    name: string | undefined,
    method: string,
    path: string,
    body?: BodyInit,
  ): Promise<Response> =>
    h.server.fetch(
      new Request(`${ORIGIN}${SITE}/${path}`, {
        method,
        body,
        headers: name ? { authorization: `Bearer ${await tokenFor(name)}` } : {},
      }),
    )
  const upload = (
    name: string,
    bytes: Uint8Array | BodyInit,
    file: string,
    folder = '/Observations/Photos',
  ) =>
    as(
      name,
      'POST',
      `photos?folder=${encodeURIComponent(folder)}&name=Sighting&file=${file}`,
      bytes as BodyInit,
    )
  const stored = (url: string) =>
    new Uint8Array(readFileSync(join(root, 'media', url.replace(/^\/media\//, ''))))
  return {
    h,
    root,
    config,
    members,
    folders: { top, photos, closed, elsewhere },
    as,
    upload,
    stored,
  }
}

describe(`server bundles create media as the member (${dialectUnderTest})`, () => {
  test('a member with write permission creates a photo: upright, stripped, its facts returned, and recorded as theirs', async () => {
    const s = await realSite()
    const created = await s.upload('ada', await phonePhoto(), 'IMG_0001.JPG')
    expect(created.status).toBe(200)
    const body = (await created.json()) as {
      key: string
      url: string
      metadata: Record<string, unknown>
    }
    expect(body.metadata).toEqual({
      width: 20,
      height: 30,
      takenAt: '2026-10-28T09:15:00+10:00',
      location: { latitude: -27.4705, longitude: 153.026, altitude: 27 },
    })
    const file = s.stored(body.url)
    for (const secret of ['Exif', 'SecretCam', 'secret-xmp', 'secret-comment'])
      expect(contains(file, secret)).toBe(false)
    expect(await new Bun.Image(file).metadata()).toMatchObject({ width: 20, height: 30 })

    // The creator, and the folder's write default stamped: only she may change it.
    const access = new MediaAccessRepository(s.h.server.db)
    expect(await access.itemAccess(body.key)).toEqual({
      readPolicy: 'inherit',
      writePolicy: 'creator',
      creatorMemberKey: s.members.ada,
    })
    const audit = await s.h.server.db.query<{
      user_name: string
      user_key: string | null
      detail: string
    }>(
      "SELECT user_name, user_key, detail FROM audit_entry WHERE entity_key = ? AND action = 'Create'",
      [body.key],
    )
    expect(audit[0]).toMatchObject({ user_name: 'ada', user_key: null })
    expect(audit[0]?.detail).toContain('Observations')

    const read = await s.as('ada', 'GET', `photos/${body.key}`)
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      key: body.key,
      name: 'Sighting',
      creator: s.members.ada,
      url: body.url,
    })
  })

  test('without write permission a member may not create, change or delete; reading follows read permission', async () => {
    const s = await realSite()
    const photo = (await (await s.upload('ada', await phonePhoto(), 'a.jpg')).json()) as {
      key: string
    }

    expect((await s.upload('bob', await phonePhoto(), 'b.jpg')).status).toBe(403)
    // Cy is an Observer, but the folder gives each file to the member who added it.
    expect((await s.as('cy', 'PUT', `photos/${photo.key}?name=Mine`)).status).toBe(403)
    expect((await s.as('cy', 'DELETE', `photos/${photo.key}`)).status).toBe(403)
    expect((await s.as('cy', 'GET', `photos/${photo.key}`)).status).toBe(200)
    expect((await s.as('bob', 'GET', `photos/${photo.key}`)).status).toBe(404)
    expect((await s.as('bob', 'GET', `file/${photo.key}`)).status).toBe(404)
    const listed = async (name: string) =>
      (
        (await (await s.as(name, 'GET', 'list?folder=/Observations/Photos')).json()) as {
          total: number
        }
      ).total
    expect(await listed('cy')).toBeGreaterThan(0)
    expect(await listed('bob')).toBe(0)

    const file = await s.as('ada', 'GET', `file/${photo.key}?width=10`)
    expect(file.status).toBe(200)
    expect(file.headers.get('cache-control')).toBe('private, no-store')
    expect((await new Bun.Image(new Uint8Array(await file.arrayBuffer())).metadata()).width).toBe(
      10,
    )

    const renamed = await s.as('ada', 'PUT', `photos/${photo.key}?name=Renamed`)
    expect(renamed.status).toBe(200)
    const replaced = await s.as(
      'ada',
      'PUT',
      `photos/${photo.key}?file=new.png`,
      pngWithExif(marked(4, 4), PHOTO_FACTS) as BodyInit,
    )
    expect(replaced.status).toBe(200)
    expect(
      ((await replaced.json()) as { metadata: { location: unknown } }).metadata.location,
    ).toBeDefined()
    expect((await s.as('ada', 'DELETE', `photos/${photo.key}`)).status).toBe(200)
    expect((await s.as('ada', 'GET', `photos/${photo.key}`)).status).toBe(404)
    const trashed = await s.h.server.db.query<{ trashed: unknown }>(
      'SELECT trashed FROM node WHERE unique_id = ?',
      [photo.key],
    )
    expect([true, 1, '1']).toContain(trashed[0]?.trashed as never)
  })

  test('only the declared folders and the subfolders below them, which are made as needed', async () => {
    const s = await realSite()
    expect((await s.upload('ada', await phonePhoto(), 'a.jpg', '/Elsewhere')).status).toBe(403)
    expect((await s.upload('ada', await phonePhoto(), 'a.jpg', '/Observations')).status).toBe(403)
    const below = await s.upload(
      'ada',
      await phonePhoto(),
      'a.jpg',
      '/Observations/Photos/2026/October',
    )
    expect(below.status).toBe(200)
    const again = await s.upload('ada', await phonePhoto(), 'b.jpg', '/observations/photos/2026')
    expect(again.status).toBe(200)
    const year = await s.h.server.db.query<{ unique_id: string }>(
      "SELECT unique_id FROM node WHERE text = '2026'",
    )
    expect(year).toHaveLength(1)
    // Made to hold files, it follows the folder's rule rather than being one member's.
    const access = new MediaAccessRepository(s.h.server.db)
    expect(await access.itemAccess(String(year[0]?.unique_id))).toMatchObject({
      readPolicy: 'inherit',
      writePolicy: 'inherit',
    })
    // A member of the group adds to the year folder another member made.
    expect(
      (await s.upload('cy', await phonePhoto(), 'c.jpg', '/Observations/Photos/2026')).status,
    ).toBe(200)
  })

  test("deleting a folder needs write permission on every file in it, so another member's files stay", async () => {
    const s = await realSite()
    const photo = (await (
      await s.upload('ada', await phonePhoto(), 'a.jpg', '/Observations/Photos/2026')
    ).json()) as { key: string }
    const year = await s.h.server.db.query<{ unique_id: string }>(
      "SELECT unique_id FROM node WHERE text = '2026'",
    )
    const yearKey = String(year[0]?.unique_id)

    expect((await s.as('cy', 'DELETE', `photos/${yearKey}`)).status).toBe(403)
    const trashed = async (key: string) =>
      (
        await s.h.server.db.query<{ trashed: unknown }>(
          'SELECT trashed FROM node WHERE unique_id = ?',
          [key],
        )
      )[0]?.trashed
    expect([false, 0, '0']).toContain((await trashed(photo.key)) as never)
    expect([false, 0, '0']).toContain((await trashed(yearKey)) as never)
    expect((await s.as('cy', 'GET', `photos/${photo.key}`)).status).toBe(200)

    // Ada may change everything in it, so she may delete the folder.
    expect((await s.as('ada', 'DELETE', `photos/${yearKey}`)).status).toBe(200)
    expect([true, 1, '1']).toContain((await trashed(photo.key)) as never)
  })

  test('types: a page named as a photo, a type off the list and an empty list are refused', async () => {
    const s = await realSite({ types: ['jpeg', 'png', 'gif'] })
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')
    const refused = await s.upload('ada', html, 'photo.jpg')
    expect(refused.status).toBe(415)
    const gif = new TextEncoder().encode('GIF89a\x01\0\x01\0\0\0\0;')
    // On the bundle's list but not the folder's.
    expect((await s.upload('ada', gif, 'a.gif')).status).toBe(415)
    expect(
      (await s.upload('ada', await phonePhoto(), 'a.jpg', '/Observations/Photos/Closed')).status,
    ).toBe(415)
    const pdf = new TextEncoder().encode('%PDF-1.7 a document')
    expect((await s.upload('ada', pdf, 'a.pdf')).status).toBe(415)

    // The bundle narrows the folder's list, never widens it.
    await s.h.db.close()
    harnesses.splice(harnesses.indexOf(s.h), 1)
    const narrow = await realSite({ types: ['png'] })
    expect((await narrow.upload('ada', await phonePhoto(), 'a.jpg')).status).toBe(415)
    expect((await narrow.upload('ada', marked(2, 2), 'a.png')).status).toBe(200)
  })

  test("size: the folder's limit, the bundle's, and an upload stopped as it is read", async () => {
    const s = await realSite({ maxBytes: 100_000 })
    const big = (size: number) => {
      const out = new Uint8Array(size)
      out.set(marked(2, 2))
      return out
    }
    // The bundle's 100 KB is smaller than the folder's 200 KB.
    const tooBig = await s.upload('ada', big(150_000), 'a.png')
    expect(tooBig.status).toBe(413)
    expect(((await tooBig.json()) as { message: string }).message).toContain('98 KB')

    await s.h.db.close()
    harnesses.splice(harnesses.indexOf(s.h), 1)
    const roomy = await realSite({ maxBytes: 5_000_000 })
    expect((await roomy.upload('ada', big(250_000), 'a.png')).status).toBe(413)

    // Sent as a stream with no length given: reading stops once past the limit.
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 40) controller.close()
        else controller.enqueue(pulled === 1 ? big(50_000) : new Uint8Array(50_000))
      },
    })
    expect((await roomy.upload('ada', stream, 'a.png')).status).toBe(413)
    expect(pulled).toBeLessThan(10)
  })

  test('a public route may not use media; a back-office route runs as its user', async () => {
    const s = await realSite()
    const refused = await s.h.server.fetch(
      new Request(`${ORIGIN}${SITE}/anyone`, { method: 'POST', body: marked(2, 2) as BodyInit }),
    )
    expect(refused.status).toBe(401)
    await s.upload('ada', await phonePhoto(), 'a.jpg')
    // The administrator sees what a member who is not in the group cannot.
    const listed = await s.h.call(
      `${BACKOFFICE}/crombolo/api/bundle/${BUNDLE}/list?folder=/Observations/Photos`,
    )
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { total: number }).total).toBeGreaterThan(0)
  })

  test('the back office says which bundle uses a folder, and lists every folder its path runs through', async () => {
    const s = await realSite()
    const describe = await s.h.json<{
      usedBy: string[]
      memberFileTypes: unknown[]
      own: { memberTypes: string[]; memberMaxBytes: number }
    }>(`${BACKOFFICE}/crombolo/api/media-access/${s.folders.photos}`)
    expect(describe.usedBy).toEqual(['Observations'])
    expect(describe.own).toMatchObject({ memberTypes: ['jpeg', 'png'], memberMaxBytes: 200_000 })
    expect(describe.memberFileTypes.length).toBeGreaterThan(5)
    const top = await s.h.json<{ usedBy: string[] }>(
      `${BACKOFFICE}/crombolo/api/media-access/${s.folders.top}`,
    )
    expect(top.usedBy).toEqual(['Observations'])
    const elsewhere = await s.h.json<{ usedBy: string[] }>(
      `${BACKOFFICE}/crombolo/api/media-access/${s.folders.elsewhere}`,
    )
    expect(elsewhere.usedBy).toEqual([])

    const used = await s.h.json<Array<{ key: string; name: string; bundles: string[] }>>(
      `${BACKOFFICE}/crombolo/api/media-access/used`,
    )
    expect(used.map((u) => u.key).sort()).toEqual([s.folders.top, s.folders.photos].sort())
    const warning = bundleWarningFor(
      'PUT',
      `${V1}/media/${s.folders.top}`,
      { variants: [{ name: 'Sightings' }] },
      used,
    )
    expect(warning?.headline).toBe('Rename Observations?')
  })

  test('a declared folder that does not exist refuses the boot, naming the bundle and the path', async () => {
    const s = await realSite()
    const missing = createServer(
      loadConfig({
        ...s.config,
        bundles: [observations({ folders: ['/Observations/Photos', '/Observations/Videos'] })],
        nodeId: 'missing',
      }),
    )
    const message = await missing.then(
      (server) => {
        servers.push(server)
        return ''
      },
      (error: Error) => error.message,
    )
    expect(message).toContain(
      'Bundle "Observations" uses the media folder "/Observations/Videos", which does not exist',
    )
    // The folder it names that exists is not the problem.
    expect(message).not.toContain('"/Observations/Photos"')
  })
})
