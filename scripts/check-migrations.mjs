import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
if (files.length === 0) throw new Error('No SQL migrations found');
const seen = new Set();
for (const file of files) {
  const prefix = file.split('_')[0];
  if (seen.has(prefix)) throw new Error(`Duplicate migration prefix: ${prefix}`);
  seen.add(prefix);
  const sql = await readFile(new URL(file, directory), 'utf8');
  if (!/begin;/i.test(sql) || !/commit;/i.test(sql))
    throw new Error(`${file} is not transactional`);
  if (/\b(float|real|double precision)\b/i.test(sql))
    throw new Error(`${file} uses floating point`);
}
console.log(`Validated ${files.length} ordered transactional migration(s).`);
