/** The split of sidebar and page that Crombolo's section layouts draw, as Umbraco's own do. */
import { css } from '@umbraco-cms/backoffice/external/lit'

/** Where Umbraco's sections keep the sidebar's width, so every section shares one. */
const SPLIT_POSITION = 'umb-split-panel-position'

export const savedPosition = () => {
  try {
    return localStorage.getItem(SPLIT_POSITION) ?? undefined
  } catch {
    return undefined
  }
}

export const savePosition = (event) => {
  try {
    localStorage.setItem(SPLIT_POSITION, String(event.detail.position))
  } catch {
    // A browser that keeps nothing starts at the default width each time.
  }
}

export const SPLIT_STYLES = css`
      /* As Umbraco's own sections draw the split, so the width is the same in each. */
      umb-split-panel {
        --umb-split-panel-start-min-width: 200px;
        --umb-split-panel-start-max-width: 400px;
        --umb-split-panel-end-min-width: 600px;
        --umb-split-panel-slot-overflow: visible;
      }
      @media only screen and (min-width: 800px) {
        umb-split-panel {
          --umb-split-panel-initial-position: 300px;
        }
      }
`
