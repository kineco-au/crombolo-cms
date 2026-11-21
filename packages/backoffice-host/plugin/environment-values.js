/**
 * A property's value per environment, edited from a button by its field (story 387).
 * On a page, a property that varies by environment has "Values per environment" in its
 * actions: a dialog with the shared value and each environment's own, the current one
 * marked, and the warning that none of it is secret. The field keeps the shared value.
 */

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

export const ENVIRONMENT_VALUES_CONDITION = 'Crombolo.Condition.VariesByEnvironment'
export const ENVIRONMENT_VALUES_ACTION = 'Crombolo.PropertyAction.EnvironmentValues'

/** What the dialog says of every value it shows. */
export const NOT_SECRET =
  'Every environment’s value is seen on every copy of the site and in every change: keep secrets in the site’s own settings.'

const api = (path = '', init = {}) =>
  fetch(`${base()}/crombolo/api/environment-values${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...init,
  })

/** The site's environments: which this is, which the schema names, and whether its values are read only. */
export async function readEnvironments() {
  const response = await api().catch(() => undefined)
  return response?.ok ? response.json() : { current: '', names: [], readOnly: true }
}

const pages = new Map()

/** A page's properties that vary by environment, once per page until it is saved again. */
export function readPageValues(key, fresh = false) {
  if (fresh || !pages.has(key))
    pages.set(
      key,
      api(`/${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((body) => body.items ?? [])
        .catch(() => []),
    )
  return pages.get(key)
}

/** Sets one environment's value, or clears it with an empty one. */
export async function saveValue(key, item, environment, value) {
  const response = await api(`/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      alias: item.alias,
      culture: item.culture,
      segment: item.segment,
      environment,
      value: value === '' ? null : value,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `The server answered ${response.status}.`)
  pages.set(key, Promise.resolve(body.items ?? []))
  return body.items ?? []
}

/**
 * The rows the dialog shows for one property: each environment the schema names, in
 * its order, the current one marked, and then any value kept for one it no longer has.
 * Pure.
 */
export function rowsFor(item, environments) {
  const own = new Map(item.overrides.map((o) => [o.environment, o.value]))
  const rows = environments.names.map((name) => ({
    environment: name,
    value: own.get(name) ?? '',
    current: name === environments.current,
    unused: false,
  }))
  for (const o of item.overrides)
    if (!environments.names.includes(o.environment))
      rows.push({ environment: o.environment, value: o.value, current: false, unused: true })
  return rows
}

/** A value as the dialog's text box shows it. */
export const asText = (value) =>
  value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

export const ENVIRONMENT_CONDITION_MANIFEST = {
  type: 'condition',
  alias: ENVIRONMENT_VALUES_CONDITION,
  name: 'Crombolo Varies By Environment',
  api: () => import('./environment-values-condition.js'),
}

/** The action, for every property editor there is: the condition says which properties show it. */
const actionFor = (editors) => ({
  type: 'propertyAction',
  kind: 'default',
  alias: ENVIRONMENT_VALUES_ACTION,
  name: 'Crombolo Values Per Environment',
  api: () => import('./environment-values-action.js'),
  forPropertyEditorUis: editors,
  meta: { icon: 'icon-globe', label: 'Values per environment' },
  conditions: [{ alias: ENVIRONMENT_VALUES_CONDITION }],
})

export const onInit = (_host, extensionRegistry) => {
  extensionRegistry.register(ENVIRONMENT_CONDITION_MANIFEST)
  extensionRegistry.byType('propertyEditorUi').subscribe((editors) => {
    const aliases = editors.map((e) => e.alias)
    if (extensionRegistry.isRegistered(ENVIRONMENT_VALUES_ACTION))
      extensionRegistry.unregister(ENVIRONMENT_VALUES_ACTION)
    extensionRegistry.register(actionFor(aliases))
  })
}
