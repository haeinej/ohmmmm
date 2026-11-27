// Posts from the network for the feed (docs/plans/units.md, steps 8 and 9; app/flows/feed.md):
//
//   Following  the accounts the person follows on Bluesky, live, through Jetstream (Bluesky's JSON
//              firehose) with `wantedDids` set to them, starting a few hours back so the feed is not empty.
//   Discover   a feed generator, read from Bluesky's public AppView (`app.bsky.feed.getFeed`), never the
//              whole firehose, which is far more than one computer should take in.
//
// The bridge connects out for these; it still answers only this machine. Nothing here signs in or
// writes: who someone follows and their posts are public. Posts are other people's words: the app shows
// them as theirs, and nothing here passes them to an agent.
export const APPVIEW = 'https://public.api.bsky.app';
export const JETSTREAM = 'wss://jetstream2.us-east.bsky.network/subscribe';
// Discover, for now: AI and the people building it, blended from public feed generators anyone can read.
export const DISCOVER_FEEDS = [
  'at://did:plc:lrzkd5exmxqrblbruvjieofj/app.bsky.feed.generator/MLBlend',        // AI/ML Feed: Blend
  'at://did:plc:rwkarouaeku2g6qkvqkirwa5/app.bsky.feed.generator/MLSky',          // MLSky
  'at://did:plc:ugbenc43qu4v3hemephm2cry/app.bsky.feed.generator/aaamqhwmov3y4',  // Artificial Intelligence
  'at://did:plc:3x2yyg4s6c6n26caev222yv3/app.bsky.feed.generator/whats-llm',      // LLM
  'at://did:plc:mp33qrwuvsxucbzoh7kykslu/app.bsky.feed.generator/ai-agents',      // AI Agents
];
export const KEPT = 500;
const MOST_FOLLOWS = 2000;
const BACK = 6 * 3600 * 1e6; // How far back Jetstream starts, in microseconds.

const POST = 'app.bsky.feed.post';
const cdn = (did, cid, size = 'feed_thumbnail') => `https://cdn.bsky.app/img/${size}/plain/${did}/${cid}@jpeg`;
const blobCid = blob => blob?.ref?.$link ?? blob?.ref?.toString?.() ?? blob?.cid ?? null;
const text = value => (typeof value === 'string' ? value : '');

/** What a post shows, from its record: its pictures, the page it links to, the post it quotes. */
function embedOf(did, embed) {
  if (!embed || typeof embed !== 'object') return {};
  const media = embed.$type === 'app.bsky.embed.recordWithMedia' ? embed.media : embed;
  const out = {};
  if (media?.$type === 'app.bsky.embed.images' && Array.isArray(media.images)) {
    out.images = media.images.map(image => ({ thumb: blobCid(image.image) ? cdn(did, blobCid(image.image)) : null, alt: text(image.alt), ...(image.aspectRatio?.width ? { ratio: image.aspectRatio.width / image.aspectRatio.height } : {}) })).filter(image => image.thumb).slice(0, 4);
  }
  if (media?.$type === 'app.bsky.embed.external' && media.external?.uri) {
    out.link = { uri: media.external.uri, title: text(media.external.title), description: text(media.external.description), thumb: blobCid(media.external.thumb) ? cdn(did, blobCid(media.external.thumb)) : null };
  }
  const quoted = embed.$type === 'app.bsky.embed.record' ? embed.record : embed.$type === 'app.bsky.embed.recordWithMedia' ? embed.record?.record : null;
  if (quoted?.uri) out.quote = quoted.uri;
  return out;
}

/** A post from a Jetstream event, or null for anything but a new post. `authors` names who wrote it. */
export function postOfEvent(event, authors = new Map()) {
  const commit = event?.commit;
  if (event?.kind !== 'commit' || commit?.operation !== 'create' || commit.collection !== POST || !commit.record) return null;
  const did = event.did;
  const author = authors.get(did) ?? { did };
  return {
    uri: `at://${did}/${POST}/${commit.rkey}`, cid: commit.cid ?? null, author,
    text: text(commit.record.text), facets: commit.record.facets ?? [], createdAt: text(commit.record.createdAt) || new Date(event.time_us / 1000).toISOString(),
    ...(commit.record.reply?.parent?.uri ? { replyTo: commit.record.reply.parent.uri } : {}),
    ...embedOf(did, commit.record.embed),
  };
}

