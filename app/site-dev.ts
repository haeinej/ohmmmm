// The site editor's dev bridge (flows/site.md). Development only: it is a Vite dev-server plugin, so
// no build carries it. With VITE_OHM_SITE set to a website's folder, it serves that folder's
// published files under /site/ on the app's own origin, so the Site view can frame its pages and
// reach into them, and it writes a page back when the person saves an edit.
//
// Only files git tracks in that folder are served or written: what is not committed is not on the
// site, and may be private.
import { execFile, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import { promisify } from "node:util"
import type { Plugin } from "vite"
import { decode, htmlToMarkdown } from "../vault/mirror/html-to-markdown.mjs"
import { deploy, deployStatus } from "./site-deploy"

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

const run = promisify(execFile)

/**
 * Where the site's folder stands against its remote, as git says it: the branch, how many commits
 * it is ahead and behind, and the tracked files changed since the last commit. Untracked files are
 * left out everywhere here: what was never committed is not the site's.
 */
async function syncOf(dir: string) {
  const git = async (...args: string[]) => (await run("git", ["-C", dir, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 })).stdout
  const lines = (await git("status", "--porcelain=v2", "--branch")).split("\n")
  const head = (name: string) => lines.find(l => l.startsWith(`# branch.${name} `))?.slice(`# branch.${name} `.length)
  const [ahead, behind] = (head("ab") ?? "+0 -0").split(" ").map(n => Math.abs(Number(n)))
  const changed = lines.filter(l => /^[12u] /.test(l)).map(l => l.startsWith("2 ") ? l.split("\t")[0].split(" ").slice(9).join(" ") : l.split(" ").slice(l.startsWith("u ") ? 10 : 8).join(" "))
  let remote = ""
  try { remote = (await git("remote", "get-url", "origin")).trim().replace(/^https?:\/\/[^@/]*@/, "https://") } catch { /* a folder with no remote */ }
  return { branch: head("head") ?? "", upstream: head("upstream") ?? "", remote, ahead, behind, changed, last: (await git("log", "-1", "--format=%s")).trim() }
}

const titleOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? ""

const IMAGE = /\.(?:jpe?g|png|webp|gif|svg)$/i, VIDEO = /\.(?:mp4|mov|webm)$/i

type Item = {
  kind: "article" | "project" | "image" | "video"
  /** A file's path; a project's is its page and its place on it, `work/index.html#ohm`. */
  path: string
  title: string
  thumb?: string
  /** The start of an article or a project, as plain text: what its tile shows in miniature. */
  excerpt?: string
  /** When the file last changed on disk. */
  modified: string
  /** The pages that show this image or video: its connections, as the site itself makes them. */
  usedIn: string[]
  /** The channel inside its channel that it is filed in, if any: a place for a photograph, a series for an article. */
  channel?: string
}

const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

/** The one language a block is read in: where a page holds two side by side, the first (English). */
const firstLanguage = (html: string) => html.replace(/<(\w+)([^>]*)\slang="(?!en")[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "")

/**
 * An article as the page holds it: the first `<article>` (the page's first language), with its
 * heading taken out as the title and the line under it as the details.
 */
function articleIn(html: string) {
  const article = /<article[^>]*>[\s\S]*?<\/article>/i.exec(html)?.[0]
  if (!article) return undefined
  const header = /<header[^>]*>[\s\S]*?<\/header>/i.exec(article)?.[0] ?? ""
  const title = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] ?? "")
  const details = text(/<(?:p|div) class="(?:article-subtitle|episode-details)"[^>]*>([\s\S]*?)<\/(?:p|div)>/i.exec(article)?.[1]?.replace(/<\/span>/g, " · </span>") ?? "").replace(/ ·$/, "")
  const body = article.replace(header, "").replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "")
    .replace(/<(?:p|div) class="(?:article-subtitle|episode-details)"[^>]*>[\s\S]*?<\/(?:p|div)>/i, "")
    .replace(/<div class="source-note">[\s\S]*?<\/div>/i, "")
  return { title, details, body }
}

