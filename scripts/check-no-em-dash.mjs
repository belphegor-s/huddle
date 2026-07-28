import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Enforced repo rule: no em dashes anywhere. See CLAUDE.md.
// Built from its code point so this file does not trip its own check.
const EM_DASH = String.fromCharCode(0x2014);

const SKIP = /^(pnpm-lock\.yaml|.*\.(woff2?|ttf|otf|png|jpg|jpeg|webp|avif|ico|gif|mp3|mp4|pdf))$/i;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !SKIP.test(f));

const hits = [];

for (const file of files) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes(EM_DASH)) continue;
  text.split('\n').forEach((line, i) => {
    if (line.includes(EM_DASH)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length > 0) {
  console.error(
    `Found ${hits.length} em dash(es). Replace with a comma, colon, parentheses, or full stop.\n`,
  );
  for (const hit of hits) console.error(hit);
  process.exit(1);
}

console.log('No em dashes found.');