/** A post from the AppView's post view (`getFeed`, `getAuthorFeed`). */
export function postOfView(view) {
  const author = { did: view.author?.did, handle: view.author?.handle, name: view.author?.displayName || view.author?.handle, avatar: view.author?.avatar ?? null };
  const record = view.record ?? {};
  const out = {
    uri: view.uri, cid: view.cid ?? null, author, text: text(record.text), facets: record.facets ?? [], createdAt: text(record.createdAt) || text(view.indexedAt),
    ...(record.reply?.parent?.uri ? { replyTo: record.reply.parent.uri } : {}),
    replies: view.replyCount ?? 0, likes: view.likeCount ?? 0, reposts: view.repostCount ?? 0,
  };
  const embed = view.embed ?? {};
  const media = embed.$type === 'app.bsky.embed.recordWithMedia#view' ? embed.media : embed;
  if (media?.$type === 'app.bsky.embed.images#view') out.images = (media.images ?? []).map(image => ({ thumb: image.thumb, alt: text(image.alt), ...(image.aspectRatio?.width ? { ratio: image.aspectRatio.width / image.aspectRatio.height } : {}) })).slice(0, 4);
  if (media?.$type === 'app.bsky.embed.external#view' && media.external?.uri) out.link = { uri: media.external.uri, title: text(media.external.title), description: text(media.external.description), thumb: media.external.thumb ?? null };
  return out;
}

async function json(fetchImpl, url) {
  const answer = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!answer.ok) throw new Error(`${new URL(url).pathname} answered ${answer.status}`);
  return answer.json();
}

/** The DID a handle names, through the public AppView. */
export async function resolveHandle(handle, fetchImpl = fetch) {
  if (/^did:/.test(handle)) return handle;
  const said = await json(fetchImpl, `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
  return said.did;
}

/** Who `actor` follows, with their names and pictures, up to MOST_FOLLOWS. */
export async function followsOf(actor, fetchImpl = fetch) {
  const out = [];
  let cursor;
  do {
    const said = await json(fetchImpl, `${APPVIEW}/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(actor)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const each of said.follows ?? []) out.push({ did: each.did, handle: each.handle, name: each.displayName || each.handle, avatar: each.avatar ?? null });
    cursor = said.cursor;
  } while (cursor && out.length < MOST_FOLLOWS);
  return out;
}

