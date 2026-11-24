import { isPostId, writeNoteFile } from "../../../vault/vault/file.mjs"
import { nodeKey } from "../../../vault/vault/node.mjs"
import { isBlockKind, type BlockKind } from "./block-kind"
import { blockOf, type BlockRef, type HomeFile } from "./source"
import { isBlock, type Doc, type Media, type Platform } from "./workspace-model"

/** A media block's image, read from its properties: none without a CID and a type. */
function mediaOf(props: Record<string, unknown>): Media | undefined {
  if (typeof props.hash !== "string" || typeof props.mime !== "string") return undefined
  const size = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
  return {
    hash: props.hash, mime: props.mime,
    ...(size(props.width) && size(props.height) ? { width: size(props.width), height: size(props.height) } : {}),
    ...(typeof props.alt === "string" && props.alt ? { alt: props.alt } : {}),
  }
}

export function fileOf(doc: Doc): HomeFile {
  if (!isBlock(doc)) throw new DOMException("Give a vault block.", "DataError")
  return {
    path: `${doc.homeChannel}/${doc.slug}.md`,
    text: writeNoteFile({
      properties: {
        id: isPostId(doc.id) ? doc.id : undefined, kind: doc.visibility === "private" && doc.kind === "post" ? "text" : doc.kind,
        title: doc.title, slug: doc.slug, channels: doc.channels, visibility: doc.visibility,
        updated: doc.updated, connect: doc.connect?.map(each => each.to), icon: doc.icon, samplePlatform: doc.platform,
        connectionNotes: doc.connect?.filter(each => each.why).map(each => `${each.to} ${each.why}`),
        alt: doc.media?.alt, hash: doc.media?.hash, mime: doc.media?.mime, width: doc.media?.width, height: doc.media?.height,
      },
      body: doc.body,
    }),
  }
}

export function docOf(ref: BlockRef, file: HomeFile): { doc: Doc; key: string; kind: BlockKind } {
  const node = blockOf(file)
  if (!node || !isBlockKind(node.kind)) throw new DOMException("Give a vault block file.", "DataError")
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
      id: ref.id, kind: node.kind, slug: node.slug, title: node.title ?? "",
      homeChannel: node.home, body: node.body, channels: node.channels, visibility: ref.layer,
      connect: connect.length ? connect : undefined,
      updated: ("post" in node ? typeof props.updated === "string" ? props.updated : node.post.date : node.updated) ?? new Date().toISOString().slice(0, 10),
      icon: typeof props.icon === "string" ? props.icon : undefined,
      platform: typeof props.samplePlatform === "string" ? props.samplePlatform as Platform : undefined,
      media: mediaOf(props),
    },
  }
}
