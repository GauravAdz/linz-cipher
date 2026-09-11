import fs from 'node:fs';
import Papa from 'papaparse';

for (const [label, path] of [['CURRENT DATASET', 'data/raw/current.csv'], ['HISTORICAL DATASET', 'data/raw/historical.csv']] as const) {
  const text = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  console.log(`\n${label}\nrecords: ${result.data.length}\ncolumns:`);
  for (const field of result.meta.fields ?? []) console.log(`- ${field}`);
  if (result.errors.length) console.error(result.errors);
}
