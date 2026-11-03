/** What a host runs, written against `@crombolo/crombolo/host` only (story 173). */
import {
  type CromboloConfig,
  describeProvenance,
  loadConfig,
  type PackageJson,
  type ProvenancePolicy,
  peerRangeProblem,
  provenanceProblem,
  VERSION,
  validateBundlePackage,
  verifyPackage,
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

/** A bundle's signature held to the site's rule before the host installs it (story 244). */
export async function signatureCheck(
  path: string,
  policy: ProvenancePolicy,
): Promise<{ line: string; refused: string | undefined; retry: boolean }> {
  const result = await verifyPackage(path)
  return {
    line: describeProvenance(result),
    refused: provenanceProblem(result, policy),
    retry: result.state === 'unchecked',
  }
}
