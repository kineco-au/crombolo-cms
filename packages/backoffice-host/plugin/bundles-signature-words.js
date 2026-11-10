/**
 * What the Bundles screens say about where a bundle was built (story 060), in
 * words for the person installing it. Pure, so it is tested without a browser.
 */
const short = (commit) => (commit ?? '').slice(0, 7)
const refName = (ref) => (ref ?? '').replace(/^refs\/(tags|heads)\//, '')

/**
 * @param {{ state: string, source?: { repository: string, ref: string, commit: string },
 *   links?: { commit?: string, tag?: string | null, run?: string | null }, reason?: string }} provenance
 * @param {string | null | undefined} refused why this site would not install it, when it would not
 * @param {{ signatures?: string, sources?: string[] } | undefined} policy
 * @returns {{ tone: string, label: string, detail: string, links: { label: string, href: string }[], refusal: string }}
 */
export function signatureWords(provenance, refused, policy) {
  const links = []
  let tone = 'default'
  let label = 'Not signed'
  let detail = "Nobody has signed this bundle, so where it was built can't be checked."
  if (provenance?.state === 'signed' && provenance.source) {
    const { repository, ref, commit } = provenance.source
    tone = 'positive'
    label = 'Signed'
    detail = `Built from github.com/${repository} at ${refName(ref)} (${short(commit)}).`
    if (provenance.links?.commit) links.push({ label: 'Commit', href: provenance.links.commit })
    if (provenance.links?.tag) links.push({ label: 'Release', href: provenance.links.tag })
    if (provenance.links?.run) links.push({ label: 'Build', href: provenance.links.run })
  } else if (provenance?.state === 'local') {
    label = 'From this site'
    detail = "Linked from this site's own code, not from a package registry."
  } else if (provenance?.state === 'vouched') {
    label = 'From the host'
    detail = 'Applied by the platform that runs this site, which checked where it came from.'
  } else if (provenance?.state === 'unchecked') {
    tone = 'warning'
    label = "Couldn't be checked right now"
    detail =
      "Its signature couldn't be checked just now, so it will not be installed. Try again in a few minutes."
  } else if (provenance?.state === 'invalid') {
    tone = 'danger'
    label = "Signature doesn't match"
    detail = provenance.reason?.startsWith('the bundle has changed')
      ? 'It has been changed since it was signed, so it will not be installed.'
      : "Its signature can't be checked, so it will not be installed."
  }
  let refusal = ''
  if (refused && provenance?.state !== 'invalid' && provenance?.state !== 'unchecked') {
    tone = 'danger'
    refusal =
      provenance?.state === 'signed' && policy?.sources?.length
        ? `This site only installs signed bundles from ${policy.sources.join(', ')}.`
        : 'This site only installs signed bundles.'
  }
  return { tone, label, detail, links, refusal }
}
