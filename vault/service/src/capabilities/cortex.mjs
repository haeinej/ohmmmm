// Cortex: the member's cortex (profile, observations, skills, tools), kept only as ciphertext sealed
// on their devices, beside the private layer and with the same rules (../private.mjs, kind "cortex").
// It is not part of the vault: the vault never reads it here, and nothing here is a vault block.
// A key rotation is the member's one rotation (the Private requests start and finish it); these
// requests list and re-wrap what the cortex holds below the target.
import { Refused } from '../store.mjs';

export default {
  name: 'Cortex',
  about: 'The cortex: what the member\'s agents know about them and can do, as files sealed on the member\'s devices. The service keeps and syncs them and cannot read them. Each is `{ id, ciphertext, version }` with an opaque ID; several change together or not at all; every version is kept; the journal of who changed what, and why, is sealed too. Agents reach the cortex through the member\'s device, never through the service.',
  requests: {
    'com.ohmmmm.cortex.listFiles': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every cortex file, by opaque ID, with its version, size and key generation. With `since`, only what changed after an earlier list, removals included. With `below`, only files wrapped by an older generation.',
      takes: { since: 'optional: the `cursor` of an earlier list', below: 'optional: a generation' },
      gives: '`blocks` (id, version, rev, generation, size), `cursor`, and `more` when there is another page',
      run: ({ url, cortexFiles, did }) => cortexFiles.list(did, { since: url.searchParams.get('since') ?? undefined, below: url.searchParams.get('below') ?? undefined }),
    },
    'com.ohmmmm.cortex.getFile': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One cortex file\'s ciphertext and version.',
      takes: { id: 'the file\'s opaque ID' },
      gives: '`id`, `ciphertext`, `version`, `rev`',
      run: ({ url, cortexFiles, did }) => cortexFiles.read(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.cortex.putFile': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Saves one cortex file\'s ciphertext, with compare-and-swap on its version. Readable text, or a file sealed under a key older than a rotation started, is refused. The journal entry says, sealed, who made the change and why.',
      takes: { file: '`id` and `ciphertext` (the sealed file)', replaces: 'optional: the version it replaces', journal: 'optional: a sealed journal entry' },
      gives: '`id`, `version`, `rev`, and `unchanged` when nothing differed',
      run: async ({ body, cortexFiles, did }) => {
        const { file, replaces = null, journal = null } = await body();
        return cortexFiles.write(did, file, { replaces, journal });
      },
    },
    'com.ohmmmm.cortex.putFiles': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Changes several cortex files together, all or none: each a write (`id`, `ciphertext`, `replaces`) or a removal (`id`, `remove: true`, `replaces`). `batchId` makes it safe to send again.',
      takes: { changes: 'the changes, 1 to 100', batchId: 'a key the device makes for this batch', journal: 'optional: a sealed journal entry' },
      gives: '`blocks` (id, version and rev, or removed), and `replayed` for a repeat',
      run: async ({ body, cortexFiles, did }) => {
        const { changes, batchId, journal = null } = await body();
        if (typeof batchId !== 'string') throw new Refused(400, 'InvalidRequest', 'Give the batch a batchId, so it is safe to send again');
        return cortexFiles.apply(did, changes, { batchId, journal });
      },
    },
    'com.ohmmmm.cortex.deleteFile': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one cortex file. Its kept versions stay, for restoring.',
      takes: { id: 'the file\'s opaque ID', replaces: 'the version being removed', journal: 'optional: a sealed journal entry' },
      gives: '`id`, `removed`',
      run: async ({ body, cortexFiles, did }) => {
        const { id, replaces = null, journal = null } = await body();
        return cortexFiles.remove(did, id, { replaces, journal });
      },
    },
    'com.ohmmmm.cortex.listVersions': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'A cortex file\'s kept versions, newest first, each by a `rev` that never changes.',
      takes: { id: 'the file\'s opaque ID' },
      gives: '`id`, `versions` (rev, version, generation, size, created)',
      run: ({ url, cortexFiles, did }) => cortexFiles.versions(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.cortex.getVersion': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One kept version of a cortex file, as ciphertext.',
      takes: { id: 'the file\'s opaque ID', rev: 'the version\'s rev' },
      gives: '`id`, `rev`, `version`, `ciphertext`',
      run: ({ url, cortexFiles, did }) => cortexFiles.readVersion(did, url.searchParams.get('id'), url.searchParams.get('rev')),
    },
    'com.ohmmmm.cortex.listJournal': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The cortex journal\'s sealed entries after `since`, oldest first: who changed what, and why, readable only on the member\'s devices.',
      takes: { since: 'optional: the `cursor` of an earlier list' },
      gives: '`entries` (seq, entry, created), `cursor`, and `more`',
      run: ({ url, cortexFiles, did }) => cortexFiles.journal(did, { since: url.searchParams.get('since') ?? undefined }),
    },
    'com.ohmmmm.cortex.listBelow': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'What the member\'s key rotation to `target` still has to re-wrap in the cortex: kept versions and journal entries.',
      takes: { target: 'the generation being rotated to' },
      gives: '`target`, `versions` (id, rev, generation), `journal` (seq, generation), and `more`',
      run: ({ url, cortexFiles, did }) => cortexFiles.belowTarget(did, url.searchParams.get('target')),
    },
    'com.ohmmmm.cortex.rewrap': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Re-wrapped copies of cortex versions and journal entries for the rotation under way. Each keeps exactly its contents; only the file key is re-wrapped. All are kept or none.',
      takes: { target: 'the generation being rotated to', versions: '(id, rev, ciphertext)', journal: '(seq, entry)' },
      gives: '`target`, `remaining` across the private layer and the cortex',
      run: async ({ body, cortexFiles, did }) => {
        const { target, versions = [], journal = [] } = await body();
        return cortexFiles.rewrap(did, target, { versions, journal });
      },
    },
  },
};