/** The projects a page lists: each `<details class="entry" id>` is one, its summary the title. */
function projectsIn(html: string) {
  return [...html.matchAll(/<details class="entry[^"]*" id="([^"]+)">([\s\S]*?)<\/details>/g)].map(([, id, inner]) => {
    const one = firstLanguage(inner)
    return { id, title: text(/<summary>([\s\S]*?)<\/summary>/.exec(one)?.[1] ?? id), body: one.replace(/<summary>[\s\S]*?<\/summary>/, "") }
  })
}

/** Markdown for an article's or a project's body, with each image at its own address on the site. */
function markdownOf(body: string, page: string) {
  const { markdown, images } = htmlToMarkdown(body, `https://site.invalid/${page}`) as { markdown: string; images: { id: string; url: string }[] }
  return images.reduce((md, image) => md.replaceAll(`media:${image.id}`, new URL(image.url).pathname), markdown)
}

/**
 * The site's content as channels of blocks, the way the side panel shows it. The channels are the
 * site's own three kinds of thing, read from where this site keeps each: Writings are the article
 * pages under `writing/`, Projects are the entries of `work/index.html`, and Photographs are the
 * images and videos of `archive/`. Index pages, shared parts, script sources and the pictures
 * inside an article are not blocks.
 */
async function contentOf(dir: string, files: Set<string>) {
  const read = (path: string) => readFile(join(dir, path), "utf8")
  const modified = async (path: string) => (await stat(join(dir, path))).mtime.toISOString()
  const sources = new Map<string, string>()
  for (const path of files) if (path.endsWith(".html")) sources.set(path, await read(path))

  const writings: Item[] = []
  for (const [path, html] of [...sources].sort()) {
    if (!path.startsWith("writing/") || path.endsWith("index.html") || path.startsWith("writing/substack/")) continue
    const article = articleIn(html)
    // An article in a series folder is filed in that series: `writing/series/collisions/…` is in "collisions".
    const series = /^writing\/series\/([^/]+)\//.exec(path)?.[1]
    if (article) writings.push({ kind: "article", path, title: article.title || path, excerpt: text(article.body).slice(0, 700), modified: await modified(path), usedIn: [], channel: series })
  }

  const projects: Item[] = []
  const work = sources.get("work/index.html")
  if (work) for (const project of projectsIn(work)) {
    projects.push({ kind: "project", path: `work/index.html#${project.id}`, title: project.title, excerpt: text(project.body).slice(0, 700), modified: await modified("work/index.html"), usedIn: [] })
  }

  // The archive page says where each photograph was taken (`<figure data-loc>`): that place is its channel.
  // A file's name is read without the version some pages put after it (`x.jpg?v=8848c22`).
  const places = new Map<string, string>()
  for (const [, place, file] of (sources.get("archive/index.html") ?? "").matchAll(/<figure[^>]*data-loc="([^"]*)"[^>]*>[\s\S]*?src="[^"?]*\/([^"/?]+)(?:\?[^"]*)?"/g)) places.set(file, decode(place))

  const photographs: Item[] = []
  for (const path of [...files].sort()) {
    const kind = /^archive\/img\//.test(path) && IMAGE.test(path) ? "image" : /^archive\/vid\//.test(path) && VIDEO.test(path) ? "video" : undefined
    if (!kind) continue
    const base = path.split("/").at(-1)!
    const small = `archive/${kind === "image" ? "thumb" : "vidsm"}/${base}`
    photographs.push({
      kind, path, title: base, thumb: files.has(small) ? small : kind === "image" ? path : undefined, modified: await modified(path),
      // A page names the file it shows, whatever folder it reaches it from.
      usedIn: [...sources].filter(([, html]) => html.includes(base)).map(([page]) => page),
      channel: places.get(base) || undefined,
    })
  }

  let site = ""
  try { site = (await read("CNAME")).trim() } catch { /* a site without its own domain */ }
  return { site, collections: [{ name: "Writings", items: writings }, { name: "Photographs", items: photographs }, { name: "Projects", items: projects }].filter(c => c.items.length) }
}

