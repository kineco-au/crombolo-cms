/**
 * Extension discovery. `/public` is anonymous and feeds the login screen;
 * `/private` requires a signed-in user and carries the rest.
 */
import type { ManifestPort } from '../ports.ts'
import type { ManagementApiRouter } from '../router.ts'

export function registerManifestHandlers(
  router: ManagementApiRouter,
  manifests: ManifestPort,
): void {
  router.handle('GetManifestManifest', async () => Response.json(await manifests.list('all')))
  router.handle('GetManifestManifestPublic', async () =>
    Response.json(await manifests.list('public')),
  )
  router.handle('GetManifestManifestPrivate', async () =>
    Response.json(await manifests.list('private')),
  )
}
