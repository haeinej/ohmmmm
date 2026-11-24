import { isPostId, postFile, setProperty } from "../../../vault/vault/file.mjs"
import { readNode, readVault } from "../../../vault/vault/node.mjs"
import { words } from "../../../vault/vault/words.mjs"
import {
  blockOf, CORTEX_CONTEXT, mediaName, moveVisibility, readEvidence, searchInput, visibilityMove,
  type Account, type Agenda, type BlockFile, type BlockHead, type BlockRef, type ChannelHead, type ChannelMove,
  type CortexEntry, type CortexFile, type Friend, type FriendRequest, type HistoryVersion, type HomeFile, type HomeSource, type Layer, type MoveRequest, type PublishPlan,
} from "./source"
import { isBlockKind } from "./block-kind"
import type { SearchHit } from "./search"

type RemoteBlock = { id: string; path: string; title?: string; version: string; kind: string; leaving?: string }
type PostHead = { id: string; slug: string; title?: string; visibility: Layer; leaving?: string }
type Tree = { labels: { label: string; posts: PostHead[]; sublabels: { sublabel: string; posts: PostHead[] }[] }[] }
type SealedRow<Sealed> = { id: string; sealed: Sealed; version: string }
type SealOptions = { context?: typeof CORTEX_CONTEXT }
type Keys<Master, Sealed> = {
  /**
   * Present once packages/keys can seal under another context than private blocks'. The cortex
   * refuses until it is, rather than sealing cortex files as private blocks.
   */
  CORTEX_CONTEXT?: string
  vaultPrivateFiles(options: { baseUrl: string; fetch: typeof fetch }): {
    list(): Promise<SealedRow<Sealed>[]>
    get(id: string): Promise<SealedRow<Sealed> | null>
    replace(file: { id: string; sealed: Sealed; replaces: string | null }): Promise<unknown>
  }
  openFile(master: Master, did: string, id: string, file: Sealed, options?: SealOptions): Promise<Uint8Array>
  sealFile(master: Master, did: string, id: string, plain: Uint8Array<ArrayBuffer>, options?: SealOptions): Promise<Sealed>
}

export type ServiceOptions<Master, Sealed> = {
  origin: string
  did: string
  fetch?: typeof fetch
  sharedServiceToken?: (method: "com.ohmmmm.vault.listShared" | "com.ohmmmm.vault.getShared") => Promise<string>
  /** Supplied by the account's browser session using ohm-onboarding packages/keys. */
  privateSession?: { keys: Keys<Master, Sealed>; unlocked(): { did: string; master: Master } | null }
}

export class HomeRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

async function answerOf<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const { error, message } = await response.json().catch(() => ({}))
    throw new HomeRefusal(error ?? "HttpError", message ?? `Vault request failed (HTTP ${response.status}).`)
  }
  return response.json() as Promise<T>
}

/** A new opaque ID for a sealed file: a private block or a cortex file. */
export const newOpaqueId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const friendsHead = (block: RemoteBlock): BlockHead => ({
  id: block.id, path: block.path, title: block.title, version: block.version,
  layer: "friends", store: block.kind === "post" ? "post" : "block", ...(block.leaving ? { leaving: block.leaving } : {}),
})
const visibleLayers: readonly Layer[] = ["public", "friends"]
/** packages/keys seals journal entries as a file with this ID. */
const JOURNAL_FILE_ID = "journal"
const randomId = () => newOpaqueId()
const pageAll = async <Row>(read: (since?: string) => Promise<{ cursor?: string; more?: boolean } & Record<string, unknown>>, key: string, what: string) => {
  const rows: Row[] = []
  let since: string | undefined
  for (;;) {
    const page = await read(since)
    rows.push(...page[key] as Row[])
    if (!page.more) return rows
    if (!page.cursor || page.cursor === since) throw new HomeRefusal("InvalidCursor", `The ${what} list did not advance.`)
    since = page.cursor
  }
}