/** One article or project, to open in the article view: its title, the line under it, and its body as Markdown. */
async function articleOf(dir: string, files: Set<string>, path: string) {
  const [page, id] = path.split("#")
  if (!files.has(page) || !page.endsWith(".html")) return undefined
  const html = await readFile(join(dir, page), "utf8")
  if (id) {
    const project = projectsIn(html).find(p => p.id === id)
    return project && { title: project.title, details: "", markdown: markdownOf(project.body, page) }
  }
  const article = articleIn(html)
  return article && { title: article.title, details: article.details, markdown: markdownOf(article.body, page) }
}

/** The channels the person made themselves, and the dot each channel wears: kept beside the site, never part of it. */
const CHANNELS = ".ohm/channels.json"
type OwnChannels = { channels: { name: string; parent?: string; color?: string; items: string[] }[]; colors: Record<string, string> }
async function ownChannels(dir: string): Promise<OwnChannels> {
  try {
    const kept = JSON.parse(await readFile(join(dir, CHANNELS), "utf8")) as Partial<OwnChannels>
    return { channels: Array.isArray(kept.channels) ? kept.channels : [], colors: kept.colors ?? {} }
  } catch { return { channels: [], colors: {} } }
}

const PROFILE = "profile.md"
const FIELDS = ["name", "image", "handle", "did", "wallet", "color"] as const
type Profile = Record<(typeof FIELDS)[number], string> & { body: string; saved: boolean }

/**
 * The person's profile: `profile.md` in the site's folder, its identity as properties on top and
 * what they say about themselves as Markdown under them. Until it is first saved, it is what the
 * folder already says: the site's domain as the handle, and the name the pages give.
 */
