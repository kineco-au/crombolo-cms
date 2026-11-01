import { expect } from '@open-wc/testing';
import { customElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbControllerHostElementMixin } from '@umbraco-cms/backoffice/controller-api';
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry';
import { UmbExtensionCollectionRepository } from './extension-collection.repository.js';

@customElement('test-extension-collection-repository-host')
class UmbTestControllerHostElement extends UmbControllerHostElementMixin(HTMLElement) {}

const testExtensions = [
	{ type: 'bundle', alias: 'Test.Bundle.One', name: 'Bundle One', js: {} },
	{ type: 'dashboard', alias: 'Test.Dashboard.One', name: 'Dashboard One' },
];

describe('UmbExtensionCollectionRepository', () => {
	let hostElement: UmbTestControllerHostElement;
	let repository: UmbExtensionCollectionRepository;

	beforeEach(() => {
		hostElement = new UmbTestControllerHostElement();
		document.body.appendChild(hostElement);
		umbExtensionsRegistry.registerMany(testExtensions as any);
		repository = new UmbExtensionCollectionRepository(hostElement);
	});

	afterEach(() => {
		umbExtensionsRegistry.unregisterMany(testExtensions.map((ext) => ext.alias));
		document.body.innerHTML = '';
	});

	it('lists the extensions a bundle loads, not the bundle', async () => {
		const { data } = await repository.requestCollection({ filter: 'One' });
		const aliases = data.items.map((item) => item.unique);
		expect(aliases).to.include('Test.Dashboard.One');
		expect(aliases).to.not.include('Test.Bundle.One');
	});
});
