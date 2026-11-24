import { copyFile, mkdir } from 'node:fs/promises';

// Keep the published package self-contained while using the vault's canonical readers.
const root = new URL('./', import.meta.url);
await mkdir(new URL('dist/astro/', root), { recursive: true });
await mkdir(new URL('dist/feed/', root), { recursive: true });
for (const file of ['index.mjs', 'index.d.mts']) {
  await copyFile(new URL(file, root), new URL(`dist/astro/${file}`, root));
}
for (const file of ['repository.mjs', 'standard.mjs', 'pds.mjs', 'forms.mjs', 'render.mjs']) {
  await copyFile(new URL(`../feed/${file}`, root), new URL(`dist/feed/${file}`, root));
}
