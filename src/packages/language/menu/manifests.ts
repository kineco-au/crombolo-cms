import { UMB_WORKSPACE_CONDITION_ALIAS } from '@umbraco-cms/backoffice/workspace';

export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'menuItem',
		alias: 'Umb.MenuItem.Languages',
		name: 'Languages Menu Item',
		// Crombolo: Languages sit in Translation, beside the dictionary (story 419).
		weight: 50,
		meta: {
			label: '#treeHeaders_languages',
			icon: 'icon-globe',
			entityType: 'language-root',
			menus: ['Umb.Menu.Translation.Languages'],
		},
	},
	{
		type: 'workspaceContext',
		name: 'Language Menu Structure Workspace Context',
		alias: 'Umb.Context.Language.Menu.Structure',
		api: () => import('./language-menu-structure.context.js'),
		conditions: [
			{
				alias: UMB_WORKSPACE_CONDITION_ALIAS,
				match: 'Umb.Workspace.Language',
			},
		],
	},
	{
		type: 'workspaceFooterApp',
		kind: 'menuBreadcrumb',
		alias: 'Umb.WorkspaceFooterApp.Language.Breadcrumb',
		name: 'Language Breadcrumb Workspace Footer App',
		conditions: [
			{
				alias: UMB_WORKSPACE_CONDITION_ALIAS,
				match: 'Umb.Workspace.Language',
			},
		],
	},
];
