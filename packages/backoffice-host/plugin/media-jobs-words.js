/** What the header says about a large media change running in the background (story 246). Pure. */

const count = (n) => n.toLocaleString('en')

/**
 * @param {{ state: string, progress?: { done: number, total?: number } | null }} job
 * @returns {{ tone: string, label: string }}
 */
export function mediaJobWords(job) {
  if (job.state === 'failed') return { tone: 'danger', label: "A media change didn't finish" }
  if (job.state === 'succeeded') return { tone: 'positive', label: 'Media updated' }
  const progress = job.progress
  if (progress?.total)
    return {
      tone: 'default',
      label: `Updating media: ${count(progress.done)} of ${count(progress.total)}`,
    }
  if (progress?.done)
    return { tone: 'default', label: `Updating media: ${count(progress.done)} done` }
  return { tone: 'default', label: 'Updating media…' }
}