// What Discover keeps: posts about AI, by their words or the page they link to. The feeds' authors post
// about their weekends too.
const AI_WORDS = /\b(ai|a\.i\.|agi|llms?|gpt[-\w]*|chatgpt|openai|anthropic|claude|gemini|llama|mistral|deepmind|hugging ?face|nvidia|models?|agents?|agentic|machine learning|ml|deep learning|neural|transformers?|diffusion|inference|fine-?tun\w*|embeddings?|rag|prompts?|robot\w*|reinforcement learning|rl|datasets?|benchmarks?|arxiv|neurips|icml|iclr|copilot|cursor)\b/i;
export const aboutAi = post => AI_WORDS.test(`${post.text} ${post.link?.title ?? ''} ${post.link?.description ?? ''}`);
// What is left out as noise: trading bots, and posts that are only hashtags and links.
const BOT = /smart money|\b(dumped|accumulated|bought|sold)\b.*\$\d|price:\s*\$|\bpump\b|airdrop|\$[A-Z]{2,6}\b|#(crypto|btc|eth|near|sol)\b/i;
const words = text => text.replace(/https?:\/\/\S+|www\.\S+|#\S+|@\S+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean).length;
export const worthReading = post => !BOT.test(post.text) && (words(post.text) >= 6 || Boolean(post.link?.title) || Boolean(post.images?.length && words(post.text) >= 3));

/**
 * Discover: the posts of a few feed generators together, read from the public AppView, each post once,
 * threads first and ranked (see below). A feed that does not answer is left out; if none answers,
 * Discover does not.
 */
export async function discover({ feeds = DISCOVER_FEEDS, limit = 60, fetchImpl = fetch } = {}) {
  const each = Math.min(100, Math.ceil(limit / feeds.length) + 5);
  const read = await Promise.allSettled(feeds.map(feed => json(fetchImpl, `${APPVIEW}/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feed)}&limit=${each}`)));
  if (read.every(result => result.status === 'rejected')) throw read[0].reason;
  const posts = new Map();
  for (const result of read) if (result.status === 'fulfilled') for (const item of result.value.feed ?? []) {
    const post = postOfView(item.post);
    if (post.uri && !posts.has(post.uri)) posts.set(post.uri, post);
  }
  // Threads first: a post that starts a conversation, not a reply on its own; ranked by how much it was
  // talked about, fading with age (a day halves it), so what is new and discussed comes first.
  const now = Date.now();
  const score = post => {
    const hours = Math.max(0, (now - Date.parse(post.createdAt || 0)) / 3.6e6);
    return (1 + post.replies * 3 + post.reposts * 2 + post.likes) / 2 ** (hours / 24);
  };
  return [...posts.values()].filter(post => !post.replyTo && aboutAi(post) && worthReading(post)).sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/**
 * Following, live: Jetstream for the accounts `handle` follows. Started on first use, kept running, and
 * reconnected when it drops. `posts()` is the newest KEPT, newest first.
 */
export function liveFollowing({ handle, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), retry = 5000 } = {}) {
  const kept = new Map();
  const authors = new Map();
  let state = { connected: false, following: 0, problem: null, started: false };
  let socket = null;
  let stopped = false;
  let lastTime = null;

  const keep = post => {
    if (!post || kept.has(post.uri)) return;
    kept.set(post.uri, post);
    if (kept.size > KEPT) {
      const oldest = [...kept.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, kept.size - KEPT);
      for (const each of oldest) kept.delete(each.uri);
    }
  };

  function connect(dids) {
    if (stopped || !dids.length) return;
    const cursor = lastTime ?? Math.round(now() * 1000 - BACK);
    socket = new WebSocketImpl(`${JETSTREAM}?wantedCollections=${POST}&requireHello=true&cursor=${cursor}`);
    socket.addEventListener('open', () => {
      state = { ...state, connected: true, problem: null };
      // The accounts go in the hello, not the address: there can be more than an address holds.
      socket.send(JSON.stringify({ type: 'options_update', payload: { wantedCollections: [POST], wantedDids: dids } }));
    });
    socket.addEventListener('message', message => {
      try {
        const event = JSON.parse(typeof message.data === 'string' ? message.data : String(message.data));
        if (event.time_us) lastTime = event.time_us;
        keep(postOfEvent(event, authors));
      } catch { /* one unreadable event is left out */ }
    });
    const again = () => {
      state = { ...state, connected: false };
      if (!stopped) setTimeout(() => connect(dids), retry).unref?.();
    };
    socket.addEventListener('close', again);
    socket.addEventListener('error', () => { state = { ...state, problem: 'Jetstream did not answer' }; });
  }

  async function start() {
    if (state.started) return;
    state = { ...state, started: true };
    try {
      const did = await resolveHandle(handle, fetchImpl);
      const follows = await followsOf(did, fetchImpl);
      for (const each of follows) authors.set(each.did, each);
      state = { ...state, following: follows.length };
      connect(follows.map(each => each.did));
    } catch (problem) {
      state = { ...state, started: false, problem: problem.message };
    }
  }

  return {
    start,
    posts: (limit = 100) => [...kept.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
    state: () => ({ connected: state.connected, following: state.following, problem: state.problem }),
    stop() { stopped = true; socket?.close(); },
    /** For tests: what an event would add. */
    _keep: event => keep(postOfEvent(event, authors)),
  };
}
