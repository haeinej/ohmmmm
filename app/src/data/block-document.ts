import { isPostId, setProperty, splitFile, writeNoteFile } from "../../../vault/vault/file.mjs"
import { nodeKey } from "../../../vault/vault/node.mjs"
import { isBlockKind, type BlockKind } from "./block-kind"
import { blockOf, type BlockRef, type HomeFile } from "./source"
import { isBlock, type Doc, type Platform } from "./workspace-model"

/** The properties the workspace edits; every other property a file holds is kept as it is. */
function managed(doc: Doc & { homeChannel: string }): Record<string, unknown> {
  return {
    id: doc.vaultId ?? (isPostId(doc.id) ? doc.id : undefined), kind: doc.visibility === "private" && doc.kind === "post" ? "text" : doc.kind,
    title: doc.title, slug: doc.slug, channels: doc.channels, visibility: doc.visibility,
    by: doc.by, status: doc.status, updated: doc.updated, connect: doc.connect?.map(each => each.to), icon: doc.icon,
    connectionNotes: doc.connect?.filter(each => each.why).map(each => `${each.to} ${each.why}`),
  }
}

/**
 * A block's file. Given the file it was read from, it changes only what the workspace edits (its
 * place, those properties and the body) and keeps the rest: a media record's origin, hash and alt
 * text, an excerpt's source, tags, created, a post's own fields.
 */
export function fileOf(doc: Doc, base?: HomeFile): HomeFile {
  if (!isBlock(doc)) throw new DOMException("Give a vault block.", "DataError")
  const path = `${doc.homeChannel}/${doc.slug}.md`
  if (!base) return { path, text: writeNoteFile({ properties: managed(doc), body: doc.body }) }
  return { path, text: withBody(Object.entries(managed(doc)).reduce((text, [key, value]) => setProperty(text, key, value), base.text), doc.body) }
}

/** The same file with its body replaced, its properties untouched. */
export function withBody(text: string, body: string) {
  const { head, body: old } = splitFile(text)
  if (head === null) return body
  return `${text.slice(0, text.length - old.length)}\n${body.trim()}\n`
}

export function docOf(ref: BlockRef, file: HomeFile): { doc: Doc; key: string; kind: BlockKind } {
  const node = blockOf(file)
  if (!node || !isBlockKind(node.kind)) throw new DOMException("Give a vault block file.", "DataError")
  const marks = node as { status?: string; by?: unknown }
  const props = ("post" in node ? node.post.properties : node.properties) as Record<string, unknown>
  const rawConnections = "post" in node ? node.post.connect : props.connect
  const notes = Array.isArray(props.connectionNotes) ? props.connectionNotes : []
  const connect = [rawConnections ?? []].flat().map(String).map(to => {
    const note = notes.find(value => typeof value === "string" && value.startsWith(`${to} `))
    return { to, ...(note ? { why: note.slice(to.length + 1) } : {}) }
  })
  return {
    key: nodeKey(node), kind: node.kind,
    doc: {
      id: ref.id, ...(ref.store === "sealed" && node.id ? { vaultId: node.id } : {}), kind: node.kind, slug: node.slug,
      // A file with no title property is named by its first heading, as the vault's other readers name it.
      title: node.title ?? /^#\s+(.+)$/m.exec(node.body)?.[1]?.trim() ?? "",
      homeChannel: node.home, body: node.body, channels: node.channels, visibility: ref.layer,
      connect: connect.length ? connect : undefined,
      updated: ("post" in node ? typeof props.updated === "string" ? props.updated : node.post.date : node.updated) ?? new Date().toISOString().slice(0, 10),
      ...(marks.status ? { status: marks.status as Doc["status"] } : {}),
      ...(typeof marks.by === "string" ? { by: marks.by } : {}),
      icon: typeof props.icon === "string" ? props.icon : undefined,
      platform: platformOf("post" in node ? (node.post as { source?: { platform?: unknown } }).source?.platform : undefined),
    },
  }
}

const PLATFORMS = new Set<Platform>(["bluesky", "instagram", "x"])
const platformOf = (value: unknown): Platform | undefined => {
  const name = typeof value === "string" ? value.toLowerCase() : ""
  return PLATFORMS.has(name as Platform) ? name as Platform : undefined
}
