import { UMB_SECTION_PATH_PATTERN } from '@umbraco-cms/backoffice/section';

export const UMB_SETTINGS_SECTION_PATHNAME = 'settings';

/** Crombolo: Structure and Code are places under Content, each a section of its own (story 385). */
export const UMB_STRUCTURE_SECTION_PATHNAME = 'content/structure';
export const UMB_CODE_SECTION_PATHNAME = 'content/code';

export const UMB_SETTINGS_SECTION_PATH = UMB_SECTION_PATH_PATTERN.generateAbsolute({
	sectionName: UMB_SETTINGS_SECTION_PATHNAME,
});