async function profileOf(dir: string, files: Set<string>): Promise<Profile> {
  const profile: Profile = { name: "", image: "", handle: "", did: "", wallet: "", color: "", body: "", saved: false }
  try {
    const written = await readFile(join(dir, PROFILE), "utf8")
    const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(written)
    for (const line of (parts?.[1] ?? "").split("\n")) {
      const [, key, value] = /^(\w+):\s*(.*)$/.exec(line) ?? []
      if ((FIELDS as readonly string[]).includes(key)) { try { profile[key as (typeof FIELDS)[number]] = String(JSON.parse(value)) } catch { profile[key as (typeof FIELDS)[number]] = value } }
    }
    profile.body = (parts ? parts[2] : written).trim()
    profile.saved = true
  } catch {
    try { profile.handle = (await readFile(join(dir, "CNAME"), "utf8")).trim() } catch { /* a site without its own domain */ }
    if (files.has("index.html")) profile.name = text(/<a class="mid"[^>]*>([\s\S]*?)<\/a>/.exec(await readFile(join(dir, "index.html"), "utf8"))?.[1] ?? "")
    profile.image = ["portrait-home.jpg", "portrait.jpg"].find(f => files.has(f)) ?? ""
  }
  // Their own colour, until they choose one: the ink their site is written in.
  if (!profile.color && files.has("site-header.css")) profile.color = /--ink:\s*(#[0-9a-f]{3,8})/i.exec(await readFile(join(dir, "site-header.css"), "utf8"))?.[1] ?? ""
  return profile
}

const profileFile = (p: Profile) => `---\n${FIELDS.map(key => `${key}: ${JSON.stringify(String(p[key] ?? "").trim())}`).join("\n")}\n---\n\n${String(p.body ?? "").trim()}\n`

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

          // Anything that changes the folder comes from the app's own page: another site open in the
          // same browser can't send this header without asking first, and is refused when it asks.
          if (req.method !== "GET" && req.method !== "HEAD" && url.pathname.startsWith("/site/")) {
            const origin = req.headers.origin
            if (req.headers["x-ohm-site"] !== "1" || (origin && new URL(origin).host !== req.headers.host)) return said(403, "Only the app changes the site")
          }

          if (url.pathname.startsWith("/site/git")) {
            const git = (...args: string[]) => run("git", ["-C", dir, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 })
            const answer = async () => { res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(await syncOf(dir))) }
            const body = async () => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return JSON.parse(Buffer.concat(chunks).toString() || "{}") as { message?: string } }
            try {
              if (url.pathname === "/site/git" && req.method === "GET") return await answer()
              if (req.method !== "POST") return said(405, "Read, or ask for one step")
              if (url.pathname === "/site/git/pull") {
                // Fast-forward only: it never rewrites or merges, and git refuses if a changed file is in the way.
                await git("fetch", "origin")
                if ((await syncOf(dir)).behind) await git("merge", "--ff-only", "@{u}")
                files = tracked(dir)
                return await answer()
              }
              if (url.pathname === "/site/git/commit") {
                const message = (await body()).message?.trim()
                if (!message) return said(400, "Say what changed")
                // Tracked files only, so nothing private in the folder is ever added.
                await git("add", "-u")
                await git("commit", "-m", message)
                return await answer()
              }
              if (url.pathname === "/site/git/push") {
                await git("push", "origin", "HEAD")
                return await answer()
              }
              return said(404, "Not a step")
            } catch (problem) {
              const told = (problem as { stderr?: string }).stderr?.trim().split("\n").at(-1) || (problem as Error).message
              return said(409, told)
            }
          }

          if (url.pathname === "/site/pages" && req.method === "GET") {
            files = tracked(dir)
            const pages = await Promise.all([...files].filter(f => f.endsWith(".html")).sort().map(async path => ({ path, title: titleOf(await readFile(join(dir, path), "utf8")) })))
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify({ pages }))
          }

          if (url.pathname === "/site/deploy") {
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            if (req.method === "GET") return res.end(JSON.stringify(await deployStatus(dir)))
            if (req.method !== "POST") return said(405, "Read, or deploy")
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk as Buffer)
            try { return res.end(JSON.stringify(await deploy(dir, JSON.parse(Buffer.concat(chunks).toString() || "{}") as { project: string; commit?: string }))) }
            catch (problem) { return said(409, (problem as Error).message) }
          }

          if (url.pathname === "/site/channels") {
            if (req.method === "PUT") {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const sent = JSON.parse(Buffer.concat(chunks).toString()) as OwnChannels
              const clean: OwnChannels = {
                channels: (sent.channels ?? []).filter(c => typeof c.name === "string" && c.name.trim() && !c.name.includes("/")).slice(0, 200)
                  .map(c => ({ name: c.name.trim().slice(0, 80), parent: c.parent || undefined, color: c.color || undefined, items: [...new Set((c.items ?? []).filter(i => typeof i === "string"))] })),
                colors: Object.fromEntries(Object.entries(sent.colors ?? {}).filter(([, v]) => typeof v === "string" && v)),
              }
              await mkdir(join(dir, ".ohm"), { recursive: true })
              await writeFile(join(dir, CHANNELS), `${JSON.stringify(clean, null, 2)}\n`)
            } else if (req.method !== "GET") return said(405, "Read or save only")
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify(await ownChannels(dir)))
          }

          if (url.pathname === "/site/profile") {
            if (req.method === "PUT") {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              await writeFile(join(dir, PROFILE), profileFile(JSON.parse(Buffer.concat(chunks).toString()) as Profile))
            } else if (req.method !== "GET") return said(405, "Read or save only")
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify(await profileOf(dir, files)))
          }

          if (url.pathname === "/site/article" && req.method === "GET") {
            const article = await articleOf(dir, files, url.searchParams.get("path") ?? "")
            if (!article) return said(404, "Not an article of this site")
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            return res.end(JSON.stringify(article))
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
