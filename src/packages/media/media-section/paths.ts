import { UMB_SECTION_PATH_PATTERN } from '@umbraco-cms/backoffice/section';

// Crombolo: Media is a place under Content (story 385).
export const UMB_MEDIA_SECTION_PATHNAME = 'content/media';
export const UMB_MEDIA_SECTION_PATH = UMB_SECTION_PATH_PATTERN.generateAbsolute({
	sectionName: UMB_MEDIA_SECTION_PATHNAME,
});
