import type { UmbSectionElement } from './section-element.interface.js';
import type { ManifestElement } from '@umbraco-cms/backoffice/extension-api';

/**
 * Crombolo: the element a section is drawn with in place of `umb-section-default`,
 * declared by a package without registering the section again.
 */
export interface ManifestSectionLayout extends ManifestElement<UmbSectionElement> {
	type: 'sectionLayout';
	forSection: string;
}
