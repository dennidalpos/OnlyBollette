import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '../src-tauri/resources/runtime/ocr');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, '5.5.3');
assert.equal(manifest.vcpkgRevision, 'dc1232a6e05dcc49703091e83743e3b4df9b9b7c');
assert.equal(manifest.modelRevision, 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec');
assert.equal(manifest.files['tessdata/ita.traineddata'], '8df9c89176fb93f56bf4b2d4ede04c01c1f31d4b7697fbd76cc336df700f3f38');
for (const name of ['tesseract.exe', 'licenses/tesseract.txt', 'licenses/tessdata_best.txt', 'licenses/leptonica.txt']) {
  assert.ok(manifest.files[name], `Missing OCR resource: ${name}`);
}
const inventory = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== 'manifest.json')
  .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
assert.deepEqual(inventory, Object.keys(manifest.files).sort(), 'OCR resource inventory mismatch');
for (const [name, hash] of Object.entries(manifest.files)) {
  const path = resolve(root, name);
  assert.ok(!relative(root, path).startsWith('..'), 'Invalid OCR resource path');
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, `Invalid OCR resource: ${name}`);
}
const version = execFileSync(resolve(root, 'tesseract.exe'), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
assert.match(version, /tesseract 5\.5\.3/);
const languages = execFileSync(resolve(root, 'tesseract.exe'), ['--tessdata-dir', resolve(root, 'tessdata'), '--list-langs'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
assert.match(languages, /\bita\b/);
console.log('OCR bundle integrity, executable version and Italian model verified.');
