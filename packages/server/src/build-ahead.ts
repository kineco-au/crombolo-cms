/**
 * Story 087: what `crombolo start` builds for a site, built once by `crombolo install`, so a
 * site that does not build fails there (in an image, the image's build) rather than at its
 * first start. The same code a start runs: the views' generation, the site's own
 * back-office modules (story 431) and its Tailwind stylesheet (story 452).
 */
import { ViewSnapshots } from '@crombolo/render'
import type { CromboloConfig } from './config.ts'
import { createSiteBackOfficeBuild } from './site-backoffice-build.ts'
import { describeTailwindProblem, SiteTailwind } from './tailwind.ts'

/** Builds it; answers what could not be built, in words. */
export async function buildAhead(config: CromboloConfig): Promise<string[]> {
  const problems: string[] = []
  const views = new ViewSnapshots({
    sourceDir: config.componentsDir,
    cacheDir: config.componentsCacheDir,
    onProblem: (message) => problems.push(`The views: ${message}`),
    onSwap: () => {},
  })
  await views.prepare()
  if (!views.directory()) problems.push('The views could not be built.')
  const screens = createSiteBackOfficeBuild(config.siteDir, config.backoffice, (_, said) =>
    problems.push(`The site's back-office screens: ${String(said.reason ?? '')}`),
  )
  await screens.ready()
  if (config.styles.tailwind) {
    const tailwind = new SiteTailwind(config)
    await tailwind.refresh()
    const problem = tailwind.problem()
    if (problem) problems.push(`The Tailwind stylesheet: ${describeTailwindProblem(problem)}`)
  }
  return problems
}
