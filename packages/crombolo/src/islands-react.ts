/**
 * What the browser runs to mount a `'use client'` island with React (story
 * 209): the one part of `@crombolo/crombolo` that is bundled for the browser.
 * Crombolo's island build includes it; a site building islands with Vite lists
 * it among its inputs. React is the site's own.
 */
import { type ComponentType, createElement } from 'react'
import { createRoot } from 'react-dom/client'

/** Renders the component into the island, with the server-rendered children as its `children`. */
export function mount(
  component: ComponentType<Record<string, unknown>>,
  element: Element,
  props: Record<string, unknown>,
  childrenHtml: string | null,
): void {
  const children =
    childrenHtml === null
      ? undefined
      : createElement('div', {
          style: { display: 'contents' },
          dangerouslySetInnerHTML: { __html: childrenHtml },
        })
  element.replaceChildren()
  createRoot(element).render(
    createElement(component, children === undefined ? props : { ...props, children }),
  )
}
