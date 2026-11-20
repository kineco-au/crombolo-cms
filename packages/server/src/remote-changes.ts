/**
 * The remote protocol's routes for changes (story 383): the site's changes, which
 * of some it already holds, one exported as a change bundle (or an open
 * workspace, or the page edits since a point), and one sent here to be staged or
 * applied. Exporting is a pull; staging and applying need Apply changes, and
 * Install code too when the change carries templates or the site's own code.
 * docs/changes.md.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management/domain'
import { normaliseUuid, RemotePermissions, type RemoteVerb } from '@crombolo/core'
import { ChangeRepository, type Db, WorkspaceRepository } from '@crombolo/data'
import {
  type ChangeBundle,
  ChangeBundleError,
  readChangeBundle,
  writeChangeBundle,
} from '@crombolo/transfer'
import type { ChangeTransfer } from './change-transfer.ts'
import { extractTarball, writeNpmTarball } from './tar.ts'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface ChangeRouteOptions {
  db: Db
  changes: () => ChangeTransfer | undefined
  problem(status: number, body: Problem): Response
  atLeast(level: 'read' | 'content'): boolean
  notAtLevel(level: 'read' | 'content', what: string): Response
  may(principal: Principal, verb: RemoteVerb): boolean
  /** The request's body, written to `path`, with its hash; undefined when it carried none. */
  receive(request: Request, path: string): Promise<{ sha256: string; size: number } | undefined>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ONE = /^changes\/([0-9a-f-]{36})\/bundle$/i
const WORKSPACE = /^workspaces\/([0-9a-f-]{36})\/change$/i

/** A change bundle packed as a tarball, as it travels. */
export function packChange(change: ChangeBundle, media: ReadonlyMap<string, Uint8Array>) {
  const encoder = new TextEncoder()
  return writeNpmTarball(
    writeChangeBundle(change, media).map((file) => ({
      path: file.path,
      bytes: file.bytes ?? encoder.encode(file.text ?? ''),
    })),
  )
}

