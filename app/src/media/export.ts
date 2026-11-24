// A block as a file to keep: its Markdown alone, or, when it shows images, a .zip of the Markdown and
// an assets/ folder. Inside the zip each embed becomes standard Markdown, `![alt](assets/street.jpg)`,
// so any app can open it, long after the tab that made it has closed (issue #30).
import { titleOf, type Doc } from "@/data/workspace-data"
import { heldNow, original } from "./cache"
import { embeddedMedia, mediaFile, rewriteEmbeds } from "./embeds"
import { zip, type ZipEntry } from "./zip"

export type Exported = { name: string; type: string; bytes: Uint8Array; images: number; missing: string[] }

const ENDINGS: Record<string, string> = { "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }
const safe = (name: string) => (name || "Untitled block").replace(/[\\/:*?"<>|]/g, "-")
const altText = (alt: string) => alt.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ").trim()

type Asset = { target: string; name: string; hash: string; mime: string; alt: string }

/** Which images go into assets/, each under a name of its own. */
function assetsOf(doc: Doc, markdown: string): Asset[] {
  const names = new Set<string>()
  return embeddedMedia(doc, markdown).map(({ target, media }) => {
    const file = mediaFile(media) ?? `${media.slug}.${ENDINGS[media.media.mime] ?? "bin"}`
    let name = file
    for (let n = 2; names.has(name); n++) name = file.replace(/(\.[^.]+)?$/, `-${n}$1`)
    names.add(name)
    return { target, name, hash: media.media.hash, mime: media.media.mime, alt: media.media.alt ?? titleOf(media) }
  })
}

function build(doc: Doc, markdown: string, assets: Asset[], bytes: Map<string, { bytes: Uint8Array; crc: number }>): Exported {
  const base = safe(doc.title)
  const kept = assets.filter(asset => bytes.has(asset.hash))
  const missing = assets.filter(asset => !bytes.has(asset.hash)).map(asset => asset.target)
  if (!kept.length) return { name: `${base}.md`, type: "text/markdown", bytes: new TextEncoder().encode(markdown), images: 0, missing }
  const byTarget = new Map(kept.map(asset => [asset.target, asset]))
  const text = rewriteEmbeds(markdown, inner => {
    const asset = byTarget.get(inner.split(/[|#]/)[0].trim())
    return asset && `![${altText(asset.alt)}](assets/${encodeURI(asset.name)})`
  })
  const entries: ZipEntry[] = [
    { name: `${base}.md`, bytes: new TextEncoder().encode(text) },
    ...kept.map(asset => ({ name: `assets/${asset.name}`, ...bytes.get(asset.hash)! })),
  ]
  return { name: `${base}.zip`, type: "application/zip", bytes: zip(entries), images: kept.length, missing }
}

/**
 * The export, put together at once from what this tab holds, as a drag needs it. Null when an image
 * it shows is not loaded yet; `preload` loads them.
 */
export function exportNow(doc: Doc, markdown: string): Exported | null {
  const assets = assetsOf(doc, markdown)
  const bytes = new Map<string, { bytes: Uint8Array; crc: number }>()
  for (const asset of assets) {
    const held = heldNow(asset.hash)
    if (!held) return null
    bytes.set(asset.hash, held)
  }
  return build(doc, markdown, assets, bytes)
}

/** The export, after reading the images from the media cache. An image this device lacks is listed in `missing`, and its embed kept as written. */
export async function exportBlock(doc: Doc, markdown: string): Promise<Exported> {
  const assets = assetsOf(doc, markdown)
  const bytes = new Map<string, { bytes: Uint8Array; crc: number }>()
  for (const asset of assets) {
    const held = await original(asset.hash, asset.mime)
    if (held) bytes.set(asset.hash, held)
  }
  return build(doc, markdown, assets, bytes)
}

/** Loads the originals a body shows into this tab, so a drag can export them at once. */
export async function preload(doc: Doc, markdown = doc.body) {
  await Promise.all(assetsOf(doc, markdown).map(asset => original(asset.hash, asset.mime)))
}
