import { UMB_TRANSLATION_SECTION_ALIAS } from '../section/index.js';
import { UMB_TRANSLATION_LANGUAGES_MENU_ALIAS, UMB_TRANSLATION_MENU_ALIAS } from './constants.js';
import { UMB_SECTION_ALIAS_CONDITION_ALIAS } from '@umbraco-cms/backoffice/section';

export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'menu',
		alias: UMB_TRANSLATION_MENU_ALIAS,
		name: 'Translation Menu',
	},
	{
		type: 'sectionSidebarApp',
		kind: 'menuWithEntityActions',
		alias: 'Umb.SidebarMenu.Translation',
		name: 'Translation Sidebar Menu',
		weight: 100,
		meta: {
			label: '#general_dictionary', // We are using dictionary here on purpose until dictionary has its own menu item.
			menu: UMB_TRANSLATION_MENU_ALIAS,
			entityType: 'dictionary-root', // hard-coded on purpose to avoid circular dependency. We need another way to add actions to a menu kind.
		},
		conditions: [
			{
				alias: UMB_SECTION_ALIAS_CONDITION_ALIAS,
				match: UMB_TRANSLATION_SECTION_ALIAS,
			},
		],
	},
	// Crombolo: the languages, below the dictionary, which a workspace holds with it (story 419).
	{
		type: 'menu',
		alias: UMB_TRANSLATION_LANGUAGES_MENU_ALIAS,
		name: 'Translation Languages Menu',
	},
	{
		type: 'sectionSidebarApp',
		kind: 'menu',
		alias: 'Umb.SidebarMenu.Translation.Languages',
		name: 'Translation Languages Sidebar Menu',
		weight: 50,
		meta: {
			label: '#treeHeaders_languages',
			menu: UMB_TRANSLATION_LANGUAGES_MENU_ALIAS,
		},
		conditions: [
			{
				alias: UMB_SECTION_ALIAS_CONDITION_ALIAS,
				match: UMB_TRANSLATION_SECTION_ALIAS,
			},
		],
	},
];
