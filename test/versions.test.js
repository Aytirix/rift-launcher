'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyserVersion, comparerVersions, depotDe } = require('../src/main/versions');

test('analyserVersion garde le premier groupe de chiffres', () => {
  assert.deepEqual(analyserVersion('v0.3.1'), [0, 3, 1, 0]);
  assert.deepEqual(analyserVersion('build-45'), [45, 0, 0, 0]);
  assert.deepEqual(analyserVersion('0.4.0-beta'), [0, 4, 0, 0]);
  assert.deepEqual(analyserVersion('sans chiffre'), [0, 0, 0, 0]);
});

test('une version courte vaut la même version complétée de zéros (pas de mise à jour fantôme)', () => {
  // La version PowerShell annonçait « v0.3.0 » plus récente que « 0.3 » installée.
  assert.equal(comparerVersions('v0.3.0', '0.3'), 0);
  assert.equal(comparerVersions('1.2', '1.2.0.0'), 0);
});

test('comparerVersions ordonne par composant, pas par texte', () => {
  assert.equal(comparerVersions('0.10.0', '0.9.9'), 1);
  assert.equal(comparerVersions('v1.71', '1.7.1'), 1);
  assert.equal(comparerVersions('1.0.0', '1.0.1'), -1);
});

test('depotDe reconnaît un dépôt GitHub et rien d’autre', () => {
  assert.equal(depotDe('https://github.com/valentderah/totk-pc-recomp'), 'valentderah/totk-pc-recomp');
  assert.equal(depotDe('https://github.com/a/b.git'), 'a/b');
  assert.equal(depotDe('https://github.com/a/b/releases/tag/v1'), 'a/b');
  assert.equal(depotDe('http://github.com/a/b'), null);
  assert.equal(depotDe('https://gitlab.com/a/b'), null);
  assert.equal(depotDe(''), null);
});
