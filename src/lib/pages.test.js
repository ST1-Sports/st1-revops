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

describe('removed social and ad hub routes', () => {
  it('no longer treats social or ad hub as their own modules', () => {
    assert.equal(KNOWN_MODS.has('social'), false);
    assert.equal(KNOWN_MODS.has('cc-ad-hub'), false);
  });

  it('sends old social and ad hub bookmarks to Home', () => {
    assert.equal(pathToMod('/social'), 'briefing');
    assert.equal(pathToMod('/cc-ad-hub'), 'briefing');
    assert.equal(pathToMod('/cc-social'), 'briefing');
    assert.equal(pathToMod('/cc-image'), 'briefing');
  });

  it('sends /command-center to the remaining sales-copy tools panel', () => {
    assert.equal(pathToMod('/command-center'), 'cc-sales-copy');
    assert.equal(KNOWN_MODS.has('cc-sales-copy'), true);
  });
});
