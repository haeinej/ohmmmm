// The browser's media cache: image bytes by their CID, so an image outlives the tab that added it and
// a block refers to it by name, never by a temporary browser address. The CID is the vault's own
// `blobCid` (CIDv1, raw, SHA-256), the same name AT Protocol gives a blob, so the same bytes have the
// same name in the home folder, here, on the vault service and on a PDS (vault/plans/media.md).
//
//   ohm-media (IndexedDB)   <cid>          the original
//                           <cid>@<width>  a size, made here and rebuilt when missing
//
// Bytes seen in this tab are also held in memory with their CRC-32, so an export can be put together
// at once, inside a drag, without waiting on storage.
import { blobCid } from "../../../vault/vault/core.mjs"
import { crc32 } from "./zip"

/** Where the cache keeps bytes between tabs. Tests give their own. */
export interface MediaBackend {
  read(name: string): Promise<Uint8Array | undefined>
  write(name: string, bytes: Uint8Array): Promise<void>
}

export const WIDTHS = [320, 960, 1920] as const
const DB = "ohm-media"
const STORE = "bytes"

export const memoryBackend = (held = new Map<string, Uint8Array>()): MediaBackend => ({
  async read(name) { return held.get(name) },
  async write(name, bytes) { held.set(name, bytes) },
})

function indexedBackend(): MediaBackend {
  let db: Promise<IDBDatabase> | null = null
  const open = () => db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const run = <T,>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) => open().then(base =>
    new Promise<T>((resolve, reject) => {
      const request = act(base.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }))
  return {
    async read(name) {
      const value = await run<unknown>("readonly", store => store.get(name))
      return value instanceof ArrayBuffer ? new Uint8Array(value) : value instanceof Uint8Array ? value : undefined
    },
    async write(name, bytes) { await run("readwrite", store => store.put(bytes.slice().buffer, name)) },
  }
}

const defaultBackend = (): MediaBackend => typeof indexedDB === "undefined" ? memoryBackend() : indexedBackend()
let backend = defaultBackend()

/** Where an original is looked for last, by its CID: the home folder, through `ohmmmm serve` (src/data/bridge.ts). */
export type MediaRemote = (cid: string) => Promise<{ bytes: Uint8Array; type: string } | undefined>
let remote: MediaRemote | undefined
export const setMediaRemote = (next?: MediaRemote) => { remote = next }
let asked = false

/** What this tab holds: bytes, their type and CRC, and the object URL showing them, by name. */
type Held = { bytes: Uint8Array; type: string; crc: number; url?: string }
const held = new Map<string, Held>()

const hold = (name: string, bytes: Uint8Array, type: string): Held => {
  const each = { bytes, type, crc: crc32(bytes) }
  held.set(name, each)
  return each
}

/** Swaps where bytes are kept, and forgets what this tab held: a closed tab, in a test. */
export function setMediaBackend(next?: MediaBackend) {
  for (const each of held.values()) if (each.url) URL.revokeObjectURL(each.url)
  held.clear()
  backend = next ?? defaultBackend()
}

export const cidOf = (bytes: Uint8Array): Promise<string> => blobCid(bytes)

/** Keeps an original, and returns its CID. Asks once for storage the browser will not clear by itself. */
export async function keep(bytes: Uint8Array, type: string): Promise<string> {
  const cid = await cidOf(bytes)
  hold(cid, bytes, type)
  if (!asked && typeof navigator !== "undefined" && navigator.storage?.persist) {
    asked = true
    void navigator.storage.persist().catch(() => false)
  }
  await backend.write(cid, bytes)
  return cid
}

/**
 * An original or a size, from this tab or from storage; an original this browser lacks, from the home
 * folder. Bytes from elsewhere are kept only when they are what their CID says.
 */
async function load(name: string, type: string): Promise<Held | undefined> {
  const here = held.get(name)
  if (here) return here
  const bytes = await backend.read(name)
  if (bytes) return hold(name, bytes, type)
  if (!remote || name.includes("@")) return undefined
  const fetched = await remote(name).catch(() => undefined)
  if (!fetched || await cidOf(fetched.bytes) !== name) return undefined
  await backend.write(name, fetched.bytes)
  return hold(name, fetched.bytes, fetched.type || type)
}

/** The original's bytes, if this device has them. */
export const original = (cid: string, type: string) => load(cid, type)
/** The original's bytes, only if this tab already holds them. */
export const heldNow = (cid: string) => held.get(cid)

/**
 * A URL that shows the image: the smallest size at least `width` wide, or the original. It is only
 * ever used to show an image; a block names the image by its CID.
 */
export async function urlFor(cid: string, type: string, width?: number): Promise<string | undefined> {
  const wanted = width ? WIDTHS.filter(each => each >= width) : []
  for (const each of wanted) {
    const size = await load(`${cid}@${each}`, "image/webp")
    if (size) return size.url ??= URL.createObjectURL(new Blob([size.bytes.slice()], { type: size.type }))
  }
  const full = await load(cid, type)
  return full && (full.url ??= URL.createObjectURL(new Blob([full.bytes.slice()], { type: full.type })))
}

/** The pixel size of an image, where this browser can read it. */
export async function measure(bytes: Uint8Array, type: string): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap === "undefined") return undefined
  try {
    const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type }))
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch { return undefined }
}

/**
 * Makes the sizes smaller than the original, as WebP where the browser can write it, and keeps them
 * beside it. The service never resizes, so this is the one place sizes are made. Returns the widths
 * made; none where the browser has no canvas.
 */
export async function makeSizes(cid: string, bytes: Uint8Array, type: string): Promise<number[]> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return []
  const made: number[] = []
  try {
    const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type }))
    for (const width of WIDTHS) {
      if (width >= bitmap.width) break
      const height = Math.max(1, Math.round(bitmap.height * width / bitmap.width))
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 })
      const size = new Uint8Array(await blob.arrayBuffer())
      hold(`${cid}@${width}`, size, blob.type)
      await backend.write(`${cid}@${width}`, size)
      made.push(width)
    }
    bitmap.close()
  } catch { /* sizes are a convenience; the original is kept either way */ }
  return made
}

/**
 * The vault service's name for bytes (`sha256-<hex>`, source.ts `mediaName`) from their CID here: a
 * raw CIDv1 is `b` and base32 of [1, 0x55, 0x12, 0x20, ...the SHA-256 digest], so both name the same digest.
 */
export function serviceNameOf(cid: string): string {
  // Already the service's name: a media record read from the service keeps it as its hash.
  if (/^sha256-[0-9a-f]{64}$/.test(cid)) return cid
  if (!/^b[a-z2-7]+$/.test(cid)) throw new DOMException("Not a CID", "DataError")
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567"
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const char of cid.slice(1)) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  if (bytes.length !== 36 || bytes[0] !== 1 || bytes[1] !== 0x55 || bytes[2] !== 0x12 || bytes[3] !== 0x20) throw new DOMException("Not a raw SHA-256 CID", "DataError")
  return `sha256-${bytes.slice(4).map(byte => byte.toString(16).padStart(2, "0")).join("")}`
}
