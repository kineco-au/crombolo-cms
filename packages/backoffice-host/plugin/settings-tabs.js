/**
 * The tabs a Settings tool opens with, under its title: on the page itself, not a band
 * of their own, the open one marked in the accent over a hairline.
 */
import { css } from '@umbraco-cms/backoffice/external/lit'

export const settingsTabStyles = css`
  uui-tab-group {
    /* UUI's tab group fills its container's height; here it is a strip. */
    flex: none;
    height: auto;
    margin: 0 var(--uui-size-layout-1);
    padding: 0;
    background: none;
    border-bottom: 1px solid var(--uui-color-border);
    --uui-tab-divider: transparent;
    --uui-tab-padding-horizontal: 0;
    --uui-tab-text: var(--uui-color-text-alt);
    --uui-tab-text-hover: var(--uui-color-text);
    --uui-tab-text-active: var(--uui-color-interactive-emphasis);
  }
`

/**
 * The gap between the tabs. UUI's tab group reads it only from its own inline style,
 * and only in pixels, to work out how wide its tabs are: set any other way it counts
 * none, and the last tab is cut off.
 */
export const TAB_GAP = '--uui-tab-group-gap: 18px'
