import { UMB_SECTION_PATH_PATTERN } from '@umbraco-cms/backoffice/section';

// Crombolo: a place under Content, which a workspace holds (story 419).
export const UMB_TRANSLATION_SECTION_PATHNAME = 'content/translation';
export const UMB_TRANSLATION_SECTION_PATH = UMB_SECTION_PATH_PATTERN.generateAbsolute({
	sectionName: UMB_TRANSLATION_SECTION_PATHNAME,
});
