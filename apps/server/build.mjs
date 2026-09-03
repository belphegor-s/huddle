import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/*
 * One bundle, plus the migration files beside it.
 *
 * The migrations are read from disk at boot rather than compiled in, because
 * Drizzle's migrator takes a folder. Copying them next to the bundle means the
 * same relative path works from the repo, from a tarball and from the
 * container image, instead of each layout needing its own guess.
 */
await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(here, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Optional native accelerator for pg. Absent by design, and pg falls back.
  external: ['pg-native'],
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
});

const migrations = join(here, 'migrations');
rmSync(migrations, { recursive: true, force: true });
cpSync(join(here, '../../packages/db/migrations'), migrations, { recursive: true });

console.log('bundled dist/main.js and copied migrations');
