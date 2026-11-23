// What a semantic check of the vault should look at. The vault holds no model, so it cannot say that
// two notes contradict each other; it can say which notes are worth an agent reading side by side.
// Everything here is a candidate, found from the index alone, and the agent judges it:
//
//   problems   what the reader already reported: duplicate IDs, ambiguous slugs, bad properties
//   missing    links, embeds and mentions that point at nothing in the vault
//   orphans    blocks that nothing links to and that link to nothing, beyond their channel
//   related    pairs of blocks with no edge between them that share several uncommon words: a
//              connection to draw, two notes saying the same thing, or two that disagree
//   sameTitle  blocks with the same title: a duplicate, or two versions of one thing
//   proposed   blocks still `status: proposed`, oldest first, for the person to keep or drop
//
// Conclusions go to the cortex as observations about the blocks; fixes go through the vault's own
// tools, within what the person granted. Nothing here writes.
const plain = row => ({ ...row });
const LIMIT = 30;

export function lint(db, { limit = LIMIT } = {}) {
  const blocks = Number(db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE type = 'block'").get().n);
  const label = key => db.prepare('SELECT key, title, path, slug FROM nodes WHERE key = ?').get(key);
  const problems = db.prepare('SELECT root, path, problem FROM problems ORDER BY root, path LIMIT ?').all(limit).map(plain);
  const missing = db.prepare("SELECT src AS node, kind, dst AS target, at FROM edges WHERE dst LIKE 'missing:%' ORDER BY src LIMIT ?").all(limit)
    .map(row => ({ ...plain(row), title: label(row.node)?.title ?? null, target: row.target.slice('missing:'.length) }));
  const orphans = db.prepare(`SELECT n.key, n.title, n.path FROM nodes n WHERE n.type = 'block'
    AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.kind != 'contains' AND (e.src = n.key OR e.dst = n.key))
    ORDER BY n.path LIMIT ?`).all(limit).map(plain);
  // Uncommon words: in at least two blocks and at most 5% of them (never fewer than three), so a
  // shared word says something about what two notes are about.
  const most = Math.max(3, Math.floor(blocks * 0.05));
  const related = blocks < 2 ? [] : db.prepare(`WITH b AS (SELECT key FROM nodes WHERE type = 'block'),
      t AS (SELECT term, key FROM terms WHERE key IN (SELECT key FROM b)),
      rare AS (SELECT term FROM t GROUP BY term HAVING COUNT(*) BETWEEN 2 AND ?)
    SELECT a.key AS a, c.key AS b, COUNT(*) AS shared, GROUP_CONCAT(a.term, ' ') AS words
    FROM t a JOIN t c ON a.term = c.term AND a.key < c.key
    WHERE a.term IN (SELECT term FROM rare)
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE (e.src = a.key AND e.dst = c.key) OR (e.src = c.key AND e.dst = a.key))
    GROUP BY a.key, c.key HAVING COUNT(*) >= 3 ORDER BY shared DESC, a.key, c.key LIMIT ?`).all(most, limit)
    .map(row => ({ a: label(row.a), b: label(row.b), shared: Number(row.shared), words: row.words.split(' ').slice(0, 12) }));
  const sameTitle = db.prepare(`SELECT LOWER(title) AS title, GROUP_CONCAT(key, ' ') AS keys FROM nodes
    WHERE type = 'block' AND title IS NOT NULL AND TRIM(title) != '' GROUP BY LOWER(title) HAVING COUNT(*) > 1 LIMIT ?`).all(limit)
    .map(row => ({ title: row.title, blocks: row.keys.split(' ').map(label) }));
  const proposed = db.prepare("SELECT key, title, path, node FROM nodes WHERE type = 'block'").all()
    .map(row => ({ row, node: JSON.parse(row.node) })).filter(({ node }) => node.status === 'proposed')
    .sort((x, y) => String(x.node.created ?? '').localeCompare(String(y.node.created ?? '')))
    .slice(0, limit).map(({ row, node }) => ({ key: row.key, title: row.title, path: row.path, by: node.by ?? null, created: node.created ?? null }));
  return {
    blocks, problems, missing, orphans, related, sameTitle, proposed,
    next: 'These are candidates, not findings. Read each related pair and each same title with vault_local_read and judge: connected, duplicate, contradicting, or unrelated. '
      + 'Record what you conclude with cortex_observe, about the blocks it concerns. Fix only what the person granted you (vault_where lists it) with vault_link, vault_write or vault_remove; ask before anything else. '
      + 'Then say what is missing that the vault should hold, as questions for the person.',
  };
}
