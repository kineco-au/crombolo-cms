/**
 * Preview (story 053): the CMS's Preview button opens `/preview` with an editor's
 * token, kept for this tab and sent with every read until they leave it.
 */
const KEY = 'harbourstone.preview'

export function previewToken(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function startPreview(token: string): void {
  sessionStorage.setItem(KEY, token)
}

export function leavePreview(): void {
  sessionStorage.removeItem(KEY)
}
