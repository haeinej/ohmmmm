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

/** One change to a page's file. */
export type Change =
  | { type: "text"; before: string; after: string; nth?: number; count?: number }
  | { type: "insert"; anchor: string; html: string; nth?: number; count?: number }
  | { type: "src"; from: string; to: string }

export function applyChange(source: string, change: Change): string {
  if (change.type === "text") return replaceText(source, change.before, change.after, change.nth, change.count)
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

export type SiteItem = { kind: "article" | "project" | "image" | "video"; path: string; title: string; thumb?: string; excerpt?: string; modified: string; usedIn: string[] }
export type SiteContent = { site: string; collections: { name: string; items: SiteItem[] }[] }

export async function readContent(): Promise<SiteContent> {
  const res = await fetch("/site/content")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return (await res.json()) as SiteContent
}

/** Ask the Site view to bring a page's frame into view. The side panel's tiles use it. */
export const OPEN_PAGE = "ohm:site-open-page"
export const askToOpen = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: path }))

/** An article or a project as writing: its title, the line under it, and its body as Markdown. */
export type SiteArticle = { title: string; details: string; markdown: string }

export async function readArticle(path: string): Promise<SiteArticle> {
  const res = await fetch(`/site/article?path=${encodeURIComponent(path)}`, { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteArticle
}

/** Ask the Site view to open one block, by its path, over the canvas. */
export const OPEN_BLOCK = "ohm:site-open-block"
export const askToOpenBlock = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_BLOCK, { detail: path }))

export const siteUrl = (path: string) => `/site/${path.split("/").map(encodeURIComponent).join("/")}`

export async function listPages(): Promise<SitePage[]> {
  const res = await fetch("/site/pages")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return ((await res.json()) as { pages: SitePage[] }).pages
}

/** Where the site's folder stands against its remote (site-dev.ts `syncOf`). */
export type SiteSync = { branch: string; upstream: string; remote: string; ahead: number; behind: number; changed: string[]; last: string }

export async function readSync(): Promise<SiteSync> {
  const res = await fetch("/site/git", { cache: "no-store" })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteSync
}

/** One git step on the site's folder: bring the remote's commits in, commit what changed, or send commits out. */
export async function syncStep(step: "pull" | "commit" | "push", message?: string): Promise<SiteSync> {
  const res = await fetch(`/site/git/${step}`, { method: "POST", headers: { "X-Ohm-Site": "1", "Content-Type": "application/json" }, body: JSON.stringify({ message }) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as SiteSync
}

/** Save one change to a page's file. It refuses to write over a file that changed on disk. */
export async function saveChange(page: string, change: Change): Promise<void> {
  const url = `/site/${page.split("/").map(encodeURIComponent).join("/")}`
  const read = await fetch(url, { cache: "no-store" })
  if (!read.ok) throw new EditProblem("That page isn't in the site")
  const next = applyChange(await read.text(), change)
  const wrote = await fetch(url, { method: "PUT", headers: { "If-Match": read.headers.get("ETag") ?? "", "X-Ohm-Site": "1" }, body: next })
  if (wrote.status === 412) throw new EditProblem("This page changed on disk since it was read. Reload it and try again")
  if (!wrote.ok) throw new EditProblem("The page couldn't be saved")
}
