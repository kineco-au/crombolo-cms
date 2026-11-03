/** Story 246: what the header says while a large media change runs in the background. */
import { describe, expect, test } from 'bun:test'
import { mediaJobWords } from '../packages/backoffice-host/plugin/media-jobs-words.js'

describe('a media change in the background', () => {
  test('says how far it has got, and how it ended', () => {
    expect(mediaJobWords({ state: 'queued' }).label).toBe('Updating media…')
    expect(mediaJobWords({ state: 'running', progress: { done: 5000, total: 100000 } }).label).toBe(
      'Updating media: 5,000 of 100,000',
    )
    expect(mediaJobWords({ state: 'running', progress: { done: 1200 } }).label).toBe(
      'Updating media: 1,200 done',
    )
    expect(mediaJobWords({ state: 'succeeded' })).toEqual({
      tone: 'positive',
      label: 'Media updated',
    })
    expect(mediaJobWords({ state: 'failed' })).toEqual({
      tone: 'danger',
      label: "A media change didn't finish",
    })
  })
})
