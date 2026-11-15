/**
 * Story 355's core: the media library as the command line and the remote
 * protocol read and change it. Pages of items by folder, type and name within a
 * person's start nodes, one item shown, what uses it, its details and file
 * changed, folders made only where missing, and permissions set with the
 * Permissions dialog's rules.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management/domain'
import { operatorActor, userActor } from '@crombolo/content'
import { MediaPermissions } from '@crombolo/core'
import {
  changedForm,
  findMedia,
  listMedia,
  MediaFileStore,
  MediaLibraryError,
  makeFolders,
  mediaAccess,
  mediaStoreFor,
  parseFocalPoint,
  type RuleBody,
  referencesTo,
  saveMediaAccess,
  setMediaAccess,
  showMedia,
  siteMediaOperations,
  updateMedia,
  usedByWords,
} from '@crombolo/server'
import { summarise } from '../packages/backoffice-host/plugin/media-access-rules.js'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer } from './support/harness.ts'
import { mediaMaker, png, writeArticleSchema } from './support/media-commands.ts'

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

const operator = operatorActor('test')

/** A person with the Media section, its start nodes only these keys. */
const person = (startKeys: string[] | 'root', update = true) =>
  userActor({
    id: crypto.randomUUID(),
    name: 'Ada',
    isAdmin: false,
    allowedSections: ['Umb.Section.Media'],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: {
      document: { root: true, keys: [] },
      media: startKeys === 'root' ? { root: true, keys: [] } : { root: false, keys: startKeys },
      element: { root: true, keys: [] },
    },
    groups: [
      {
        key: crypto.randomUUID(),
        alias: 'mediaPeople',
        defaults: update
          ? [MediaPermissions.Read, MediaPermissions.Update]
          : [MediaPermissions.Read],
        granular: new Map(),
      },
    ],
  } as unknown as Principal)

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'media-library-'))
  dirs.push(root)
  writeArticleSchema(join(root, 'schema'), join(root, 'components'))
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
    },
  })
  open.push(h)
  const make = mediaMaker(h)
  const gallery = await make.folder('Gallery')
  const brand = await make.folder('Brand')
  const hero = await make.image('hero', gallery, {
    alt: 'The harbour',
    focalPoint: { left: 0.4, top: 0.6 },
  })
  const harbour = await make.image('harbour', gallery)
  const brochure = await make.file('brochure', gallery)
  const logo = await make.image('logo', brand)
  const db = h.server.db
  const writer = async () => ({
    db,
    media: await siteMediaOperations(db, h.server.config),
    files: new MediaFileStore(await mediaStoreFor(h.server.config)),
  })
  return { h, db, make, gallery, brand, hero, harbour, brochure, logo, writer }
}

const refused = async (work: Promise<unknown>, kind: MediaLibraryError['kind']) => {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(MediaLibraryError)
  expect((error as MediaLibraryError).kind).toBe(kind)
  return error as MediaLibraryError
}

