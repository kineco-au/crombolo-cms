/**
 * Keeps a person's theme with them (story 049). The choice is made in their
 * profile, on Umbraco's theme context, which links the stylesheet and keeps the
 * alias in `localStorage` for the shell's early script to apply before the next
 * paint. This keeps it in user data as well, so it follows them to another browser.
 */
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api'
import { UMB_THEME_CONTEXT } from '@umbraco-cms/backoffice/themes'

/** The Management API, under the back office wherever it is mounted. */
const USER_DATA = `${(document.querySelector('base')?.getAttribute('href') ?? '/crombolo/').replace(/\/$/, '')}/management/api/v1/user-data`
const GROUP = 'crombolo'
const IDENTIFIER = 'theme'
const EARLY = 'crombolo-early-theme'

/** The person's saved theme, and its key for saving over it; undefined when it cannot be read. */
async function readSaved() {
  try {
    const query = new URLSearchParams({ groups: GROUP, identifiers: IDENTIFIER, take: '1' })
    const response = await fetch(`${USER_DATA}?${query}`, { credentials: 'include' })
    if (!response.ok) return undefined
    return (await response.json()).items?.[0] ?? {}
  } catch {
    return undefined
  }
}

async function save(alias, key) {
  const body = { group: GROUP, identifier: IDENTIFIER, value: alias }
  try {
    const response = await fetch(USER_DATA, {
      method: key ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(key ? { ...body, key } : body),
    })
    return key ?? response.headers.get('umb-generated-resource') ?? undefined
  } catch {
    // Kept in this browser regardless; another will start from its own.
    return key
  }
}

export const onInit = (host) => {
  new UmbContextConsumerController(host, UMB_THEME_CONTEXT, async (context) => {
    if (!context) return
    let current
    let settled = false
    let key
    let saved
    context.theme.subscribe((alias) => {
      current = alias
      // The shell's early stylesheet stood in until the context took over;
      // once the choice differs from it, it would only fight the new one.
      const early = document.getElementById(EARLY)
      if (early && early.dataset.theme !== (alias || 'umb-light-theme')) early.remove()
      if (!settled || !alias || alias === saved) return
      saved = alias
      save(alias, key).then((written) => {
        key = written
      })
    })
    const found = await readSaved()
    key = found?.key
    saved = found?.value ?? current
    if (found?.value && found.value !== current) context.setThemeByAlias(found.value)
    settled = true
  })
}
