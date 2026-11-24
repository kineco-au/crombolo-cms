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
    --uui-tab-group-gap: var(--uui-size-space-5);
    --uui-tab-padding-horizontal: 0;
    --uui-tab-text: var(--uui-color-text-alt);
    --uui-tab-text-hover: var(--uui-color-text);
    --uui-tab-text-active: var(--uui-color-interactive-emphasis);
  }
`
