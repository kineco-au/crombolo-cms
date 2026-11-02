/** What the `remote trust` commands share: a rule as the remote shows it, and the words for it. */

export interface TrustRuleView {
  key: string
  name: string
  issuer: string
  repository: string
  refKind: 'branch' | 'tag' | 'environment'
  refValue: string
  permissions: string[]
  disabled: boolean
  createdBy: string | null
  createDate: string
  lastUsedDate: string | null
}

/** The verbs as the CLI names them, and the remote's own. */
export const MAY: Record<string, string> = {
  pull: 'Crombolo.Remote.Pull',
  'pull-full': 'Crombolo.Remote.PullFull',
  push: 'Crombolo.Remote.Push',
  'push-protected': 'Crombolo.Remote.PushProtected',
  'apply-structure': 'Crombolo.Remote.ApplyStructure',
  'install-code': 'Crombolo.Remote.InstallCode',
}

const named = (verb: string) => Object.entries(MAY).find(([, v]) => v === verb)?.[0] ?? verb

/** A provider as typed: `github`, `gitlab`, or a self-managed GitLab's address. */
export function issuerFor(provider: string): string {
  if (provider === 'github') return 'https://token.actions.githubusercontent.com'
  if (provider === 'gitlab') return 'https://gitlab.com'
  return provider.replace(/\/+$/, '')
}

/** One line for a rule: what it matches, what it may do, whether it is on. */
export function describeRule(rule: TrustRuleView): string {
  const provider =
    rule.issuer === 'https://token.actions.githubusercontent.com'
      ? 'GitHub'
      : rule.issuer === 'https://gitlab.com'
        ? 'GitLab'
        : rule.issuer
  const used = rule.lastUsedDate ? `last used ${rule.lastUsedDate.slice(0, 10)}` : 'never used'
  return `${rule.name}: ${provider} ${rule.repository} ${rule.refKind} ${rule.refValue}; may ${rule.permissions.map(named).join(', ')}; ${rule.disabled ? 'disabled' : used}`
}
