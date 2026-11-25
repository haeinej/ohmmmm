// The site editor's dev bridge (flows/site.md). Development only: it is a Vite dev-server plugin, so
// no build carries it. With VITE_OHM_SITE set to a website's folder, it serves that folder's
// published files under /site/ on the app's own origin, so the Site view can frame its pages and
// reach into them, and it writes a page back when the person saves an edit.
//
// Only files git tracks in that folder are served or written: what is not committed is not on the
// site, and may be private.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import type { Plugin } from "vite"

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".woff": "font/woff", ".woff2": "font/woff2",
}

/** The app's own addresses, which a site file of the same name never takes over. */
const APP_PATHS = /^\/(?:$|index\.html$|src\/|@|node_modules\/|site\/)/

export const etagOf = (text: string | Buffer) => `"${createHash("sha256").update(text).digest("hex")}"`

function tracked(dir: string): Set<string> {
  const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return new Set(out.split("\0").filter(Boolean))
}

/** `/writing/` and `/writing` both mean `writing/index.html`, as on a static host. */
function fileFor(files: Set<string>, pathname: string): string | undefined {
  let path: string
  try { path = decodeURIComponent(pathname).replace(/^\/+/, "") } catch { return undefined }
  if (path.split("/").some(part => part === ".." || part.startsWith("."))) return undefined
  for (const candidate of [path, `${path.replace(/\/$/, "")}/index.html`.replace(/^\//, ""), `${path}.html`]) {
    if (files.has(candidate)) return candidate
  }
  return undefined
}

const titleOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? ""

const IMAGE = /\.(?:jpe?g|png|webp|gif|svg)$/i, VIDEO = /\.(?:mp4|mov|webm)$/i
/** Folders that hold smaller copies of what is beside them: a variant of an item, not an item. */
const VARIANTS = /(?:^|\/)(?:thumbs?|vidsm)\//

type Item = {
  kind: "page" | "image" | "video"; path: string; title: string; thumb?: string; excerpt?: string
  /** When the file last changed on disk. */
  modified: string
  /** The pages that show this image or video: its connections, as the site itself makes them. */
  usedIn: string[]
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", copy: "©", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" }

/** The start of what a page says, as plain text: what its tile shows in miniature. */
function excerptOf(html: string) {
  const body = /<article[\s\S]*<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? ""
  return body.replace(/<(script|style|nav|header|footer|aside|svg|h1|button)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|h[2-6]|li|div|section)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&(\w+);/g, (all, name) => ENTITIES[name] ?? all)
    .split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, 700)
}

/**
 * The site's content as collections of items, the way the side panel shows it: a collection is a
 * top folder (the site's own pages are the first), and an item is a page, an image or a video.
 */
async function contentOf(dir: string, files: Set<string>) {
  const collections = new Map<string, Item[]>()
  const sources = new Map<string, string>()
  for (const path of files) if (path.endsWith(".html")) sources.set(path, await readFile(join(dir, path), "utf8"))
  for (const path of [...files].sort()) {
    if (VARIANTS.test(path)) continue
    const kind = path.endsWith(".html") ? "page" : IMAGE.test(path) ? "image" : VIDEO.test(path) ? "video" : undefined
    if (!kind) continue
    const name = path.includes("/") ? path.split("/")[0] : ""
    const base = path.split("/").at(-1)!
    const html = sources.get(path) ?? ""
    const item: Item = {
      kind, path, title: kind === "page" ? titleOf(html) || path : base,
      modified: (await stat(join(dir, path))).mtime.toISOString(),
      // A page names the file it shows, whatever folder it reaches it from.
      usedIn: kind === "page" ? [] : [...sources].filter(([, text]) => text.includes(base)).map(([page]) => page),
    }
    if (kind === "page") item.excerpt = excerptOf(html)
    if (kind === "video") {
      const small = path.replace(/[^/]+\/([^/]+)$/, "vidsm/$1")
      if (files.has(small)) item.thumb = small
    }
    if (kind === "image") {
      const small = path.replace(/[^/]+\/([^/]+)$/, "thumb/$1")
      item.thumb = files.has(small) ? small : path
    }
    collections.set(name, [...(collections.get(name) ?? []), item])
  }
  let site = ""
  try { site = (await readFile(join(dir, "CNAME"), "utf8")).trim() } catch { /* a site without its own domain */ }
  return { site, collections: [...collections].map(([name, items]) => ({ name, items })) }
}

export function siteDev(): Plugin {
  const dir = process.env.VITE_OHM_SITE ? resolve(process.env.VITE_OHM_SITE) : undefined
  return {
    name: "ohm-site-dev",
    apply: "serve",
    configureServer(server) {
      if (!dir) return
      let files = tracked(dir)
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost")
          const said = (status: number, message: string) => { res.statusCode = status; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end(message) }

          if (url.pathname === "/site/pages" && req.method === "GET") {
            files = tracked(dir)
            const pages = await Promise.all([...files].filter(f => f.endsWith(".html")).sort().map(async path => ({ path, title: titleOf(await readFile(join(dir, path), "utf8")) })))
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify({ pages }))
          }

          if (url.pathname === "/site/content" && req.method === "GET") {
            files = tracked(dir)
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify(await contentOf(dir, files)))
          }

          const inSite = url.pathname.startsWith("/site/")
          // A page under /site/ asks for `/writing/media/x.jpg` by its own root: answer those too.
          if (!inSite && (APP_PATHS.test(url.pathname) || req.method !== "GET")) return next()
          const file = fileFor(files, inSite ? url.pathname.slice("/site".length) : url.pathname)
          if (!file) return inSite ? said(404, "Not a page of this site") : next()
          const full = join(dir, file)

          if (req.method === "PUT") {
            if (!file.endsWith(".html")) return said(405, "Only pages can be saved")
            const held = etagOf(await readFile(full))
            if (req.headers["if-match"] !== held) return said(412, "This page changed on disk since it was read")
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk as Buffer)
            const text = Buffer.concat(chunks)
            await writeFile(full, text)
            res.setHeader("ETag", etagOf(text))
            return said(200, "Saved")
          }
          if (req.method !== "GET" && req.method !== "HEAD") return said(405, "Read or save only")

          const body = await readFile(full)
          res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream")
          res.setHeader("Content-Length", (await stat(full)).size)
          res.setHeader("Cache-Control", "no-store")
          if (file.endsWith(".html")) res.setHeader("ETag", etagOf(body))
          return res.end(req.method === "HEAD" ? undefined : body)
        } catch (problem) {
          next(problem)
        }
      })
    },
  }
}
