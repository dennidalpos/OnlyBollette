import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, '.scratch');
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(resolve(scratch, 'layout-check-'));
let vite;
let failure;
try {
  const fixture = resolve(directory, 'synthetic-layout.png');
  execFileSync('pwsh', [
    '-NoProfile',
    '-File',
    resolve(root, 'scripts/create-document-fixture.ps1'),
    '-OutputPath',
    fixture,
  ]);
  // In-memory synthetic OCR (no print/save).
  const output = execFileSync(
    resolve(process.env.USERPROFILE, '.cargo/bin/cargo.exe'),
    [
      'run',
      '--quiet',
      '--manifest-path',
      resolve(root, 'src-tauri/Cargo.toml'),
      '--example',
      'verify-document',
      '--',
      fixture,
      'Recesso',
      '--json',
    ],
    {
      encoding: 'utf8',
      timeout: 180000,
      windowsHide: true,
      env: { ...process.env, ONLYBOLLETTE_DATA_DIR: directory },
    },
  );
  const document = JSON.parse(output);
  assert.equal(document.pages.length, 1);
  assert.ok(document.pages[0].lines.length >= 4);
  assert.ok(
    document.pages[0].lines.every((line) =>
      line.words.every((word) => word.width > 0 && word.height > 0),
    ),
  );
  assert.ok(document.pages[0].text.includes('\n'));
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const { parseDocument, compareDocuments } = await vite.ssrLoadModule(
    '/src/comparisonDocuments.ts',
  );
  const { parameterKeys } = await vite.ssrLoadModule('/src/electricity.ts');
  const parsed = parseDocument('luce', 'current', document);
  assert.ok(
    parsed.clauses.some((clause) => /Recesso con preavviso di trenta giorni/i.test(clause.text)),
  );
  assert.ok(parsed.clauses.every((clause) => !/Importo|storico|estranee/i.test(clause.text)));
  assert.ok(
    parsed.clauses.every(
      (clause) => clause.document === 'synthetic-layout.png' && clause.page === 1,
    ),
  );
  assert.equal(parsed.fields.unitCurrent?.value, '1,123456');
  assert.equal(parsed.fields.fixedCurrent?.value, '120');
  assert.equal(parsed.fields.dispatchUnitCurrent?.value, '0,015');
  assert.equal(parsed.fields.commercialAnnualCurrent?.value, '6');
  assert.equal(parsed.fields.lossesCurrent?.value, 'escluse');
  assert.equal(parsed.fields.lossPercentCurrent?.value, '10');
  assert.equal(parsed.fields.annualCurrent, undefined);
  assert.equal(parsed.fields.unitCurrent?.period, '01/01/2026 - 31/01/2026');
  assert.equal(parsed.fields.validCurrent?.value, '31/12/2025');
  assert.equal(parsed.fields.applicableFromCurrent?.value, '01/01/2026');
  assert.equal(parsed.fields.applicableUntilCurrent?.value, '31/12/2099');
  assert.ok(
    parsed.clauses.some(
      (clause) => clause.kind === 'continuation' && clause.text.includes('comunicazione'),
    ),
  );
  for (const [key, value] of Object.entries({
    usageCurrent: '3.120',
    residentCurrent: 'non residente',
    powerCurrent: '4,5',
    tariffCurrent: 'Monoraria',
  })) {
    assert.deepEqual(
      parsed.fields[key],
      { value, document: 'synthetic-layout.png', page: 1, confirmed: false },
      `Profile field ${key}`,
    );
  }
  assert.deepEqual(await readdir(directory), ['synthetic-layout.png']);
  const quote = parseDocument('luce', 'quote', document);
  const fields = Object.fromEntries(
    Object.entries({ ...parsed.fields, ...quote.fields }).map(([key, value]) => [
      key,
      { ...value, confirmed: true },
    ]),
  );
  const now = new Date();
  const parameters = {
    sourceUrl: 'https://example.org/synthetic.csv',
    fetchedAt: now.toISOString(),
    publishedOn: `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`,
    values: { ...Object.fromEntries(parameterKeys.map((key) => [key, 0])), iva_c: 0.1 },
  };
  const result = compareDocuments('luce', fields, true, true, parameters);
  assert.equal(result.status, 'comparable');
  assert.equal(result.difference, 0);
  assert.ok(
    Math.abs(result.current - (3120 * 1.123456 * 1.1 + 120 + 3120 * 0.015 + 6) * 1.1) < 0.000001,
  );
  delete fields.applicableUntilCurrent;
  assert.equal(compareDocuments('luce', fields, true, true, parameters).difference, null);
  const blocksPath = resolve(directory, 'synthetic-blocks.png');
  execFileSync('pwsh', [
    '-NoProfile',
    '-File',
    resolve(root, 'scripts/create-document-fixture.ps1'),
    '-OutputPath',
    blocksPath,
    '-ComponentBlocks',
  ]);
  const blocks = JSON.parse(
    execFileSync(
      resolve(process.env.USERPROFILE, '.cargo/bin/cargo.exe'),
      [
        'run',
        '--quiet',
        '--manifest-path',
        resolve(root, 'src-tauri/Cargo.toml'),
        '--example',
        'verify-document',
        '--',
        blocksPath,
        'Corrispettivo',
        '--json',
      ],
      {
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
        env: { ...process.env, ONLYBOLLETTE_DATA_DIR: directory },
      },
    ),
  );
  const blockFields = parseDocument('luce', 'current', blocks).fields;
  assert.equal(blockFields.unitCurrent?.value, '0,14567890');
  assert.equal(blockFields.fixedCurrent?.value, '109,48148136');
  assert.equal(blockFields.dispatchUnitCurrent?.value, '0,02345678');
  assert.equal(blockFields.commercialAnnualCurrent, undefined);
  assert.equal(blockFields.commercialModeCurrent, undefined);
  assert.equal(blockFields.lossPercentCurrent, undefined);
  assert.equal(blockFields.lossesCurrent, undefined);
  assert.equal(
    blockFields.unitCurrent?.period,
    'DAL 01/05/2026 AL 31/05/2026; DAL 01/06/2026 AL 30/06/2026',
  );
  assert.equal(blockFields.unitCurrent?.confirmed, false);
  assert.equal(blockFields.unitCurrent?.document, 'synthetic-blocks.png');
  assert.equal(blockFields.unitCurrent?.page, 1);
  assert.equal(compareDocuments('luce', blockFields, true, true, parameters).difference, null);
  assert.deepEqual((await readdir(directory)).sort(), [
    'synthetic-blocks.png',
    'synthetic-layout.png',
  ]);
  const missingPath = resolve(directory, 'synthetic-missing-unit.png');
  execFileSync('pwsh', ['-NoProfile', '-File', resolve(root, 'scripts/create-document-fixture.ps1'),
    '-OutputPath', missingPath, '-ComponentBlocks', '-MissingEnergyUnit']);
  const missing = JSON.parse(execFileSync(resolve(root, 'src-tauri/target/debug/examples/verify-document.exe'),
    [missingPath, 'Corrispettivo', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 180000 }));
  const missingResult = parseDocument('luce', 'current', missing);
  assert.equal(missingResult.fields.unitCurrent, undefined);
  assert.ok(missingResult.conflicts.includes('unitCurrent'));
  const validityPath = resolve(directory, 'synthetic-validity.png');
  execFileSync('pwsh', ['-NoProfile', '-File', resolve(root, 'scripts/create-document-fixture.ps1'),
    '-OutputPath', validityPath, '-ValidityRange']);
  const validity = JSON.parse(execFileSync(resolve(root, 'src-tauri/target/debug/examples/verify-document.exe'),
    [validityPath, 'Validità', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 180000 }));
  const validityResult = parseDocument('luce', 'current', validity);
  assert.deepEqual(validityResult.fields.validCurrent, {
    value: '31/12/2025', document: 'synthetic-validity.png', page: 1, confirmed: false,
  });
  assert.equal(validityResult.fields.applicableFromCurrent, undefined);
  assert.equal(validityResult.fields.applicableUntilCurrent, undefined);
  console.log(
    'Native OCR and frontend comparison passed; layout, profile, row tables, repeated component blocks, printed validity, provenance and session-only data verified.',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    if (vite) await vite.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    assert.equal(dirname(directory), scratch);
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (failure) console.error('Synthetic fixture cleanup also failed:', error);
    else failure = error;
  }
}
if (failure) throw failure;
