/** The back office's own confirmation in place of the browser's: true to go on, false when cancelled. */
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal'

export async function ask(host, { headline, content = '', confirmLabel, color = 'danger' }) {
  try {
    await umbConfirmModal(host, { headline, content, confirmLabel, color })
    return true
  } catch {
    return false
  }
}
