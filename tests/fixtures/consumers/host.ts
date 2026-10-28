/** What a host runs, written against `@crombolo/crombolo/host` only (story 173). */
import {
  type CromboloConfig,
  loadConfig,
  type PackageJson,
  peerRangeProblem,
  VERSION,
  validateBundlePackage,
} from '@crombolo/crombolo/host'

/** A site's effective config, as a host's own `server.ts` builds it. */
export function hostConfig(overrides: Partial<CromboloConfig>, siteDir: string): CromboloConfig {
  return loadConfig(overrides, siteDir)
}

/** A package checked by the CMS's own rules before the host installs it. */
export function vet(json: PackageJson): string[] {
  const problems = validateBundlePackage(json)
  const range = json.peerDependencies?.['@crombolo/crombolo']
  if (problems.length === 0 && json.name && json.version && range) {
    const peer = peerRangeProblem(
      {
        packageName: json.name,
        version: json.version,
        directory: '',
        id: '',
        name: json.name,
        peerRange: range,
        private: false,
        field: { id: '' },
        contentDir: undefined,
        carries: { extensions: false, content: false, server: false },
      },
      VERSION,
    )
    if (peer) problems.push(peer)
  }
  return problems
}
