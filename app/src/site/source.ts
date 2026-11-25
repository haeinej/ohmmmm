import { bridgeFetch } from "@/data/bridge"

// A page's file, and one edit to it (flows/site.md). The Site view shows a page as the browser
// rendered it, but what is saved is the page's own file, changed in one place and nowhere else:
// the text of one element, found in the file by what it says.

export type SitePage = { path: string; title: string }

/** Ways a character in rendered text may be written in a page's file. */
const WRITTEN: Record<string, string> = {
  "&": "(?:&amp;|&)", "<": "&lt;", ">": "&gt;", " ": "(?:&nbsp;|&#160;| )", "©": "(?:&copy;|©)",
  "'": "(?:&#39;|&apos;|')", "\"": "(?:&quot;|\")", "’": "(?:&rsquo;|’)", "‘": "(?:&lsquo;|‘)", "“": "(?:&ldquo;|“)", "”": "(?:&rdquo;|”)",
  "—": "(?:&mdash;|—)", "–": "(?:&ndash;|–)", "…": "(?:&hellip;|…)",
}

/** Rendered text as one line: what two spellings of the same text have in common. */
export const plain = (text: string) => text.replace(/\s+/g, " ").trim()

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function pattern(text: string) {
  const body = [...plain(text)].map(ch => ch === " " ? "\\s+" : WRITTEN[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")
  return new RegExp(`(>\\s*)${body}(\\s*<)`, "g")
}

export class EditProblem extends Error {}

/**
 * Change the text of one element in a page's file. `before` is what the element said, `nth` says
 * which of the elements saying exactly that it is (0 is the first), and `count` is how many say it
 * on the rendered page. When the file does not hold the same number, the page builds that text
 * some other way (a script, or markup inside it), and nothing is changed.
 */
export function replaceText(source: string, before: string, after: string, nth = 0, count?: number): string {
  if (!plain(before)) throw new EditProblem("There is no text here to change")
  const found = [...source.matchAll(pattern(before))]
  if (!found.length) throw new EditProblem("This text isn't written in the page's file as it shows here, so it can't be changed in place")
  if (count !== undefined && found.length !== count) throw new EditProblem("The page shows this text a different number of times than its file holds it, so the place to change isn't certain")
  const at = found[nth]
  if (!at) throw new EditProblem("That place isn't in the page's file")
  const written = `${at[1]}${escapeHtml(plain(after))}${at[2]}`
  return source.slice(0, at.index) + written + source.slice(at.index! + at[0].length)
}

/** Where a block sits on the site, as its pages write it: from the site's root. */
export const addressOf = (path: string) => `/${path.replace(/(^|\/)index\.html(?=#|$)/, "$1")}`

/**
 * Put markup after one element in a page's file: the element that says `anchor`, found as
 * `replaceText` finds it. The new line takes the indentation of the line it follows.
 */
export function insertAfter(source: string, anchor: string, html: string, nth = 0, count?: number): string {
  if (!plain(anchor)) throw new EditProblem("There is no text here to put it after")
  const found = [...source.matchAll(pattern(anchor))]
  if (!found.length) throw new EditProblem("This text isn't written in the page's file as it shows here, so nothing can be placed after it")
  if (count !== undefined && found.length !== count) throw new EditProblem("The page shows this text a different number of times than its file holds it, so the place isn't certain")
  const at = found[nth]
  if (!at) throw new EditProblem("That place isn't in the page's file")
  const closing = at.index! + at[0].length - 1
  if (!source.startsWith("</", closing)) throw new EditProblem("This element holds more than text in the page's file, so the place after it isn't certain")
  const end = source.indexOf(">", closing) + 1
  const indent = /(?:^|\n)([ \t]*)[^\n]*$/.exec(source.slice(0, at.index))?.[1] ?? ""
  return `${source.slice(0, end)}\n${indent}${html}${source.slice(end)}`
}

/** Point one image of a page at another file: the one whose `src` is written exactly as `from`. */
export function replaceSrc(source: string, from: string, to: string): string {
  const written = [`src="${from}"`, `src='${from}'`].filter(each => source.includes(each))
  const places = written.reduce((n, each) => n + source.split(each).length - 1, 0)
  if (places === 0) throw new EditProblem("This image isn't written in the page's file as it shows here, so it can't be swapped in place")
  if (places > 1) throw new EditProblem("The page's file names this image more than once, so which one to swap isn't certain")
  return source.replace(written[0], `${written[0].slice(0, 5)}${to}${written[0].at(-1)}`)
}

/** One move in a gallery's order: the photograph `key` (its file's name) goes before `before`, or to the end. */
export type Move = { key: string; before: string | null }

const FIGURE = /<figure\b[^>]*class="item[^"]*"[\s\S]*?<\/figure>/g
const keyOf = (figure: string) => /src="[^"?]*?([^"/?]+)(?:\?[^"]*)?"/.exec(figure)?.[1] ?? ""

