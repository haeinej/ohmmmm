// The sealed stores (the private layer's, and the cortex's): private blocks or cortex files as `{ id, ciphertext, version }`, which the service
// keeps and cannot read (plans/encryption.md, "The two stores").
//
// - `id` is opaque: chosen on the member's device, it says nothing about the block. Its path, title,
//   channels and text are all inside the ciphertext.
// - `ciphertext` is a sealed file as ohm-onboarding's packages/keys makes it: `{ v, alg, generation?,
//   key: { iv, ciphertext }, data: { iv, ciphertext } }`, every value base64url. The service checks
//   that shape and nothing else, so readable text sent by mistake is refused rather than kept.
// - `version` is computed over the ciphertext, and every write and removal names the version it
//   replaces, checked in the same statement that makes the change. Two devices never overwrite each
//   other unseen, and the service needs to read nothing to say which write is stale.
//
// - Several files change together or not at all (`apply`, one D1 batch): moving a block between
//   channels changes the block and two channel files, and an interruption must never leave it in
//   neither channel or in both. Each change names the version it replaces; one mismatch refuses all.
// - Every version is kept, as ciphertext, under a `rev` that never changes (`private_block_versions`),
//   so a device can restore any of them. A change may carry a journal entry, sealed the same way and
//   kept in the same batch (`private_journal`): titles, changed words and who changed what are inside.
// - A key rotation re-wraps every stored version and journal entry, not only the latest, so a key
//   that was exposed opens nothing still kept. The service checks that a re-wrap changes only the
//   wrapped file key, never the contents.
//
// The member's keys are not here: they are on the member's devices, and the account app keeps only
// wrapped copies. `db` has the shape of a Cloudflare D1 database.
import { Refused } from './store.mjs';

const PAGE = 1000;
// The most files one batch changes, and one re-wrap request re-wraps.
const MOST = 100;
// A block can be 600 KB of text; sealed and written as base64url it is a third larger, with room.
const LARGEST = 1_000_000;
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

const encoder = new TextEncoder();
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

// A version names exactly one ciphertext.
export async function privateVersion(ciphertext) {
  return `pv_${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ciphertext)))).slice(0, 32)}`;
}

const refuse = message => { throw new Refused(400, 'InvalidBlock', message); };
const opaqueId = id => (typeof id === 'string' && ID.test(id) ? id : refuse('A private block is named by an opaque ID: 16 to 64 letters, digits, - or _'));

const sealedPart = (part, name) => {
  if (!part || typeof part !== 'object' || Array.isArray(part)) refuse(`${name} is { iv, ciphertext }`);
  const { iv, ciphertext, ...more } = part;
  if (Object.keys(more).length) refuse(`${name} has only iv and ciphertext`);
  if (typeof iv !== 'string' || iv.length !== 16 || !B64URL.test(iv)) refuse(`${name}.iv is a 12-byte nonce in base64url`);
  if (typeof ciphertext !== 'string' || ciphertext.length < 22 || !B64URL.test(ciphertext)) refuse(`${name}.ciphertext is base64url, with its tag`);
};

// A sealed file, checked for shape only, and kept as the exact text it was sent as.
export function sealedFile(ciphertext, what = 'A private block') {
  if (!ciphertext || typeof ciphertext !== 'object' || Array.isArray(ciphertext)) refuse('ciphertext is the sealed file, as an object');
  const { v, alg, generation = 1, key, data, ...extra } = ciphertext;
  if (Object.keys(extra).length) refuse(`A sealed file has v, alg, generation, key and data, and nothing else: ${Object.keys(extra).join(', ')}. Private text is never sent readable`);
  if (v !== 1 || alg !== 'A256GCM') refuse('A sealed file is { v: 1, alg: "A256GCM" }');
  if (!Number.isSafeInteger(generation) || generation < 1) refuse('generation is a whole number from 1');
  sealedPart(key, 'key');
  if (key.ciphertext.length !== 64) refuse('key.ciphertext is a wrapped 32-byte file key and its tag');
  sealedPart(data, 'data');
  const text = JSON.stringify({ v, alg, ...(generation === 1 ? {} : { generation }), key: { iv: key.iv, ciphertext: key.ciphertext }, data: { iv: data.iv, ciphertext: data.ciphertext } });
  if (encoder.encode(text).length > LARGEST) throw new Refused(413, 'TooLarge', `${what} can be at most 1 MB sealed`);
  return { text, generation, data: `${data.iv}.${data.ciphertext}` };
}