export function createServiceSource<Master, Sealed>(options: ServiceOptions<Master, Sealed>): HomeSource {
  const { did, origin, privateSession, fetch: send = fetch } = options
  const base = new URL("/vault/", origin)
  if (typeof location !== "undefined" && base.origin !== location.origin) {
    throw new HomeRefusal("WrongOrigin", "Vault requests need the signed-in app's origin.")
  }
  const boundFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base)
    if (url.origin !== base.origin || !url.pathname.startsWith("/vault/xrpc/")) {
      throw new HomeRefusal("WrongOrigin", "Vault requests need the signed-in app's origin.")
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("X-Ohm-Did", did)
    return send(input, { ...init, headers, credentials: "same-origin", redirect: "error" })
  }
  const ask = async <T>(name: string, input: {
    query?: Record<string, string>; body?: unknown; signal?: AbortSignal; account?: boolean; token?: string
  } = {}): Promise<T> => {
    const url = new URL(`xrpc/com.ohmmmm.${name}`, base)
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value)
    const init: RequestInit = {
      signal: input.signal, credentials: "same-origin", redirect: "error",
      ...(input.body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body),
      }),
    }
    if (input.token) init.headers = { ...init.headers, Authorization: `Bearer ${input.token}` }
    return answerOf<T>(await (input.account ? send : boundFetch)(url, init))
  }
  const vaultAsk = <T>(name: string, input?: Parameters<typeof ask>[1]) => ask<T>(`vault.${name}`, input)
  const cortexAsk = <T>(name: string, input?: Parameters<typeof ask>[1]) => ask<T>(`cortex.${name}`, input)
  const mediaAsk = <T>(name: string, input?: Parameters<typeof ask>[1]) => ask<T>(`media.${name}`, input)
  const mediaBytes = async (name: string, query: Record<string, string>) => {
    const url = new URL(`xrpc/com.ohmmmm.media.${name}`, base)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await boundFetch(url, { credentials: "same-origin", redirect: "error" })
    if (!response.ok) await answerOf(response)
    return response.blob()
  }
  const cortexSeal: SealOptions = { context: CORTEX_CONTEXT }
  const checkOpaque = (id: string) => {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new HomeRefusal("InvalidFile", "Name a cortex file by its opaque ID.")
  }
  const listChannels = () => pageAll<ChannelHead & { removed?: boolean }>(since =>
    vaultAsk("listChannels", { query: since === undefined ? {} : { since } }), "channels", "channel")
    .then(rows => [...new Map(rows.map(row => [row.path, row])).values()].filter(row => !row.removed)
      .map(({ path, version, title, kind }): ChannelHead => ({ path, version, title, kind })))
  const channelFiles = async (): Promise<HomeFile[]> => {
    const heads = await listChannels()
    return Promise.all(heads.map(async head => {
      const { channel } = await vaultAsk<{ channel: HomeFile }>("getChannel", { query: { path: head.path } })
      return { path: channel.path.endsWith("/_channel.md") ? channel.path : `${head.path}/_channel.md`, text: channel.text }
    }))
  }
  const sharedToken = (method: "listShared" | "getShared") => {
    if (!options.sharedServiceToken) throw new HomeRefusal("TokenRequired", "Shared reads need a service token for your DID.")
    return options.sharedServiceToken(`com.ohmmmm.vault.${method}`)
  }
  const files = privateSession?.keys.vaultPrivateFiles({ baseUrl: base.href, fetch: boundFetch })
  const unlocked = () => {
    const session = privateSession?.unlocked()
    if (!privateSession || !files || !session || session.did !== did) {
      throw new HomeRefusal("PrivateLocked", "Unlock this account's private vault on this device.")
    }
    return { ...session, keys: privateSession.keys, files }
  }
  const cortexKeys = () => {
    const session = unlocked()
    if (session.keys.CORTEX_CONTEXT !== CORTEX_CONTEXT) {
      throw new HomeRefusal("CortexKeysMissing", "This version of the account's keys can't seal the cortex yet.")
    }
    return session
  }
  const sealJson = async (id: string, value: unknown, options?: SealOptions) => {
    const { keys, master } = options ? cortexKeys() : unlocked()
    const sealed = await keys.sealFile(master, did, id, new TextEncoder().encode(JSON.stringify(value)), options)
    unlocked()
    return sealed
  }
  const openJson = async (id: string, sealed: Sealed, options?: SealOptions) => {
    const { keys, master } = options ? cortexKeys() : unlocked()
    const plain = await keys.openFile(master, did, id, sealed, options)
    unlocked()
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain))
  }
  const decode = async (id: string, sealed: Sealed, options?: SealOptions): Promise<HomeFile> => {
    const file = await openJson(id, sealed, options)
    if (!file || typeof file.path !== "string" || typeof file.text !== "string") {
      throw new HomeRefusal("InvalidFile", "The private file can't be read as a vault file.")
    }
    return { path: file.path, text: file.text }
  }
  const checkRef = (ref: BlockRef) => {
    const valid = ref.layer === "private"
      ? ref.store === "sealed" && /^[A-Za-z0-9_-]{16,64}$/.test(ref.id)
      : isPostId(ref.id) && (ref.store === "post" || (ref.layer === "friends" && ref.store === "block"))
    if (!valid) {
      throw new HomeRefusal("InvalidBlock", "Choose an ID and storage layer for this block.")
    }
  }
  const postHeads = async (): Promise<BlockHead[]> => {
    const { labels } = await vaultAsk<Tree>("getTree")
    const at = (posts: PostHead[], path: string): BlockHead[] => posts
      .filter(post => post.visibility === "public" || post.visibility === "friends")
      .map(post => ({ id: post.id, layer: post.visibility, title: post.title, store: "post", path: `${path}/${post.slug}.md`, ...(post.leaving ? { leaving: post.leaving } : {}) }))
    return labels.flatMap(label => [
      ...at(label.posts, label.label),
      ...label.sublabels.flatMap(group => at(group.posts, `${label.label}/${group.sublabel}`)),
    ])
  }
  const friendBlocks = async (): Promise<BlockHead[]> => {
    const found = new Map<string, BlockHead>()
    let since: string | undefined
    for (;;) {
      const page: { blocks: (RemoteBlock & { removed?: boolean })[]; cursor: string; more?: boolean }
        = await vaultAsk("listBlocks", { query: since === undefined ? {} : { since } })
      for (const block of page.blocks) {
        if (block.removed) found.delete(block.id)
        else found.set(block.id, friendsHead(block))
      }
      if (!page.more) return [...found.values()]
      if (!page.cursor || page.cursor === since) throw new HomeRefusal("InvalidCursor", "The friends list did not advance.")
      since = page.cursor
    }
  }
  const source: HomeSource = {
    account: () => ask<Account>("account.get", { account: true }),
    async listBlocks(layers = visibleLayers) {
      const [posts, friends, privateFiles] = await Promise.all([
        layers.some(layer => layer !== "private") ? postHeads() : [],
        layers.includes("friends") ? friendBlocks() : [],
        layers.includes("private") ? unlocked().files.list() : [],
      ])
      if (layers.includes("private")) unlocked()
      return [
        ...posts.filter(post => layers.includes(post.layer)), ...friends,
        ...privateFiles.map(({ id, version }): BlockHead => ({ id, version, layer: "private", store: "sealed" })),
      ]
    },
    async readBlock(ref) {
      checkRef(ref)
      if (ref.store === "sealed") {
        const file = await unlocked().files.get(ref.id)
        if (!file) throw new HomeRefusal("NotFound", "There is no such private file.")
        return { ...await decode(ref.id, file.sealed), version: file.version }
      }
      if (ref.store === "block") {
        const { block, version } = await vaultAsk<{ block: HomeFile; version: string }>("getBlock", { query: { id: ref.id } })
        if (blockOf(block)?.visibility !== "friends") {
          throw new HomeRefusal("LayerChanged", "The block is outside the friends layer.")
        }
        return { path: block.path, text: block.text, version }
      }
      const { post, version } = await vaultAsk<{ post: Parameters<typeof postFile>[0]; version: string }>("getPost", { query: { id: ref.id } })
      if (post.visibility !== ref.layer) throw new HomeRefusal("LayerChanged", "The post changed visibility. Refresh the vault.")
      return { ...postFile(post), version }
    },
    async saveBlock(ref, file, replaces) {
      checkRef(ref)
      const read = readNode(file.path, file.text)
      const block = blockOf(file)
      if (!read?.node || read.problems.length || (ref.store !== "sealed" && read.node.id && read.node.id !== ref.id)
        || (block && block.visibility !== ref.layer) || (ref.store !== "sealed" && !block)) {
        throw new HomeRefusal("InvalidFile", "Give a valid vault file for this ID and layer.")
      }
      if (ref.store === "sealed") {
        const { keys, master, files } = unlocked()
        const sealed = await keys.sealFile(master, did, ref.id, new TextEncoder().encode(JSON.stringify({ path: file.path, text: file.text })))
        unlocked()
        const result = await files.replace({ id: ref.id, sealed, replaces }) as { version: string }
        unlocked()
        return { version: result.version }
      }
      if (ref.store === "post" && block && "post" in block) {
        return vaultAsk("putPost", { body: { post: { ...block.post, id: ref.id }, replaces } })
      }
      if (ref.store === "block" && block?.kind !== "post") {
        return vaultAsk("putBlock", { body: { block: { id: ref.id, path: file.path, text: file.text }, replaces } })
      }
      throw new HomeRefusal("InvalidFile", "This file does not match its post or block store.")
    },
    async deleteBlock(ref, replaces) {
      checkRef(ref)
      if (!replaces) throw new HomeRefusal("InvalidVersion", "Read the block's current version before deleting it.")
      if (ref.store === "sealed") unlocked()
      const name = ref.store === "sealed" ? "deletePrivateBlock" : ref.store === "post" ? "deletePost" : "deleteBlock"
      await vaultAsk(name, { body: { id: ref.id, replaces } })
    },
    async vault(layers = visibleLayers) {
      // The keys package already loaded the sealed files. Open them once, on this device.
      const privateFiles = layers.includes("private") ? await unlocked().files.list() : []
      const [shared, channels] = await Promise.all([source.listBlocks(layers.filter(layer => layer !== "private")), channelFiles()])
      const all = await Promise.all([
        ...shared.map(ref => source.readBlock(ref)),
        ...privateFiles.map(file => decode(file.id, file.sealed)),
      ])
      if (layers.includes("private")) unlocked()
      return readVault([...all, ...channels])
    },
    connections: layers => readEvidence(source, layers),
    async search(input, signal) {
      const { query, limit } = searchInput(input)
      if (!query || (input.scope && !["all", "vault"].includes(input.scope))) return []
      signal?.throwIfAborted()
      const queryWords = [...new Set(words(query))]
      const matches = ({ id, file }: { id: string; file: HomeFile }): SearchHit[] => {
        const node = blockOf(file)
        if (!node || !isBlockKind(node.kind)) return []
        const tokens = new Set(words([node.title, node.home, ...node.channels, node.body].join(" ")))
        if (!queryWords.length || !queryWords.every(word => tokens.has(word))) return []
        return [{ id, title: node.title ?? node.slug, kind: node.kind, location: node.home, excerpt: node.body.slice(0, 120) }]
      }
      if (privateSession?.unlocked()?.did === did) {
        const [shared, sealed] = await Promise.all([source.listBlocks(), unlocked().files.list()])
        const files = await Promise.all([
          ...shared.map(async ref => ({ id: ref.id, file: await source.readBlock(ref) })),
          ...sealed.map(async row => ({ id: row.id, file: await decode(row.id, row.sealed) })),
        ])
        signal?.throwIfAborted()
        unlocked()
        return files.flatMap(matches).slice(0, limit)
      }
      type Match = { id: string; title?: string; slug: string; label: string; sublabel?: string; passage: string; visibility: Layer }
      const searchPosts = async (visibility: Layer) => {
        const result = await vaultAsk<{ posts: Match[] }>("searchPosts", { query: { q: query, visibility, limit: String(limit) }, signal })
        return result.posts.filter(post => post.visibility === visibility).map((post): SearchHit => ({
          id: post.id, title: post.title ?? post.slug, kind: "post", location: [post.label, post.sublabel].filter(Boolean).join(" › "), excerpt: post.passage,
        }))
      }
      const [publicPosts, friendsPosts, friendsFiles] = await Promise.all([
        searchPosts("public"), searchPosts("friends"), friendBlocks(),
      ])
      signal?.throwIfAborted()
      const local = (await Promise.all(friendsFiles.map(async ref => ({ id: ref.id, file: await source.readBlock(ref) })))).flatMap(matches)
      signal?.throwIfAborted()
      return [...publicPosts, ...friendsPosts, ...local].slice(0, limit)
    },
    async history(ref) {
      checkRef(ref)
      if (ref.store !== "sealed") return []
      unlocked()
      const result = await vaultAsk<{ versions: HistoryVersion[] }>("listPrivateVersions", { query: { id: ref.id } })
      unlocked()
      return result.versions
    },
    async readVersion(ref, rev) {
      checkRef(ref)
      if (ref.store !== "sealed") throw new HomeRefusal("NotSupported", "Kept versions are available for private files.")
      unlocked()
      const { ciphertext } = await vaultAsk<{ ciphertext: Sealed }>("getPrivateVersion", { query: { id: ref.id, rev: String(rev) } })
      return decode(ref.id, ciphertext)
    },
    visibilityMove,
    moveVisibility: (ref, to, version) => moveVisibility(source, ref, to, version),
    async listFriends() { return (await vaultAsk<{ friends: Friend[] }>("listFriends")).friends },
    async removeFriend(id) { await vaultAsk("removeFriend", { body: { did: id } }) },
    friendRequests: {
      list: async () => (await vaultAsk<{ requests: FriendRequest[] }>("listFriendRequests")).requests,
      async approve(id, channels) { await vaultAsk("approveFriend", { body: { id, channels } }) },
      async decline(id) { await vaultAsk("declineFriend", { body: { id } }) },
      async setChannels(did, channels) { await vaultAsk("setFriendChannels", { body: { friend: did, channels } }) },
    },
    async listShared(owner) {
      return (await vaultAsk<{ blocks: RemoteBlock[] }>("listShared", { query: { owner }, token: await sharedToken("listShared") })).blocks.map(friendsHead)
    },
    async readShared(owner, id): Promise<BlockFile> {
      const { block, version } = await vaultAsk<{ block: HomeFile; version: string }>("getShared", { query: { owner, id }, token: await sharedToken("getShared") })
      if (blockOf(block)?.visibility !== "friends") throw new HomeRefusal("LayerChanged", "The block is outside the friends layer.")
      return { path: block.path, text: block.text, version }
    },
    publishPlan: prepare => vaultAsk<PublishPlan>("getPublishPlan", { query: prepare ? { prepare: "1" } : {} }),
    channels: {
      list: listChannels,
      async read(path) {
        const { channel, version } = await vaultAsk<{ channel: HomeFile; version: string }>("getChannel", { query: { path } })
        return { path: channel.path, text: channel.text, version }
      },
      async save(file, replaces) {
        const path = file.path.replace(/\/_channel\.md$/, "")
        const { version } = await vaultAsk<{ version: string }>("putChannel", { body: { channel: { path, text: file.text }, replaces } })
        return { version }
      },
      move: (from, to, replaces) => vaultAsk<ChannelMove>("moveChannel", { body: { from, to, replaces } }),
      async remove(path, replaces) { await vaultAsk("deleteChannel", { body: { path, replaces } }) },
    },
    cortex: {
      async list() {
        cortexKeys()
        const heads = await pageAll<{ id: string; removed?: boolean }>(since =>
          cortexAsk("listFiles", { query: since === undefined ? {} : { since } }), "blocks", "cortex")
        const live = [...new Map(heads.map(head => [head.id, head])).values()].filter(head => !head.removed)
        return Promise.all(live.map(head => source.cortex.read(head.id)))
      },
      async read(id) {
        checkOpaque(id)
        cortexKeys()
        const { ciphertext, version } = await cortexAsk<{ ciphertext: Sealed; version: string }>("getFile", { query: { id } })
        return { id, version, ...await decode(id, ciphertext, cortexSeal) }
      },
      async save(id, file, replaces, journal) {
        checkOpaque(id)
        const ciphertext = await sealJson(id, { path: file.path, text: file.text }, cortexSeal)
        const entry = journal && await sealJson(JOURNAL_FILE_ID, journal, cortexSeal)
        const { version } = await cortexAsk<{ version: string }>("putFile", { body: { file: { id, ciphertext }, replaces, ...(entry ? { journal: entry } : {}) } })
        return { version }
      },
      async saveMany(changes, journal) {
        const sealed = await Promise.all(changes.map(async change => {
          checkOpaque(change.id)
          return "remove" in change
            ? { id: change.id, remove: true, replaces: change.replaces }
            : { id: change.id, ciphertext: await sealJson(change.id, { path: change.file.path, text: change.file.text }, cortexSeal), replaces: change.replaces }
        }))
        const entry = journal && await sealJson(JOURNAL_FILE_ID, journal, cortexSeal)
        const { blocks } = await cortexAsk<{ blocks: { id: string; version?: string; removed?: boolean }[] }>("putFiles", {
          body: { changes: sealed, batchId: randomId(), ...(entry ? { journal: entry } : {}) },
        })
        return blocks
      },
      async remove(id, replaces, journal) {
        checkOpaque(id)
        cortexKeys()
        const entry = journal && await sealJson(JOURNAL_FILE_ID, journal, cortexSeal)
        await cortexAsk("deleteFile", { body: { id, replaces, ...(entry ? { journal: entry } : {}) } })
      },
      async history(id) {
        checkOpaque(id)
        cortexKeys()
        return (await cortexAsk<{ versions: HistoryVersion[] }>("listVersions", { query: { id } })).versions
      },
      async readVersion(id, rev) {
        checkOpaque(id)
        cortexKeys()
        const { ciphertext } = await cortexAsk<{ ciphertext: Sealed }>("getVersion", { query: { id, rev: String(rev) } })
        return decode(id, ciphertext, cortexSeal)
      },
      async journal() {
        cortexKeys()
        const rows = await pageAll<{ seq: number; entry: Sealed; created: string }>(since =>
          cortexAsk("listJournal", { query: since === undefined ? {} : { since } }), "entries", "cortex journal")
        return Promise.all(rows.map(async (row): Promise<CortexEntry> => ({
          seq: row.seq, created: row.created, entry: await openJson(JOURNAL_FILE_ID, row.entry, cortexSeal),
        })))
      },
    },
    media: {
      async has(names) {
        if (!names.length) return []
        return (await mediaAsk<{ present: string[] }>("hasMedia", { query: { names: names.join(",") } })).present
      },
      async put(bytes, type) {
        const name = await mediaName(bytes)
        const url = new URL("xrpc/com.ohmmmm.media.putMedia", base)
        url.searchParams.set("name", name)
        const response = await boundFetch(url, { method: "POST", headers: { "Content-Type": type || "application/octet-stream" }, body: bytes })
        const answer = await answerOf<{ name: string; size: number }>(response)
        return { name: answer.name, size: answer.size }
      },
      get: name => mediaBytes("getMedia", { name }),
      rendition: (name, width) => mediaBytes("getRendition", { name, width: String(width) }),
    },
    moves: {
      requests: async () => (await vaultAsk<{ requests: MoveRequest[] }>("listMoveRequests")).requests,
      async decline(id, reason) { await vaultAsk("declineMoveRequest", { body: { id, ...(reason ? { reason } : {}) } }) },
      record: move => vaultAsk<{ state: string }>("recordMove", { body: move }),
      publishPage: postId => new URL(`?publish=${encodeURIComponent(postId)}`, base).href,
    },
    agenda: () => vaultAsk<Agenda>("getAgenda"),
  }
  return source
}
