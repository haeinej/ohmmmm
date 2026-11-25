#!/usr/bin/env node
// One entry point for every command, so they can be run from any folder:
//   npx github:haeinej/ohmmmm <command> [options]
const commands = {
  identity: ['identity.mjs', 'Show an identity and the repository it owns. Takes a handle or DID.'],
  configure: ['configure.mjs', 'Print a site configuration for --site and --handle or --did.'],
  import: ['import.mjs', 'Preview or bring the posts you have published into your vault. Add --save to put them there.'],
  lexicon: ['lexicon.mjs', 'Print a schema: --kind post for the post content inside a standard.site document, or postSite, profile, profileLink, profileSite for your own.'],
  mcp: ['mcp/server.mjs', "Serve the vault's tools to a coding agent over standard input and output."],
  migrate: ['migrate.mjs', 'Preview or copy posts from an older post type, com.ohmmmm.post included, to standard.site documents: --from com.example.post.'],
  posts: ['posts.mjs', 'List every public post with its form, label, and opening lines.'],
  profile: ['profile.mjs', 'Preview or save your profile: --name, --description, --pronouns, --avatar, --link.'],
  publish: ['publish.mjs', 'Preview or publish a post: --file, --slug, --title, --label, --media. Add --publish to save.'],
  site: ['site.mjs', 'Bring an existing website in: site scan --folder DIR, then site import --plan FILE [--apply], then site check.'],
  render: ['render.mjs', 'Rebuild one of your site\'s own pages from a post: render adopt, then render build.'],
  sync: ['sync.mjs', 'Say what syncing your folder with your vault would do: --folder PATH. Add --apply to sync. Never publishes.'],
  snapshot: ['snapshot.mjs', 'Print the feed snapshot the site Worker would store.'],
  vault: ['vault.mjs', 'Work with a vault folder on this machine: vault init, index, status, inspect REF, search WORDS, mcp. --vault DIR.'],
};
const [name] = process.argv.splice(2, 1);
if (!Object.hasOwn(commands, name ?? '')) {
  console.log('Usage: ohm <command> [options]\n');
  for (const [command, [, summary]] of Object.entries(commands)) console.log(`  ${command.padEnd(10)} ${summary}`);
  console.log('\nWrite flags: import --save; site import --apply; sync --apply; profile, publish and migrate --publish.');
  console.log('render adopt/build writes the named local template, sidecar or output files.');
  console.log('mcp serves tools with their own save and publication confirmation boundaries.');
  process.exitCode = name && !['help', '--help', '-h'].includes(name) ? 1 : 0;
} else {
  await import(new URL(commands[name][0].includes('/') ? `../${commands[name][0]}` : `../scripts/${commands[name][0]}`, import.meta.url));
}
