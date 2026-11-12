/** CI access's words and its one API call (story 160). Pure but for `trustApi`. */

/** What a rule may hold, in the order a person reads them. */
export const CI_PERMISSIONS = [
  {
    verb: 'Crombolo.Remote.Pull',
    label: 'Pull',
    explain: "Download the site's content, without its private parts.",
  },
  {
    verb: 'Crombolo.Remote.PullFull',
    label: 'Pull everything',
    explain: 'Download the site with people and private data too.',
  },
  { verb: 'Crombolo.Remote.Push', label: 'Push', explain: 'Replace this site from a file.' },
  {
    verb: 'Crombolo.Remote.PushProtected',
    label: 'Push to a protected site',
    explain: 'Change a site people rely on, such as production, with nobody approving it.',
  },
  {
    verb: 'Crombolo.Remote.ApplyStructure',
    label: 'Change structure',
    explain: 'Apply a bundle that changes its types, stylesheets or scripts.',
  },
  {
    verb: 'Crombolo.Remote.InstallCode',
    label: 'Install code',
    explain:
      'Install extensions, the code and templates a site package carries, and push a whole site: all of these run on the server.',
  },
]

/** A provider by the address its tokens come from. */
export function providerName(issuer) {
  if (issuer === 'https://token.actions.githubusercontent.com') return 'GitHub Actions'
  if (issuer === 'https://gitlab.com') return 'GitLab'
  return `GitLab at ${issuer.replace(/^https?:\/\//, '')}`
}

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/remote-trust`

/** Calls the trust rules; a refusal throws with the server's reasons as `items`. */
export async function trustApi(method, path = '', body) {
  const response = await fetch(`${base()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 204) return undefined
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.title ?? `Deployment pipelines responded ${response.status}`)
    error.items = result.items
    throw error
  }
  return result
}