// The sealed file of a block, by its opaque ID.
export function sealedBlock(given, noun = 'private block') {
  const { id, ciphertext, ...more } = given ?? {};
  if (Object.keys(more).length) refuse(`A ${noun} is sent as id and ciphertext, and nothing else: ${Object.keys(more).join(', ')}`);
  opaqueId(id);
  const { text, generation } = sealedFile(ciphertext);
  return { id, text, generation };
}

// The sealed stores: the private layer's blocks, and the cortex's files. Each has its own tables
// and the same rules. They share the member's master key, so one key rotation covers both.
export const SEALED = {
  private: { blocks: 'private_blocks', versions: 'private_block_versions', journal: 'private_journal', batches: 'private_batches', noun: 'private block' },
  cortex: { blocks: 'cortex_files', versions: 'cortex_file_versions', journal: 'cortex_journal', batches: 'cortex_batches', noun: 'cortex file' },
};

export function privateStore(db, { kind = 'private' } = {}) {
  const T = SEALED[kind];
  if (!T) throw new Error(`No sealed store called ${kind}`);
  const current = (did, id) => db.prepare(`SELECT version, ciphertext, generation, seq, rev FROM ${T.blocks} WHERE did = ?1 AND id = ?2`).bind(did, id).first();
  const next = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM ${T.blocks} WHERE did = ?1)`;
  const changed = (id, held) => new Refused(409, 'Changed', `The ${T.noun} has changed since the version this request names`, { id, current: held?.version ?? null });
  const row = held => ({ ciphertext: JSON.parse(held.ciphertext), version: held.version, rev: held.rev });
  const rotationOf = did => db.prepare('SELECT target, state, started_at, finished_at FROM private_rotations WHERE did = ?1').bind(did).first();
  const olderKey = (id, floor) => new Refused(409, 'OlderKey', `This is sealed with an older master key than ${floor.target}, which the member ${floor.state === 'rotating' ? 'is rotating to' : 'rotated to'}. Unlock again, and seal it with the newer key`, { ...(id ? { id } : {}), target: floor.target });
  // What a rotation to `target` still has to re-wrap: kept versions (the latest of each block among
  // them) and journal entries sealed under an older key.
  // Counted across every sealed store, since they share the master key.
  const below = async (did, target) => {
    let count = 0;
    for (const each of Object.values(SEALED)) {
      count += Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${each.versions} WHERE did = ?1 AND generation < ?2`).bind(did, target).first()).count);
      count += Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${each.journal} WHERE did = ?1 AND generation < ?2`).bind(did, target).first()).count);
    }
    return count;
  };
  const generationOf = value => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 2) throw new Refused(400, 'InvalidRequest', 'A rotation is to a generation, a whole number from 2');
    return number;
  };
  const cursorOf = (value, name = 'since') => {
    const after = value === undefined || value === null ? 0 : Number(value);
    if (!Number.isSafeInteger(after) || after < 0) throw new Refused(400, 'InvalidCursor', `${name} is a value an earlier list returned`);
    return after;
  };
  // A statement that fails the batch it is in when `violated` (SQL) holds: it inserts a row the guard
  // table's CHECK refuses. When the condition does not hold it inserts nothing.
  const guard = (violated, ...values) => db.prepare(`INSERT INTO private_guard (ok) SELECT 0 WHERE ${violated}`).bind(...values);
  const floorViolated = (generationParam) => `EXISTS (SELECT 1 FROM private_rotations WHERE did = ?1 AND target > ${generationParam})`;
  const runBatch = async statements => {
    try {
      await db.batch(statements);
      return true;
    } catch (problem) {
      if (/CHECK constraint failed/i.test(String(problem?.message))) return false;
      throw problem;
    }
  };

  // Several changes to private blocks, all made or none: each `{ id, ciphertext, replaces }` (a write)
  // or `{ id, remove: true, replaces }`, with an optional sealed journal entry describing them.
  // `batchId` makes the batch idempotent: sent again, it answers what it answered the first time.
  async function apply(did, given, { batchId = null, journal = null, now = new Date() } = {}) {
    if (!Array.isArray(given) || !given.length || given.length > MOST) throw new Refused(400, 'InvalidRequest', `A batch changes 1 to ${MOST} ${T.noun}s`);
    if (batchId !== null && (typeof batchId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(batchId))) throw new Refused(400, 'InvalidRequest', 'batchId is 8 to 128 letters, digits and . _ : -');
    if (batchId !== null) {
      const done = await db.prepare(`SELECT result FROM ${T.batches} WHERE did = ?1 AND batch_id = ?2`).bind(did, batchId).first();
      if (done) return { ...JSON.parse(done.result), replayed: true };
    }
    const changes = [];
    for (const change of given) {
      const { replaces = null, remove = false, ...rest } = change ?? {};
      if (replaces !== null && typeof replaces !== 'string') throw new Refused(400, 'InvalidRequest', 'replaces is a version, or null for a new block');
      if (remove === true) {
        if (Object.keys(rest).some(key => key !== 'id')) refuse('A removal is { id, remove: true, replaces }');
        changes.push({ id: opaqueId(rest.id), remove: true, replaces });
      } else {
        const { id, text, generation } = sealedBlock(rest, T.noun);
        changes.push({ id, text, generation, replaces, version: await privateVersion(text) });
      }
    }
    if (new Set(changes.map(change => change.id)).size !== changes.length) throw new Refused(400, 'InvalidRequest', 'A batch changes each block once');
    const entry = journal === null ? null : sealedFile(journal, 'A journal entry');
    const at = now.toISOString();
    const statements = [];
    for (const change of changes) {
      // The version it replaces is the one held (a removed block's is null, as a new one's).
      statements.push(guard(`(SELECT version FROM ${T.blocks} WHERE did = ?1 AND id = ?2) IS NOT ?3`, did, change.id, change.replaces));
      if (change.remove) {
        statements.push(db.prepare(`UPDATE ${T.blocks} SET version = NULL, ciphertext = NULL, generation = NULL, size = NULL, seq = ${next}, updated_at = ?3 WHERE did = ?1 AND id = ?2`).bind(did, change.id, at));
        continue;
      }
      statements.push(guard(floorViolated('?2'), did, change.generation));
      statements.push(db.prepare(
        `INSERT INTO ${T.blocks} (did, id, version, ciphertext, generation, size, seq, rev, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${next}, ${next}, ?7, ?7)
         ON CONFLICT (did, id) DO UPDATE SET version = excluded.version, ciphertext = excluded.ciphertext, generation = excluded.generation,
           size = excluded.size, seq = excluded.seq, rev = excluded.rev, updated_at = excluded.updated_at`,
      ).bind(did, change.id, change.version, change.text, change.generation, encoder.encode(change.text).length, at));
      statements.push(db.prepare(
        `INSERT INTO ${T.versions} (did, id, rev, version, ciphertext, generation, size, created_at)
         SELECT did, id, rev, version, ciphertext, generation, size, updated_at FROM ${T.blocks} WHERE did = ?1 AND id = ?2`,
      ).bind(did, change.id));
    }
    if (entry) {
      statements.push(guard(floorViolated('?2'), did, entry.generation));
      statements.push(db.prepare(`INSERT INTO ${T.journal} (did, seq, entry, generation, created_at) VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM ${T.journal} WHERE did = ?1), ?2, ?3, ?4)`)
        .bind(did, entry.text, entry.generation, at));
    }
    const result = { blocks: changes.map(change => (change.remove ? { id: change.id, removed: true } : { id: change.id, version: change.version })) };
    if (batchId !== null) statements.push(db.prepare(`INSERT INTO ${T.batches} (did, batch_id, result, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(did, batchId, JSON.stringify(result), at));
    if (await runBatch(statements)) {
      const revs = await Promise.all(changes.filter(change => !change.remove).map(async change => [change.id, (await current(did, change.id)).rev]));
      const byId = Object.fromEntries(revs);
      return { blocks: result.blocks.map(each => (each.removed ? each : { ...each, rev: byId[each.id] })) };
    }
    // Refused: say which change, and why, as precisely as the single-file requests do.
    const floor = await rotationOf(did);
    for (const change of changes) {
      const held = await current(did, change.id);
      if ((held?.version ?? null) !== change.replaces) throw changed(change.id, held);
      if (!change.remove && floor && floor.target > change.generation) throw olderKey(change.id, floor);
    }
    if (entry && floor && floor.target > entry.generation) throw olderKey(null, floor);
    throw new Refused(409, 'Changed', `The ${T.noun}s changed while this batch was being applied. Read them again`);
  }

  return {
    // Every private block, or with `since`, what changed after that point, removals included. Only
    // IDs, versions, revs, sizes and generations: what the service can know without reading anything.
    async list(did, { since, below } = {}) {
      const after = cursorOf(since);
      const under = below === undefined ? null : Number(below);
      if (under !== null && (!Number.isSafeInteger(under) || under < 1)) throw new Refused(400, 'InvalidRequest', 'below is a generation, a whole number from 1');
      const { results } = await db.prepare(
        `SELECT id, version, generation, size, seq, rev FROM ${T.blocks}
         WHERE did = ?1 AND seq > ?2 ${since === undefined ? 'AND version IS NOT NULL' : ''} ${under === null ? '' : 'AND (version IS NULL OR generation < ?3)'}
         ORDER BY seq LIMIT ${PAGE + 1}`,
      ).bind(did, after, under).all();
      const page = results.slice(0, PAGE);
      const latest = page.length ? page.at(-1).seq
        : since !== undefined ? after
        : (await db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM ${T.blocks} WHERE did = ?1`).bind(did).first()).seq;
      return {
        blocks: page.map(each => (each.version === null ? { id: each.id, removed: true } : { id: each.id, version: each.version, rev: each.rev, generation: each.generation, size: each.size })),
        cursor: String(latest),
        ...(results.length > PAGE ? { more: true } : {}),
      };
    },

    async read(did, id) {
      const held = await current(did, opaqueId(id));
      if (!held || held.version === null) throw new Refused(404, 'NotFound', `There is no such ${T.noun}`);
      return { id, ...row(held) };
    },

    // One change, with compare-and-swap: `replaces` is the version being replaced, and nothing for a
    // new block. The same ciphertext again changes nothing.
    async write(did, given, { replaces = null, journal = null, now = new Date() } = {}) {
      const { id, text } = sealedBlock(given, T.noun);
      const version = await privateVersion(text);
      const held = await current(did, id);
      if (held?.version === version) return { id, version, rev: held.rev, unchanged: true };
      const [done] = (await apply(did, [{ ...given, replaces }], { journal, now })).blocks;
      return done;
    },

    async remove(did, id, { replaces = null, journal = null, now = new Date() } = {}) {
      const held = await current(did, opaqueId(id));
      if (!held || held.version === null) return { id, removed: true, unchanged: true };
      return (await apply(did, [{ id, remove: true, replaces }], { journal, now })).blocks[0];
    },

    apply,

    // ---- Versions and the journal ----

    // A block's kept versions, newest first: each by its `rev`, which never changes.
    async versions(did, id) {
      const { results } = await db.prepare(`SELECT rev, version, generation, size, created_at FROM ${T.versions} WHERE did = ?1 AND id = ?2 ORDER BY rev DESC LIMIT 1000`)
        .bind(did, opaqueId(id)).all();
      return { id, versions: results.map(each => ({ rev: each.rev, version: each.version, generation: each.generation, size: each.size, created: each.created_at })) };
    },

    async readVersion(did, id, rev) {
      const at = Number(rev);
      if (!Number.isSafeInteger(at) || at < 1) throw new Refused(400, 'InvalidRequest', 'rev is a version\'s rev, from its block\'s versions');
      const held = await db.prepare(`SELECT rev, version, ciphertext FROM ${T.versions} WHERE did = ?1 AND id = ?2 AND rev = ?3`).bind(did, opaqueId(id), at).first();
      if (!held) throw new Refused(404, 'NotFound', 'There is no such version');
      return { id, rev: held.rev, version: held.version, ciphertext: JSON.parse(held.ciphertext) };
    },

    // The journal's sealed entries after `since`, oldest first.
    async journal(did, { since } = {}) {
      const after = cursorOf(since);
      const { results } = await db.prepare(`SELECT seq, entry, generation, created_at FROM ${T.journal} WHERE did = ?1 AND seq > ?2 ORDER BY seq LIMIT ${PAGE + 1}`).bind(did, after).all();
      const page = results.slice(0, PAGE);
      return {
        entries: page.map(each => ({ seq: each.seq, entry: JSON.parse(each.entry), created: each.created_at })),
        cursor: String(page.at(-1)?.seq ?? after),
        ...(results.length > PAGE ? { more: true } : {}),
      };
    },

    // ---- Key rotation ----
    //
    // The re-wrap itself happens on the member's device; the service never holds a readable key. What
    // it keeps is the floor, so the rotation cannot be undermined by a device still on the old key;
    // the list of what is still below it, every kept version and journal entry included; and the
    // check that nothing is left.

    // Starts (or, for the same target, confirms) a rotation to `target`. From now on, writes sealed
    // under an older generation are refused.
    async beginRotation(did, target, { now = new Date() } = {}) {
      const to = generationOf(target);
      const started = await db.prepare(
        `INSERT INTO private_rotations (did, target, state, started_at) VALUES (?1, ?2, 'rotating', ?3)
         ON CONFLICT (did) DO UPDATE SET target = excluded.target, state = 'rotating', started_at = excluded.started_at, finished_at = NULL
         WHERE private_rotations.target < excluded.target
         RETURNING target`,
      ).bind(did, to, now.toISOString()).first();
      const held = await rotationOf(did);
      if (!started && held.target > to) throw new Refused(409, 'RotationAhead', `The member already rotated to ${held.target}`, { target: held.target });
      return { target: to, state: held.state, remaining: await below(did, to), ...(started ? {} : { unchanged: true }) };
    },

    async rotation(did) {
      const held = await rotationOf(did);
      return { rotation: held ? { target: held.target, state: held.state, remaining: await below(did, held.target), started: held.started_at, ...(held.finished_at ? { finished: held.finished_at } : {}) } : null };
    },

    // What a rotation to `target` still has to re-wrap: versions by block and rev, journal entries by seq.
    async belowTarget(did, target) {
      const to = generationOf(target);
      const { results: versions } = await db.prepare(`SELECT id, rev, generation FROM ${T.versions} WHERE did = ?1 AND generation < ?2 ORDER BY rev LIMIT ${PAGE + 1}`).bind(did, to).all();
      const { results: journal } = await db.prepare(`SELECT seq, generation FROM ${T.journal} WHERE did = ?1 AND generation < ?2 ORDER BY seq LIMIT ${PAGE + 1}`).bind(did, to).all();
      return {
        target: to,
        versions: versions.slice(0, PAGE).map(each => ({ id: each.id, rev: each.rev, generation: each.generation })),
        journal: journal.slice(0, PAGE).map(each => ({ seq: each.seq, generation: each.generation })),
        ...(versions.length > PAGE || journal.length > PAGE ? { more: true } : {}),
      };
    },

    // Re-wrapped copies of kept versions and journal entries, for a rotation under way to `target`.
    // Each must hold exactly the contents it replaces (the same `data`), with only the file key
    // re-wrapped under `target`; a version that is its block's latest moves the block along with it.
    // All are kept or none.
    async rewrap(did, target, { versions = [], journal = [] } = {}, { now = new Date() } = {}) {
      const to = generationOf(target);
      if (!Array.isArray(versions) || !Array.isArray(journal) || versions.length + journal.length < 1 || versions.length + journal.length > MOST) {
        throw new Refused(400, 'InvalidRequest', `A re-wrap takes 1 to ${MOST} versions and journal entries`);
      }
      const floor = await rotationOf(did);
      if (!floor || floor.target !== to || floor.state !== 'rotating') throw new Refused(409, 'NoRotation', `No rotation to ${to} is under way`);
      const at = now.toISOString();
      const statements = [];
      const sameContents = (held, sealed, what) => {
        if (sealedFile(JSON.parse(held)).data !== sealed.data) refuse(`${what} must keep exactly the contents it replaces; only its file key is re-wrapped`);
        if (sealed.generation !== to) refuse(`${what} must be re-wrapped under ${to}`);
      };
      for (const given of versions) {
        const id = opaqueId(given?.id);
        const rev = Number(given?.rev);
        const held = await db.prepare(`SELECT version, ciphertext, generation FROM ${T.versions} WHERE did = ?1 AND id = ?2 AND rev = ?3`).bind(did, id, rev).first();
        if (!held) throw new Refused(404, 'NotFound', `There is no version ${given?.rev} of ${id}`);
        if (held.generation >= to) continue;
        const sealed = sealedFile(given.ciphertext);
        sameContents(held.ciphertext, sealed, `Version ${rev} of ${id}`);
        const version = await privateVersion(sealed.text);
        const size = encoder.encode(sealed.text).length;
        statements.push(guard(`(SELECT version FROM ${T.versions} WHERE did = ?1 AND id = ?2 AND rev = ?3) IS NOT ?4`, did, id, rev, held.version));
        statements.push(db.prepare(`UPDATE ${T.versions} SET version = ?4, ciphertext = ?5, generation = ?6, size = ?7 WHERE did = ?1 AND id = ?2 AND rev = ?3`)
          .bind(did, id, rev, version, sealed.text, sealed.generation, size));
        statements.push(db.prepare(`UPDATE ${T.blocks} SET version = ?4, ciphertext = ?5, generation = ?6, size = ?7, seq = ${next}, updated_at = ?8 WHERE did = ?1 AND id = ?2 AND rev = ?3 AND version IS NOT NULL`)
          .bind(did, id, rev, version, sealed.text, sealed.generation, size, at));
      }
      for (const given of journal) {
        const seq = Number(given?.seq);
        const held = await db.prepare(`SELECT entry, generation FROM ${T.journal} WHERE did = ?1 AND seq = ?2`).bind(did, seq).first();
        if (!held) throw new Refused(404, 'NotFound', `There is no journal entry ${given?.seq}`);
        if (held.generation >= to) continue;
        const sealed = sealedFile(given.entry, 'A journal entry');
        sameContents(held.entry, sealed, `Journal entry ${seq}`);
        statements.push(guard(`(SELECT entry FROM ${T.journal} WHERE did = ?1 AND seq = ?2) IS NOT ?3`, did, seq, held.entry));
        statements.push(db.prepare(`UPDATE ${T.journal} SET entry = ?3, generation = ?4 WHERE did = ?1 AND seq = ?2`).bind(did, seq, sealed.text, sealed.generation));
      }
      if (statements.length && !(await runBatch(statements))) throw new Refused(409, 'Changed', 'Something being re-wrapped changed meanwhile. List what is below the target again');
      return { target: to, remaining: await below(did, to) };
    },

    // Finishes the rotation only if no kept version or journal entry is below the target, checked in
    // the same statement that marks it finished.
    async finishRotation(did, target, { now = new Date() } = {}) {
      const to = generationOf(target);
      const finished = await db.prepare(
        `UPDATE private_rotations SET state = 'finished', finished_at = ?3
         WHERE did = ?1 AND target = ?2 AND state = 'rotating'
           ${Object.values(SEALED).map(each => `AND NOT EXISTS (SELECT 1 FROM ${each.versions} WHERE did = ?1 AND generation < ?2)
           AND NOT EXISTS (SELECT 1 FROM ${each.journal} WHERE did = ?1 AND generation < ?2)`).join('\n           ')}
         RETURNING target`,
      ).bind(did, to, now.toISOString()).first();
      if (finished) return { target: to, state: 'finished' };
      const held = await rotationOf(did);
      if (!held || held.target !== to) throw new Refused(404, 'NotFound', `No rotation to ${to} is under way`);
      if (held.state === 'finished') return { target: to, state: 'finished', unchanged: true };
      throw new Refused(409, 'RotationRemaining', 'Some kept versions or journal entries are still sealed under the older key. Re-wrap them, then finish', { target: to, remaining: await below(did, to) });
    },
  };
}
