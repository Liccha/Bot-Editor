const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('the website resolves a tiny release pointer instead of polling the mutable full library', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'assets', 'js', 'library.js'), 'utf8');

  assert.match(index, /SONG_LIBRARY_RELEASE_POINTER_URL/,
    'index.html must publish the compact release pointer URL');
  assert.doesNotMatch(index, /SONG_LIBRARY_PRIMARY_DATA_URL="https:\/\/assets\.teacharm\.moe\/data\/songs\.json"/,
    'the 800KB mutable index must not be the primary bootstrap URL');
  assert.match(index, /library\.js\?v=20260829-release-pointer-cache/,
    'the deployment must invalidate the old loader cache');
  assert.ok(library.includes('data\\/releases\\/songs-[a-f0-9]{16}'),
    'the loader must validate and consume a content-addressed release');
  assert.match(library, /'force-cache'/,
    'immutable releases must use the browser HTTP cache');
});