/**
 * Put a gallery's photographs in a new order in the page's file. Each photograph is a
 * `<figure class="item">`; the figures trade places among the places figures already have, so
 * whatever lies between them (cards a script writes, comments) stays where it is.
 */
export function reorderFigures(source: string, moves: Move[]): string {
  const found = [...source.matchAll(FIGURE)]
  const order = found.map(f => keyOf(f[0]))
  const chunk = new Map(found.map(f => [keyOf(f[0]), f[0]]))
  for (const move of moves) {
    const from = order.indexOf(move.key)
    if (from < 0) throw new EditProblem(`${move.key} isn't in the page's file`)
    order.splice(from, 1)
    const to = move.before === null ? order.length : order.indexOf(move.before)
    if (to < 0) throw new EditProblem(`${move.before} isn't in the page's file`)
    order.splice(to, 0, move.key)
  }
  let out = "", at = 0
  found.forEach((f, i) => { out += source.slice(at, f.index) + chunk.get(order[i])!; at = f.index! + f[0].length })
  return out + source.slice(at)
}

/** One change to a page's file. */
export type Change =
  | { type: "order"; moves: Move[] }
  | { type: "text"; before: string; after: string; nth?: number; count?: number }
  | { type: "insert"; anchor: string; html: string; nth?: number; count?: number }
  | { type: "src"; from: string; to: string }

export function applyChange(source: string, change: Change): string {
  if (change.type === "text") return replaceText(source, change.before, change.after, change.nth, change.count)
  if (change.type === "order") return reorderFigures(source, change.moves)
  if (change.type === "insert") return insertAfter(source, change.anchor, change.html, change.nth, change.count)
  return replaceSrc(source, change.from, change.to)
}

/** A block as markup a page can hold: an image, a video, or a link to an article or a project. */
export function markupFor(item: Pick<SiteItem, "kind" | "path" | "title">): string {
  const at = escapeHtml(addressOf(item.path)).replace(/"/g, "&quot;")
  if (item.kind === "image") return `<img src="${at}" alt="" loading="lazy">`
  if (item.kind === "video") return `<video src="${at}" controls playsinline></video>`
  return `<p><a href="${at}">${escapeHtml(plain(item.title))}</a></p>`
}

export type SiteItem = { kind: "article" | "project" | "image" | "video"; path: string; title: string; thumb?: string; excerpt?: string; modified: string; usedIn: string[]; channel?: string }
export type SiteContent = { site: string; collections: { name: string; items: SiteItem[] }[] }

/** The channels inside a channel, in the order their first block appears, each with its blocks. */
export function channelsIn(items: SiteItem[]): { name: string; items: SiteItem[] }[] {
  const found = new Map<string, SiteItem[]>()
  for (const item of items) if (item.channel) found.set(item.channel, [...(found.get(item.channel) ?? []), item])
  return [...found].map(([name, list]) => ({ name, items: list }))
}

/** The channels the person made themselves, and the dot each channel wears (home/site.mjs). */
export type OwnChannel = { name: string; parent?: string; color?: string; items: string[] }
export type OwnChannels = { channels: OwnChannel[]; colors: Record<string, string> }

export async function readOwnChannels(): Promise<OwnChannels> {
  const res = await bridgeFetch("/site/channels", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as OwnChannels
}

export async function saveOwnChannels(own: OwnChannels): Promise<OwnChannels> {
  const res = await bridgeFetch("/site/channels", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(own) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as OwnChannels
}

export async function readContent(): Promise<SiteContent> {
  const res = await bridgeFetch("/site/content")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return (await res.json()) as SiteContent
}

/** Ask the Site view to bring a page's frame into view. The side panel's tiles use it. */
export const OPEN_PAGE = "ohm:site-open-page"
export const askToOpen = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: path }))

