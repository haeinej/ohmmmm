// What a body may hold for an image, and what it may not. An image is a media block of its own
// (vault/plans/media.md); a text shows it with `![[slug]]`, and the media block's own body embeds
// its file, `![[street.jpg]]`. A temporary browser address (`blob:` or `data:`) never reaches a save.
import { blocks, isBlock, type Doc } from "@/data/workspace-data"

/** `![[target]]`, `![[target|words]]` and `![[target#part]]`, as the vault reads them. */
export const EMBED = /!\[\[([^\]\n]+)\]\]/g
/** What an embed points at: the part before `|` or `#`. */
export const embedTarget = (inner: string) => inner.split(/[|#]/)[0].trim()

/** A body's lines with fenced code left out, and code spans blanked, so examples in code are ignored. */
function prose(body: string) {
  const out: string[] = []
  let fence: string | null = null
  for (const line of body.split("\n")) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) fence = null
    } else if (mark) fence = mark
    else out.push(line.replace(/`+[^`\n]*`+/g, " "))
  }
  return out.join("\n")
}

const TEMPORARY = /(?:\]\(\s*<?|\b(?:src|href)\s*=\s*["']?)\s*((?:blob|data):[^\s)"'>]*)/gi

/** Every temporary browser address a body uses as an image or link, outside code. */
export const temporaryAddresses = (body: string) =>
  [...prose(body).matchAll(TEMPORARY)].map(match => match[1])

/** Refuses a body that would lose its images when this tab closes. */
export function assertDurable(body: string) {
  const found = temporaryAddresses(body)
  if (!found.length) return
  const shown = found[0].length > 40 ? `${found[0].slice(0, 40)}…` : found[0]
  throw new DOMException(
    `This block holds an image or link at a temporary address (${shown}), which stops working when the tab closes. Add the image again so it is kept as a media block.`,
    "DataError")
}

/** The body with each embed outside code replaced by what `replace` gives, or kept when it gives nothing. */
export function rewriteEmbeds(body: string, replace: (inner: string) => string | undefined) {
  let fence: string | null = null
  return body.split("\n").map(line => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) fence = null
      return line
    }
    if (mark) { fence = mark; return line }
    return line.replace(EMBED, (whole, inner: string) => replace(inner) ?? whole)
  }).join("\n")
}

/** An embed typed inside a line, `![[street.jpg]]`, comes back from the serializer escaped as well. */
export const unescapeEmbeds = (md: string) =>
  md.replace(/!\\\[\\\[((?:[^\]\n\\]|\\.)+?)\\\]\\\]/g, (_, inner: string) => `![[${inner.replace(/\\(.)/g, "$1")}]]`)

/** The targets a body embeds, outside code, in order. */
export const embedsIn = (body: string) => [...prose(body).matchAll(EMBED)].map(match => embedTarget(match[1]))

/** A media block's file: the one file its body embeds. */
export function mediaFile(doc: Doc) {
  const [file] = embedsIn(doc.body)
  return file && /\.[A-Za-z0-9]{1,5}$/.test(file) ? file : undefined
}

/**
 * What an embed shows: a block by slug, a media block by its file's name, or a block by title, in
 * that order, as the vault resolves names. A media block in `prefer` (the embedding block's channel)
 * wins when two have the same file name.
 */
export function resolveEmbed(target: string, prefer?: string): Doc | undefined {
  const name = target.trim()
  const lower = name.toLowerCase()
  const vaultBlocks = blocks.filter(isBlock)
  const bySlug = vaultBlocks.find(doc => doc.slug === lower.replace(/\.md$/, ""))
  if (bySlug) return bySlug
  const byFile = vaultBlocks.filter(doc => doc.media && mediaFile(doc)?.toLowerCase() === lower)
  if (byFile.length) return byFile.find(doc => doc.homeChannel === prefer) ?? byFile[0]
  return vaultBlocks.find(doc => doc.title.toLowerCase() === lower)
}

/** The media blocks a body shows, each once, with the file name it keeps in an export. */
export function embeddedMedia(doc: Doc, body = doc.body) {
  const seen = new Set<string>()
  const out: { target: string; media: Doc & { media: NonNullable<Doc["media"]> } }[] = []
  for (const target of embedsIn(body)) {
    const found = resolveEmbed(target, isBlock(doc) ? doc.homeChannel : undefined)
    if (!found?.media || seen.has(target)) continue
    seen.add(target)
    out.push({ target, media: found as Doc & { media: NonNullable<Doc["media"]> } })
  }
  return out
}
