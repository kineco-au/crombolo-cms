import { UMB_USER_GROUP_DETAIL_REPOSITORY_ALIAS, UMB_USER_GROUP_ITEM_REPOSITORY_ALIAS } from '../repository/index.js';
import { UMB_USER_GROUP_ENTITY_TYPE } from '../index.js';
import { UMB_CURRENT_USER_IS_ADMIN_CONDITION_ALIAS } from '@umbraco-cms/backoffice/current-user';

export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'entityAction',
		kind: 'delete',
		alias: 'Umb.EntityAction.UserGroup.Delete',
		name: 'Delete User Group Entity Action',
		forEntityTypes: [UMB_USER_GROUP_ENTITY_TYPE],
		meta: {
			detailRepositoryAlias: UMB_USER_GROUP_DETAIL_REPOSITORY_ALIAS,
			itemRepositoryAlias: UMB_USER_GROUP_ITEM_REPOSITORY_ALIAS,
		},
		conditions: [
			// Crombolo: only an administrator changes groups (story 302)
			{ alias: UMB_CURRENT_USER_IS_ADMIN_CONDITION_ALIAS },
		],
	},
];