/** A packed change, unpacked and checked whole. */
export async function unpackChange(file: string) {
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-change-'))
  try {
    await extractTarball(file, dir)
    return readChangeBundle(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Whether a change carries code: templates, or the site's own files read as it starts. */
export const carriesCode = (change: ChangeBundle) =>
  change.files.some((f) => f.path.startsWith('components/') || f.path.startsWith('site/'))

export function createChangeRoutes(options: ChangeRouteOptions) {
  const { problem } = options
  const packed = (change: ChangeBundle, media: ReadonlyMap<string, Uint8Array>) => {
    const bytes = packChange(change, media)
    return new Response(bytes, {
      headers: {
        'content-type': 'application/gzip',
        'crombolo-sha256': new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
        'content-disposition': `attachment; filename="change-${change.key}.tgz"`,
      },
    })
  }
  const forbidden = (title: string, detail: string) =>
    problem(403, { code: 'forbidden', title, detail })

  async function receiveChange(request: Request) {
    const declared = request.headers.get('crombolo-sha256')?.toLowerCase()
    if (!declared || !/^[0-9a-f]{64}$/.test(declared))
      return problem(400, { code: 'hash-required', title: 'Crombolo-Sha256 is required' })
    const dir = mkdtempSync(join(tmpdir(), 'crombolo-change-in-'))
    const file = join(dir, 'change.tgz')
    try {
      let received: { sha256: string } | undefined
      try {
        received = await options.receive(request, file)
      } catch {
        return problem(413, {
          code: 'too-large',
          title: 'The change is larger than this site takes',
        })
      }
      if (!received)
        return problem(400, { code: 'body-required', title: 'The request carried no change' })
      if (received.sha256 !== declared)
        return problem(400, {
          code: 'hash-mismatch',
          title: 'The change is not the one described',
          detail:
            'Its SHA-256 does not match Crombolo-Sha256: it was changed or cut short on the way.',
        })
      try {
        return await unpackChange(file)
      } catch (error) {
        return problem(400, {
          code: 'not-a-change',
          title: 'It is not a change this site can read',
          detail: error instanceof ChangeBundleError ? error.message : String(error),
        })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    capabilities(): string[] {
      return options.changes() && options.atLeast('read') ? ['changes'] : []
    },

    /** Answers the route, or undefined when `what` is not one of these. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const transfer = options.changes()
      const isOurs =
        what === 'changes' ||
        what.startsWith('changes/') ||
        (WORKSPACE.test(what) && request.method === 'GET')
      if (!isOurs) return undefined
      if (!transfer)
        return problem(404, {
          code: 'not-enabled',
          title: 'Workspaces are not turned on for this site',
        })

      if (request.method === 'GET') {
        if (!options.atLeast('read')) return options.notAtLevel('read', 'pulls')
        if (!options.may(principal, RemotePermissions.Pull))
          return forbidden(
            'You may not take changes from this site',
            'It needs Crombolo.Remote.Pull.',
          )
        const changes = new ChangeRepository(options.db)
        if (what === 'changes') {
          const skip = Number(url.searchParams.get('skip') ?? 0) || 0
          const take = Math.min(Number(url.searchParams.get('take') ?? 50) || 50, 500)
          return Response.json(await changes.list(skip, take))
        }
        if (what === 'changes/held') {
          const keys = (url.searchParams.get('keys') ?? '').split(',').filter((k) => UUID.test(k))
          return Response.json({ held: [...(await changes.held(keys))] })
        }
        if (what === 'changes/since') {
          const at = new Date(url.searchParams.get('at') ?? '')
          if (Number.isNaN(at.getTime()))
            return problem(400, {
              code: 'bad-time',
              title: 'Say since when, as an ISO time in `at`',
            })
          const out = await transfer.exportSince(at)
          return packed(out.change, out.media)
        }
        const one = ONE.exec(what)?.[1]
        if (one) {
          const out = await transfer.exportChange(normaliseUuid(one))
          if (!out)
            return problem(404, { code: 'not-found', title: 'There is no such change here' })
          return packed(out.change, out.media)
        }
        const open = WORKSPACE.exec(what)?.[1]
        if (open) {
          const workspace = await new WorkspaceRepository(options.db).byKey(normaliseUuid(open))
          if (workspace?.state !== 'open')
            return problem(404, {
              code: 'not-found',
              title: 'There is no such open workspace here',
            })
          const out = await transfer.exportWorkspace(workspace)
          return packed(out.change, out.media)
        }
        return problem(404, { code: 'not-found', title: 'There is no such route' })
      }

      if (what === 'changes' && request.method === 'PUT') {
        if (!options.atLeast('content')) return options.notAtLevel('content', 'changes')
        if (!options.may(principal, RemotePermissions.ApplyChanges))
          return forbidden(
            'You may not apply changes here',
            'Staging or applying a change needs "Apply changes" (Crombolo.Remote.ApplyChanges).',
          )
        const received = await receiveChange(request)
        if (received instanceof Response) return received
        if (carriesCode(received.change) && !options.may(principal, RemotePermissions.InstallCode))
          return forbidden(
            'You may not apply this change here',
            'It carries templates or the site\'s own code, which needs "Install code on this site" (Crombolo.Remote.InstallCode).',
          )
        const stage = url.searchParams.get('stage') === 'true'
        const intoKey = url.searchParams.get('into')
        const accepted = (url.searchParams.get('accept') ?? '').split(',').filter(Boolean)
        if (stage) {
          const workspaces = new WorkspaceRepository(options.db)
          const into = intoKey && UUID.test(intoKey) ? await workspaces.byKey(intoKey) : undefined
          if (intoKey && (!into?.stagedReadOnly || into.state !== 'open'))
            return problem(404, { code: 'not-found', title: 'There is no such staged change here' })
          const outcome = await transfer.stage([received], principal, into)
          return Response.json(
            {
              workspace: outcome.workspace?.key ?? null,
              skipped: outcome.skipped,
              conflicts: outcome.conflicts,
            },
            { status: outcome.conflicts.length > 0 ? 409 : 200 },
          )
        }
        const outcome = await transfer.apply([received], principal, { accepted })
        return Response.json(outcome, { status: outcome.ok ? 200 : 409 })
      }
      return new Response(null, { status: 405 })
    },
  }
}
