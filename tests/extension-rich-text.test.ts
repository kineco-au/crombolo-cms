/**
 * Story 435: rich text an extension writes through the site's API carries no script, by the
 * baseline its rendered components are held to (330), and the answer says what was taken
 * out. An editor's own rich text is not touched: this runs only on an extension's calls.
 */
import { expect, test } from 'bun:test'
import { cleanMarkup } from '../packages/server/src/bundle-api.ts'

test('every rich text value in a body is cleaned, what was removed named; the rest unchanged', () => {
  const body = {
    name: 'Notes <script>is text here</script>',
    values: [
      { alias: 'title', value: '<script>a title is text</script>' },
      {
        alias: 'body',
        value: {
          markup:
            '<p onclick="steal()">Hi<script>steal()</script> <a href="javascript:x()">x</a></p>',
          blocks: { contentData: [{ values: [{ value: { markup: '<img src=x onerror=y()>' } }] }] },
        },
      },
    ],
  }
  const { body: cleaned, removed } = cleanMarkup(body)
  const values = (cleaned as typeof body).values
  expect(values[0]).toEqual(body.values[0])
  expect((cleaned as typeof body).name).toBe(body.name)
  const markup = String((values[1]?.value as { markup?: string } | undefined)?.markup)
  expect(markup).not.toContain('script')
  expect(markup).not.toContain('onclick')
  expect(markup).not.toContain('javascript:')
  expect(markup).toContain('Hi')
  const nested = JSON.stringify(values[1]?.value)
  expect(nested).not.toContain('onerror')
  expect(removed).toEqual(
    expect.arrayContaining(['<script>', 'onclick on <p>', 'onerror on <img>', 'href on <a>']),
  )
})

test('a body with nothing to clean comes back as it was, and says nothing', () => {
  const body = { values: [{ alias: 'body', value: { markup: '<p><strong>Safe</strong></p>' } }] }
  expect(cleanMarkup(body)).toEqual({ body, removed: [] })
})
