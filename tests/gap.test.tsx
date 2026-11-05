/**
 * Story 281: a marked gap in a template. Visitors see its children or nothing,
 * and a page with a `<Gap>` is the page without one; an editor's preview shows a
 * box saying what is missing.
 */
import { describe, expect, test } from 'bun:test'
import { Gap, type PageProps, renderScope } from '@crombolo/render'
import { renderToString } from '@crombolo/render/jsx-runtime'

const render = (node: () => unknown, preview = false) =>
  renderScope({} as PageProps, () => renderToString(node() as never), { preview })

const Slow = async () => <em>later</em>

describe('to visitors', () => {
  test('a gap with no children leaves nothing', async () => {
    const html = await render(() => (
      <main>
        <h1>Title</h1>
        <Gap reason="Gone" was="Basket()" />
      </main>
    ))
    expect(html).toBe('<main><h1>Title</h1></main>')
  })

  test('a gap is its children, even async ones, and nothing more', async () => {
    const html = await render(() => (
      <Gap reason="Gone" was="Basket()">
        <p>Call us</p>
        <Slow />
      </Gap>
    ))
    expect(html).toBe('<p>Call us</p><em>later</em>')
  })
})

describe('in preview', () => {
  test('says what is missing and what was there, around its children', async () => {
    const html = (await render(
      () => (
        <Gap reason="The shop has not moved" was="Basket()">
          <p>Call us</p>
        </Gap>
      ),
      true,
    )) as string
    expect(html).toStartWith('<span class="crombolo-gap"')
    expect(html).toContain('The shop has not moved')
    expect(html).toContain('Was: Basket()')
    expect(html).toContain("Visitors don't see this box.")
    expect(html).toContain('<p>Call us</p>')
  })

  test('has a size of its own with no children, and no line for an unset was', async () => {
    const html = (await render(() => <Gap reason="Gone" />, true)) as string
    expect(html).toContain('min-height: 96px')
    expect(html).not.toContain('Was:')
  })

  test('escapes what it is given', async () => {
    const html = (await render(
      () => <Gap reason={'<script>a</script>'} was={'<b>"x"</b>'} />,
      true,
    )) as string
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;a&lt;/script&gt;')
  })
})