/** The person's profile (home/site.mjs `profileOf`): identity as fields, and what they say about themselves as Markdown. */
export type SiteProfile = { name: string; image: string; handle: string; did: string; wallet: string; color: string; body: string; saved: boolean }

export async function readProfile(): Promise<SiteProfile> {
  const res = await bridgeFetch("/site/profile", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteProfile
}

export async function saveProfile(profile: SiteProfile): Promise<SiteProfile> {
  const res = await bridgeFetch("/site/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) })
  if (!res.ok) throw new Error(await res.text())
  const saved = (await res.json()) as SiteProfile
  window.dispatchEvent(new CustomEvent(PROFILE_SAVED, { detail: saved }))
  return saved
}
export const PROFILE_SAVED = "ohm:site-profile-saved"
/** Ask the Site view to open the profile over the canvas. */
export const OPEN_PROFILE = "ohm:site-open-profile"
export const askToOpenProfile = () => window.dispatchEvent(new CustomEvent(OPEN_PROFILE))
/** A picture named in the profile: a web address as it is, or a file of the site. */
export const pictureUrl = (image: string) => /^https?:\/\//.test(image) ? image : image ? siteUrl(image.replace(/^\//, "")) : ""

/** An article or a project as writing: its title, the line under it, and its body as Markdown. */
export type SiteArticle = { title: string; details: string; markdown: string }

export async function readArticle(path: string): Promise<SiteArticle> {
  const res = await bridgeFetch(`/site/article?path=${encodeURIComponent(path)}`, { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteArticle
}

/** Ask the Site view to open one block, by its path, over the canvas. */
export const OPEN_BLOCK = "ohm:site-open-block"
export const askToOpenBlock = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_BLOCK, { detail: path }))

export const siteUrl = (path: string) => `/site/${path.split("/").map(encodeURIComponent).join("/")}`

export async function listPages(): Promise<SitePage[]> {
  const res = await bridgeFetch("/site/pages")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return ((await res.json()) as { pages: SitePage[] }).pages
}

/** Where the site's folder stands against its remote (home/site.mjs `syncOf`). */
export type SiteSync = { branch: string; upstream: string; remote: string; ahead: number; behind: number; changed: string[]; last: string }

export async function readSync(): Promise<SiteSync> {
  const res = await bridgeFetch("/site/git", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteSync
}

/** One git step on the site's folder: bring the remote's commits in, commit what changed, or send commits out. */
export async function syncStep(step: "pull" | "commit" | "push", message?: string): Promise<SiteSync> {
  const res = await bridgeFetch(`/site/git/${step}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteSync
}

/** One deploy to Cloudflare, as the folder remembers it (home/site.mjs). */
export type Deployed = { at: string; commit: string; subject: string; branch: string; project: string; url: string; production: boolean }
/** Where a deploy would go and what it would carry (home/site.mjs `deployStatus`). */
export type DeployStatus = {
  signedIn: boolean; account: string; problem: string; projects: string[]; project: string; exists: boolean; productionBranch: string
  branch: string; commit: string; subject: string; changed: number; production: boolean; domain: string; history: Deployed[]
}

export async function readDeploy(): Promise<DeployStatus> {
  const res = await bridgeFetch("/site/deploy", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as DeployStatus
}

/** Deploy this branch's head to a Cloudflare Pages project, or put an earlier commit back. The person's own step. */
export async function deploySite(project: string, commit?: string): Promise<Deployed> {
  const res = await bridgeFetch("/site/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, commit }) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as Deployed
}

/** Save one change to a page's file. It refuses to write over a file that changed on disk. */
export async function saveChange(page: string, change: Change): Promise<void> {
  const url = `/site/file/${page.split("/").map(encodeURIComponent).join("/")}?via=canvas`
  const read = await bridgeFetch(url, { cache: "no-store" })
  if (!read.ok) throw new EditProblem("That page isn't in the site")
  const next = applyChange(await read.text(), change)
  const wrote = await bridgeFetch(url, { method: "PUT", headers: { "If-Match": read.headers.get("ETag") ?? "" }, body: next })
  if (wrote.status === 412) throw new EditProblem("This page changed on disk since it was read. Reload it and try again")
  if (!wrote.ok) throw new EditProblem("The page couldn't be saved")
  saved()
}

// ---- Files: every tracked file of the site (flows/site.md, Files) ----

/** One tracked file: changed since the last publish, used by the site, and whether it reads as text. */
export type SiteFile = { path: string; changed: boolean; used: boolean; text: boolean }

export async function readTree(): Promise<SiteFile[]> {
  const res = await bridgeFetch("/site/tree", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return ((await res.json()) as { files: SiteFile[] }).files
}

const fileAddress = (path: string) => `/site/file/${path.split("/").map(encodeURIComponent).join("/")}`

/** A file's text and the version it was read at. */
export async function readFileText(path: string): Promise<{ text: string; version: string }> {
  const res = await bridgeFetch(fileAddress(path), { cache: "no-store" })
  if (!res.ok) throw new EditProblem("That file isn't in the site")
  return { text: await res.text(), version: res.headers.get("ETag") ?? "" }
}

/** Save a file's whole text, over the version read: an ordinary save, logged, never published by itself. */
export async function saveFileText(path: string, text: string, version: string): Promise<string> {
  const res = await bridgeFetch(`${fileAddress(path)}?via=editor`, { method: "PUT", headers: { "If-Match": version }, body: text })
  if (res.status === 412) throw new EditProblem("This file changed on disk since it was read. Open it again to see the change")
  if (!res.ok) throw new EditProblem(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The file couldn't be saved")
  saved()
  return res.headers.get("ETag") ?? ((await res.json()) as { etag: string }).etag
}

/** Move or rename a file, as a save. */
export async function moveSiteFile(from: string, to: string): Promise<void> {
  const res = await bridgeFetch("/site/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) })
  if (!res.ok) throw new EditProblem(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The file couldn't be moved")
  saved()
}

/** Ask the Site view to open a file in the text editor. */
export const OPEN_FILE = "ohm:site-open-file"
export const askToOpenFile = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_FILE, { detail: path }))
/** Something was saved: the status line, the files and the canvas read again. */
export const SITE_SAVED = "ohm:site-saved"
export const saved = () => window.dispatchEvent(new CustomEvent(SITE_SAVED))

// ---- Publish (flows/site.md, Save and Publish) ----

/** Where the site stands for the status line: files not published, commits not sent, the live deploy. */
export type SiteStatus = { changed: string[]; ahead: number; behind: number; branch: string; remote: string; head: string; live: Deployed | null; domain: string; lastSave: { at: string; path: string } | null }

export async function readStatus(): Promise<SiteStatus> {
  const res = await bridgeFetch("/site/status", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteStatus
}

export type PublishStep = "pull" | "commit" | "push" | "deploy"
export type Published = { done: { step: PublishStep; did: boolean }[]; failed?: { step: PublishStep; reason: string }; live?: Deployed | null }

/** Pull, commit, push, deploy: each skipped when already done, stopping at the first that fails. The person's alone: no tool calls it. */
export async function publishSite(message: string): Promise<Published> {
  const res = await bridgeFetch("/site/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Publish did not start")
  return (await res.json()) as Published
}
