import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_MODS, pathToMod } from './pages.js';

describe('price list routes', () => {
  it('no longer treats price-lists as its own module', () => {
    assert.equal(KNOWN_MODS.has('price-lists'), false);
  });

  it('sends old /prices and /price-lists bookmarks to Edgar', () => {
    assert.equal(pathToMod('/prices'), 'edgar');
    assert.equal(pathToMod('/price-lists'), 'edgar');
  });
});
