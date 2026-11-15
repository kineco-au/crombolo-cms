/**
 * The media library from the command line (story 355): list, find and show
 * items, change them, make folders, and say who may see them, on this site's
 * database through the core the remote protocol uses, or, with --profile, on a
 * hosted site through those routes. Changes go through the media operations as
 * the person signed in, and are audited as them.
 */
import { basename } from 'node:path'
import {
  bootstrapDatabase,
  FILE_NAME_HEADER,
  type FocalPoint,
  type FoldersMade,
  findMedia,
  listMedia,
  type MediaAccessChange,
  type MediaAccessView,
  MediaFileStore,
  type MediaItem,
  MediaLibraryError,
  type MediaPage,
  type MediaQuery,
  type MediaUpdated,
  makeFolders,
  mediaAccess,
  mediaStoreFor,
  type ReferencePage,
  setMediaAccess,
  showMedia,
  siteMediaOperations,
  updateMedia,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { commandActor } from './acting.ts'
import { connectSite, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

export type { MediaAccessView, MediaItem, MediaPage, MediaUpdated, ReferencePage }

/** What `media update` asks for: a new file by its path here. */
export interface MediaEdit {
  name?: string
  alt?: string
  focal?: FocalPoint
  file?: string
}

export interface MediaSite {
  hosted: boolean
  list(query: MediaQuery): Promise<MediaPage>
  find(query: MediaQuery & { name: string }): Promise<MediaPage>
  show(
    ref: string,
    references: boolean,
    paging?: { skip?: number; take?: number },
  ): Promise<MediaItem>
  update(ref: string, edit: MediaEdit, dryRun: boolean): Promise<MediaUpdated>
  folders(path: string): Promise<FoldersMade>
  access(ref: string): Promise<MediaAccessView>
  setAccess(ref: string, change: MediaAccessChange): Promise<MediaAccessView>
}

/** What each part needs of a hosted site, in the words its refusal uses. */
const CAPABILITIES = {
  'media-library': 'list, show and change its media',
  'media-access': 'show and set who may see its media',
} as const

const refusal = (error: MediaLibraryError): CliError =>
  new CliError(
    error.kind === 'forbidden' ? 'refused' : error.kind,
    error.message,
    error.hint ? { hint: error.hint } : undefined,
  )

/** A file to send, read from its path here; refused when there is none. */
async function fileAt(path: string): Promise<File> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new CliError('not_found', `There is no file at ${path}.`)
  return new File([await file.bytes()], basename(path))
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withMediaLibrary<T>(
  flags: ProfileFlagValues,
  needs: keyof typeof CAPABILITIES,
  work: (site: MediaSite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  try {
    if (hosted) return await work(await hostedMedia(hosted, needs))
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    const writer = async () => ({
      db,
      media: await siteMediaOperations(db, config),
      files: new MediaFileStore(await mediaStoreFor(config)),
    })
    const access = { db, nodeId: `cli:${config.nodeId}` }
    try {
      return await work({
        hosted: false,
        list: (query) => listMedia(db, commandActor(), query),
        find: (query) => findMedia(db, commandActor(), query),
        show: (ref, references, paging) =>
          showMedia(db, commandActor(), ref, { references, ...paging }),
        update: async (ref, edit, dryRun) =>
          updateMedia(
            await writer(),
            commandActor(),
            ref,
            {
              ...(edit.name !== undefined ? { name: edit.name } : {}),
              ...(edit.alt !== undefined ? { alt: edit.alt } : {}),
              ...(edit.focal ? { focal: edit.focal } : {}),
              ...(edit.file ? { file: await fileAt(edit.file) } : {}),
            },
            { dryRun },
          ),
        folders: async (path) => makeFolders(await writer(), commandActor(), path),
        access: (ref) => mediaAccess(access, commandActor(), ref),
        setAccess: (ref, change) => setMediaAccess(access, commandActor(), ref, change),
      })
    } finally {
      await db.close()
    }
  } catch (error) {
    throw error instanceof MediaLibraryError ? refusal(error) : error
  }
}

async function hostedMedia(site: HostedSite, needs: keyof typeof CAPABILITIES): Promise<MediaSite> {
  const { discovery, client, environment } = await connectSite(site)
  if (!discovery.capabilities?.includes(needs))
    throw new CliError('refused', `This site needs a newer crombolo to ${CAPABILITIES[needs]}.`, {
      hint: `${discovery.name} has to be upgraded first.`,
    })
  const env = `environments/${needEnvironment(environment, discovery)}/media-items`
  const item = (ref: string) => `${env}/${encodeURIComponent(ref)}`
  const send = <T>(path: string, method: string, body: unknown) =>
    client.json<T>(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const query = (asked: MediaQuery & { name?: string }) => {
    const out = new URLSearchParams()
    if (asked.under) out.set('under', asked.under)
    if (asked.type) out.set('type', asked.type)
    if (asked.name !== undefined) out.set('name', asked.name)
    out.set('skip', String(asked.skip ?? 0))
    out.set('take', String(asked.take ?? 25))
    return out
  }
  return {
    hosted: true,
    list: (asked) => client.json(`${env}?${query(asked)}`),
    find: (asked) => client.json(`${env}?${query(asked)}`),
    show: (ref, references, paging = {}) =>
      client.json(
        `${item(ref)}${references ? `?references=true&skip=${paging.skip ?? 0}&take=${paging.take ?? 25}` : ''}`,
      ),
    async update(ref, edit, dryRun) {
      const { file, ...details } = edit
      let updated: MediaUpdated | undefined
      if (Object.keys(details).length > 0)
        updated = await send<MediaUpdated>(item(ref), 'PATCH', {
          ...(details.name !== undefined ? { name: details.name } : {}),
          ...(details.alt !== undefined ? { alt: details.alt } : {}),
          ...(details.focal ? { focal: `${details.focal.left},${details.focal.top}` } : {}),
          dryRun,
        })
      if (!file) return updated as MediaUpdated
      if (!(await Bun.file(file).exists()))
        throw new CliError('not_found', `There is no file at ${file}.`)
      const replaced = await client.json<MediaUpdated>(
        `${item(updated?.key ?? ref)}/file${dryRun ? '?dryRun=true' : ''}`,
        {
          method: 'PUT',
          headers: { [FILE_NAME_HEADER]: encodeURIComponent(basename(file)) },
          body: Bun.file(file),
        },
      )
      return updated
        ? { ...replaced, changed: [...updated.changed, ...replaced.changed] }
        : replaced
    },
    folders: (path) => send(`${env}/folders`, 'POST', { path }),
    access: (ref) => client.json(`${item(ref)}/access`),
    setAccess: (ref, change) => send(`${item(ref)}/access`, 'PUT', change),
  }
}

/** `--focal x,y`. */
export const focalFlag = Flags.string({
  summary: 'the point a crop keeps, each from 0 to 1',
  helpValue: '<x,y>',
})

/** A size as people read it: 2.4 MB, 812 KB, 90 bytes. Pure. */
export function sizeWords(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** "Showing 26–50 of 120", or nothing when there is one page. Pure. */
export function showingWords(skip: number, shown: number, total: number): string | undefined {
  if (shown === 0 || (skip === 0 && shown >= total)) return undefined
  return `Showing ${skip + 1}–${skip + shown} of ${total}`
}

/** One item of a list: what it is, its size and its place. Pure. */
export const mediaLine = (item: MediaPage['items'][number]): string =>
  `  ${(item.folder ? 'folder' : item.type).padEnd(14)} ${sizeWords(item.size).padEnd(10)} ${item.path}`

/** What uses something, a line each. Pure. */
export function referenceLines(references: ReferencePage): string[] {
  const kind = {
    page: 'page',
    media: 'media',
    library: 'Library',
    member: 'member',
    other: 'other',
  }
  return references.items.map(
    (r) => `    ${kind[r.kind].padEnd(8)} ${r.path ?? r.name}${r.type ? `  (${r.type})` : ''}`,
  )
}

const listed = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`

/** The parts of an item's permissions, a line each, as `media access show` gives them. Pure. */
export function accessLines(view: MediaAccessView): string[] {
  const { form, state } = view
  const readers = form.groups.filter((g) => g.read).map((g) => g.name)
  const writers = form.groups.filter((g) => g.write).map((g) => g.name)
  const see =
    form.read === 'public'
      ? 'anyone with the link'
      : form.read === 'private'
        ? 'only back-office users'
        : form.allMembers
          ? 'all signed-in members'
          : readers.length > 0
            ? listed(readers)
            : 'nobody chosen yet'
  const rule = state.own ?? state.inherited
  const members = form.members.length
  const lines = [
    `  who can see it     ${see}`,
    `  who can change it  ${form.write === 'custom' && writers.length > 0 ? listed(writers) : 'no members'}`,
    `  settings           ${form.inherit ? (state.inherited?.from ? `follows ${state.inherited.from.name}` : 'the defaults') : 'its own'}`,
  ]
  if (members > 0) lines.push(`  chosen members     ${members}`)
  if (rule && rule.memberTypes.length > 0)
    lines.push(
      `  member uploads     ${rule.memberTypes.join(', ')}${rule.memberMaxBytes ? `, up to ${sizeWords(rule.memberMaxBytes)}` : ''}`,
    )
  if (state.own?.newRead || state.own?.newWrite)
    lines.push(
      `  new files          ${[state.own.newRead && `seen by ${state.own.newRead}`, state.own.newWrite && `changed by ${state.own.newWrite}`].filter(Boolean).join(', ')}`,
    )
  return lines
}

export const listFields = [
  {
    name: 'items',
    type: 'array',
    items: {
      type: 'object',
      fields: [
        { name: 'key', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'path', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'folder', type: 'boolean' },
        { name: 'size', type: 'integer', nullable: true },
      ],
    },
  },
  { name: 'total', type: 'integer' },
] as const

export const referenceFields = {
  name: 'references',
  type: 'object',
  nullable: true,
  description: 'with --references: what uses it',
  fields: [
    { name: 'total', type: 'integer' },
    {
      name: 'items',
      type: 'array',
      items: {
        type: 'object',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'kind', type: 'string', enum: ['page', 'media', 'library', 'member', 'other'] },
          { name: 'path', type: 'string', nullable: true },
          { name: 'type', type: 'string', nullable: true },
        ],
      },
    },
  ],
} as const

export const accessFields = [
  { name: 'key', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'path', type: 'string' },
  { name: 'summary', type: 'string' },
  { name: 'form', type: 'object', description: 'the Permissions dialog’s form' },
  { name: 'state', type: 'object', description: 'everything the Permissions dialog reads' },
] as const
