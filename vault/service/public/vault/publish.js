// Carrying out a publish: making the changes a plan lists, in the member's own repository, as
// the member. The vault service works the plan out and writes nothing; this is the other half,
// and runs wherever the member is signed in at their PDS: the editor in a browser, or an agent's
// tools. It is the same code in both, so a post published from either is the same record.
//
//   plan        what the vault service gave: `repository`, `collection` (where posts are kept, as
//               standard.site documents), `contentType` (the post inside each), `writes`
//   attachment  fetches one file a post places: (write, item) => { bytes, mime }
//   upload      sends one file to the PDS and returns what the PDS calls it: (bytes, mime) => blob
//   apply       makes a batch of changes in the repository, all or none: writes => undefined
const kindOf = mime => ['image', 'video', 'audio'].find(kind => String(mime).startsWith(`${kind}/`)) ?? 'file';
const MOST = 200;

export async function carryOut(plan, { attachment, upload, apply }) {
  const changes = [];
  const done = { created: 0, replaced: 0, removed: 0, files: 0 };
  for (const write of plan.writes) {
    if (write.action === 'delete') {
      changes.push({ $type: 'com.atproto.repo.applyWrites#delete', collection: write.collection ?? plan.collection, rkey: write.rkey });
      done.removed++;
      continue;
    }
    // A post is a standard.site document whose content is the post; its media are in the content.
    const document = write.record.$type === 'site.standard.document';
    const held = document ? write.record.content : write.record;
    const contentType = plan.contentType ?? plan.collection;
    // Each file the post places that the PDS does not hold yet is sent first, so the record can name it.
    const media = [...(held.media ?? [])];
    for (const item of write.upload ?? []) {
      const { bytes, mime } = await attachment(write, item);
      const kind = kindOf(mime);
      media.push({ $type: `${contentType}#${kind}`, id: item.id, file: await upload(bytes, mime), sourceUrl: item.address, ...(item.alt && kind === 'image' ? { alt: item.alt } : {}) });
      done.files++;
    }
    const content = { ...held, ...(media.length ? { media } : {}) };
    changes.push({
      $type: `com.atproto.repo.applyWrites#${write.action}`, collection: write.collection ?? plan.collection, rkey: write.rkey,
      value: document ? { ...write.record, content } : content,
    });
    // The publication record is not a post, and is not counted as one.
    if (write.collection && write.collection !== plan.collection) continue;
    if (write.action === 'create') done.created++; else done.replaced++;
  }
  // A post moved to its permanent key is one post replaced, not one made and one removed.
  const moved = plan.writes.filter(write => write.action === 'delete' && plan.writes.some(other => other.action === 'create' && other.slug === write.slug && other.slug !== undefined)).length;
  done.created -= moved; done.removed -= moved; done.replaced += moved;
  for (let from = 0; from < changes.length; from += MOST) await apply(changes.slice(from, from + MOST));
  return done;
}