describe(`the media library core (${dialectUnderTest})`, () => {
  test('list and find: paged, by folder and type, within a person’s start nodes', async () => {
    const s = await site()
    const top = await listMedia(s.db, operator)
    expect(top.items.map((i) => i.name)).toEqual(['Brand', 'Gallery'])
    expect(top.items.every((i) => i.folder)).toBe(true)

    const gallery = await listMedia(s.db, operator, { under: '/Gallery' })
    expect(gallery.total).toBe(3)
    expect(gallery.items.map((i) => i.path)).toEqual([
      '/Gallery/brochure',
      '/Gallery/harbour',
      '/Gallery/hero',
    ])
    expect(gallery.items.find((i) => i.name === 'hero')).toMatchObject({
      key: s.hero.key,
      type: 'Image',
      folder: false,
    })
    expect(gallery.items.find((i) => i.name === 'hero')?.size).toBeGreaterThan(0)

    const paged = await listMedia(s.db, operator, { under: '/Gallery', skip: 1, take: 1 })
    expect(paged).toMatchObject({ total: 3 })
    expect(paged.items.map((i) => i.name)).toEqual(['harbour'])
    const images = await listMedia(s.db, operator, { under: s.gallery, type: 'Image' })
    expect(images.items.map((i) => i.name)).toEqual(['harbour', 'hero'])

    const found = await findMedia(s.db, operator, { name: 'H' })
    expect(found.items.map((i) => i.path)).toEqual([
      '/Gallery/brochure',
      '/Gallery/harbour',
      '/Gallery/hero',
    ])
    expect((await findMedia(s.db, operator, { name: 'ero' })).items.map((i) => i.key)).toEqual([
      s.hero.key,
    ])
    expect((await findMedia(s.db, operator, { name: 'o', under: '/Brand' })).items).toHaveLength(1)
    await refused(findMedia(s.db, operator, { name: '  ' }), 'usage')
    await refused(listMedia(s.db, operator, { under: '/Nowhere' }), 'not_found')

    // Someone who starts at Brand sees only what is in it.
    const brandOnly = person([s.brand])
    expect((await findMedia(s.db, brandOnly, { name: 'o' })).items.map((i) => i.name)).toEqual([
      'logo',
    ])
    expect((await listMedia(s.db, brandOnly, { under: '/Brand' })).total).toBe(1)
    await refused(listMedia(s.db, brandOnly, { under: '/Gallery' }), 'forbidden')
    await refused(showMedia(s.db, brandOnly, '/Gallery/hero'), 'forbidden')
    expect((await findMedia(s.db, person('root'), { name: 'o' })).total).toBe(4)
  })

  test('show: its type, folder, file, size, alternative text, focal point and who can see it', async () => {
    const s = await site()
    const shown = await showMedia(s.db, operator, '/Gallery/hero')
    expect(shown).toMatchObject({
      key: s.hero.key,
      name: 'hero',
      path: '/Gallery/hero',
      type: { alias: 'Image', name: 'Image' },
      folder: false,
      parent: { key: s.gallery, name: 'Gallery', path: '/Gallery' },
      file: s.hero.src,
      width: 4,
      height: 3,
      extension: 'png',
      alt: 'The harbour',
      focal: { left: 0.4, top: 0.6 },
      access: 'Default permissions. Anyone with the link can see this. No members can change it.',
      protected: false,
    })
    expect(shown.size).toBeGreaterThan(0)
    expect(shown.references).toBeUndefined()
    expect(await showMedia(s.db, operator, s.hero.key)).toMatchObject({ path: '/Gallery/hero' })
    const folder = await showMedia(s.db, operator, '/Gallery')
    expect(folder).toMatchObject({ folder: true, file: null, size: null, parent: null })
    expect((await showMedia(s.db, operator, '/Gallery/brochure')).alt).toBeNull()
  })

  test('references: a picker, a link and a rich text image each name the item', async () => {
    const s = await site()
    expect(usedByWords(await referencesTo(s.db, s.hero.key))).toBe('Nothing uses it.')
    await s.make.article('Story', s.hero)
    await s.make.article('Another', s.hero)
    const used = await referencesTo(s.db, s.hero.key)
    expect(used.total).toBe(2)
    expect(used.items.map((r) => [r.kind, r.path, r.type])).toEqual([
      ['page', '/Another', 'article'],
      ['page', '/Story', 'article'],
    ])
    expect(usedByWords(used)).toBe('Used by 2 pages.')
    const shown = await showMedia(s.db, operator, '/Gallery/hero', { references: true })
    expect(shown.references?.total).toBe(2)
    // Each way of using it is found by itself: the other two taken off a third page.
    const drop = (alias: string) =>
      s.db.q
        .deleteFrom('property_value')
        .where('property_type_id', 'in', (eb) =>
          eb.selectFrom('property_type').select('id').where('alias', '=', alias),
        )
        .execute()
    await drop('hero')
    await drop('links')
    expect((await referencesTo(s.db, s.hero.key)).total).toBe(2)
    await drop('body')
    expect((await referencesTo(s.db, s.hero.key)).total).toBe(0)
    for (const kept of ['hero', 'links', 'body']) {
      const name = `Only ${kept}`
      await s.make.article(name, s.hero)
      for (const alias of ['hero', 'links', 'body'].filter((a) => a !== kept))
        await s.db.q
          .deleteFrom('property_value')
          .where('property_type_id', 'in', (eb) =>
            eb.selectFrom('property_type').select('id').where('alias', '=', alias),
          )
          .execute()
      expect(
        (await referencesTo(s.db, s.hero.key)).items.map((r) => r.name),
        kept,
      ).toEqual([name])
      await drop(kept)
    }
  })

  test('update: refused where its type has no alternative text or focal point, or takes no such file', async () => {
    const s = await site()
    const w = await s.writer()
    const noAlt = await refused(
      updateMedia(w, operator, '/Gallery/brochure', { alt: 'x' }),
      'refused',
    )
    expect(noAlt.message).toContain('no text field for its alternative text')
    const noFocal = await refused(
      updateMedia(w, operator, '/Gallery/brochure', { focal: { left: 0.5, top: 0.5 } }),
      'refused',
    )
    expect(noFocal.message).toContain('has no focal point')
    const wrong = await refused(
      updateMedia(w, operator, '/Gallery/hero', { file: new File(['%PDF'], 'hero.pdf') }),
      'refused',
    )
    expect(wrong.message).toContain('does not take a .pdf file')
    expect(wrong.hint).toContain('File')
    await refused(updateMedia(w, operator, '/Gallery/hero', { name: ' ' }), 'usage')
    await refused(updateMedia(w, person([s.brand]), '/Gallery/hero', { alt: 'x' }), 'forbidden')
  })

  test('update: name, alternative text and focal point saved; a new file keeps the key, the old file goes', async () => {
    const s = await site()
    const w = await s.writer()
    const dry = await updateMedia(
      w,
      operator,
      '/Gallery/hero',
      { alt: 'At dawn' },
      { dryRun: true },
    )
    expect(dry.changed).toEqual(['alt'])
    expect((await showMedia(s.db, operator, '/Gallery/hero')).alt).toBe('The harbour')

    const done = await updateMedia(w, operator, '/Gallery/hero', {
      name: 'Hero',
      alt: 'At dawn',
      focal: { left: 0.1, top: 0.2 },
    })
    expect(done).toMatchObject({
      key: s.hero.key,
      path: '/Gallery/Hero',
      changed: ['name', 'alt', 'focal'],
    })
    expect(await showMedia(s.db, operator, s.hero.key)).toMatchObject({
      name: 'Hero',
      alt: 'At dawn',
      focal: { left: 0.1, top: 0.2 },
      file: s.hero.src,
    })
    expect((await updateMedia(w, operator, s.hero.key, { alt: 'At dawn' })).changed).toEqual([])

    await s.make.article('Story', s.hero)
    const replaced = await updateMedia(w, operator, s.hero.key, {
      file: new File([await png(8, 6)], 'dawn.png'),
    })
    expect(replaced.changed).toEqual(['file'])
    expect(replaced.references?.total).toBe(1)
    const after = await showMedia(s.db, operator, s.hero.key)
    expect(after.file).not.toBe(s.hero.src)
    expect(after.file).toEndWith('dawn.png')
    expect(after).toMatchObject({ width: 8, height: 6, focal: { left: 0.1, top: 0.2 } })
    expect((await s.h.call(after.file as string)).status).toBe(200)
    expect((await s.h.call(s.hero.src)).status).toBe(404)
    const audit = await s.db.query<{ action: string; entity_key: string }>(
      "SELECT action, entity_key FROM audit_entry WHERE category = 'media' AND action = 'Save'",
    )
    expect(audit.filter((row) => row.entity_key === s.hero.key)).toHaveLength(2)
  })

  test('folders: made only where missing, and a file in the way refused', async () => {
    const s = await site()
    const w = await s.writer()
    const made = await makeFolders(w, operator, '/Gallery/2026/Spring')
    expect(made.made).toEqual(['/Gallery/2026', '/Gallery/2026/Spring'])
    expect((await showMedia(s.db, operator, made.key)).path).toBe('/Gallery/2026/Spring')
    const again = await makeFolders(w, operator, 'Gallery/2026/Spring/')
    expect(again).toMatchObject({ key: made.key, made: [] })
    await refused(makeFolders(w, operator, '/Gallery/hero/Inside'), 'refused')
    await refused(makeFolders(w, operator, '/'), 'usage')
    await refused(makeFolders(w, person([s.brand]), '/Gallery/Elsewhere'), 'forbidden')
  })

  test('access: read with the dialog’s summary, set with its rules, and what is not named kept', async () => {
    const s = await site()
    await s.make.group('Gold')
    await s.make.group('Silver')
    const context = { db: s.db }
    const before = await mediaAccess(context, operator, '/Gallery')
    expect(before.summary).toBe(summarise(before.state))
    expect(before.form.read).toBe('public')

    const gold = await setMediaAccess(context, operator, '/Gallery', {
      groups: ['gold'],
      level: 'read',
    })
    // At the top of the library there is no folder above to say it is set apart from.
    expect(gold.summary).toBe('Only Gold can see this. No members can change it.')
    expect(gold.form).toMatchObject({ inherit: false, read: 'custom' })
    expect(gold.state.protected).toBe(true)
    const below = await mediaAccess(context, operator, '/Gallery/hero')
    expect(below.summary).toBe(
      'Inherited from Gallery. Only Gold can see this. No members can change it.',
    )

    const changed = await setMediaAccess(context, operator, '/Gallery', {
      groups: ['Silver'],
      level: 'change',
    })
    expect(changed.summary).toContain('Only Gold and Silver can see this.')
    expect(changed.summary).toContain('Silver can change it.')

    // What set does not name is kept: member uploads on the rule, and their size.
    await saveMediaAccess(context, s.gallery, {
      rule: { ...(changed.state.own as RuleBody), memberTypes: ['png'], memberMaxBytes: 2048 },
    })
    const anyone = await setMediaAccess(context, operator, '/Gallery', { see: 'anyone' })
    expect(anyone.form.read).toBe('public')
    expect(anyone.form.groups.find((g) => g.name === 'Silver')).toMatchObject({ write: true })
    expect(anyone.state.own).toMatchObject({ memberTypes: ['png'], memberMaxBytes: 2048 })

    const backOffice = await setMediaAccess(context, operator, '/Gallery', { see: 'back-office' })
    expect(backOffice.summary).toContain('Only back-office users can see this.')

    const own = await setMediaAccess(context, operator, '/Gallery/hero', { inherit: false })
    expect(own.form.inherit).toBe(false)
    expect(own.state.own).not.toBeNull()
    const follows = await setMediaAccess(context, operator, '/Gallery/hero', { inherit: true })
    expect(follows.form.inherit).toBe(true)
    expect(follows.state.own).toBeNull()

    const unknown = await refused(
      setMediaAccess(context, operator, '/Gallery', { groups: ['Bronze'], level: 'read' }),
      'not_found',
    )
    expect(unknown.hint).toContain('Gold and Silver')
    await refused(
      setMediaAccess(context, person('root', false), '/Gallery', { see: 'anyone' }),
      'forbidden',
    )
    await refused(mediaAccess(context, person([s.brand]), '/Gallery'), 'forbidden')
  })

  test('the form a change comes to is the dialog’s, and a focal point is two numbers from 0 to 1', () => {
    const state = {
      key: 'k',
      name: 'Gallery',
      hasParent: false,
      hasFile: false,
      own: null,
      inherited: null,
      item: { readPolicy: 'inherit', writePolicy: 'inherit', creator: null },
      protected: false,
      memberGroups: ['Gold'],
      memberFileTypes: [],
      usedBy: [],
    } as unknown as Parameters<typeof changedForm>[0]
    expect(changedForm(state, { groups: ['GOLD'], level: 'change' })).toMatchObject({
      inherit: false,
      read: 'public',
      write: 'custom',
      groups: [{ name: 'Gold', read: true, write: true }],
    })
    expect(changedForm(state, { inherit: true }).inherit).toBe(true)
    expect(parseFocalPoint('0.4,0.6')).toEqual({ left: 0.4, top: 0.6 })
    expect(parseFocalPoint('1.2,0')).toBeUndefined()
    expect(parseFocalPoint('0.5')).toBeUndefined()
  })
})
