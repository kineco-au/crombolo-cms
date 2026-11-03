import { umbBlockAliasProblem } from './block-alias.function.js';
import { expect } from '@open-wc/testing';

describe('umbBlockAliasProblem', () => {
	it('takes no alias, and one in letters, digits, - and _', () => {
		expect(umbBlockAliasProblem('', ['hero'])).to.equal(undefined);
		expect(umbBlockAliasProblem('sourdough-2', ['hero'])).to.equal(undefined);
	});

	it('refuses one that does not start with a letter, or holds a space', () => {
		expect(umbBlockAliasProblem('2nd', [])).to.not.equal(undefined);
		expect(umbBlockAliasProblem('the hero', [])).to.not.equal(undefined);
	});

	it('refuses one another block in the list has, in any case', () => {
		expect(umbBlockAliasProblem('Hero', ['hero'])).to.equal('Another block here has this alias');
	});
});
