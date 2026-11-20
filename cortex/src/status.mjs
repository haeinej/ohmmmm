import { stat } from 'node:fs/promises';
import { join } from 'node:path';

// Remedies are commands the person can paste, even for paths with spaces or shell characters.
const shellWord = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// The person's view: report what needs attention, with a way to clear each item.
export async function cortexStatus(cortex) {
  const dir = shellWord(cortex.dir);
  // A missing or mistyped folder is not an empty cortex.
  const present = async path => stat(join(cortex.dir, path)).then(() => true, () => false);
  if (!(await present(join('agents', 'AGENTS.md'))) && !(await present('.cortex'))) {
    return [{ kind: 'problem', what: `There is no cortex at ${cortex.dir}: it has no agents/AGENTS.md and no .cortex/`, clear: `Check the path, or start one with cortex init ${dir}` }];
  }
  const state = await cortex.inspect();
  const items = [];
  const add = (kind, what, clear) => items.push({ kind, what, clear });
  for (const proposal of state.waiting.profile) add('profile-proposal', `${proposal.heading}: ${proposal.line} (from ${proposal.by})`, `cortex accept ${proposal.id} ${dir} or cortex decline ${proposal.id} ${dir}`);
  for (const name of state.waiting.skills) add('skill-proposal', name, `cortex approve ${shellWord(name)} ${dir}`);
  for (const name of state.waiting.tools) add('tool-proposal', name, `Build ${name} and add it to tools/, then delete .cortex/proposed/tools/${name}.md; or delete that proposal file.`);
  if (!state.profile.account) add('no-account', 'The profile names no account', `cortex account <did-or-handle> ${dir}`);
  for (const { observation, block } of state.vault.broken ?? []) add('broken-pointer', `${observation} is about missing block ${block}`, `Edit or delete observations/${observation}.md, or restore block ${block} in the vault.`);
  // Said once in what; clear says only what to do about it.
  const remedy = problem => {
    // While the vault cannot be reached, its only problem is that it cannot be reached.
    if (problem.startsWith('vault: ') && state.vault.reachable === false) return `Reconnect with cortex vault connect <folder> ${dir}`;
    if (/cannot be read/.test(problem)) return "Fix the file's permissions or contents";
    return 'Fix what the message names';
  };
  for (const problem of state.problems ?? []) add('problem', problem, remedy(problem));
  return items;
}
