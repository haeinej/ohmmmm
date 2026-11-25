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

export type SiteItem = { kind: "page" | "image" | "video"; path: string; title: string; thumb?: string; excerpt?: string; modified: string; usedIn: string[] }
export type SiteContent = { site: string; collections: { name: string; items: SiteItem[] }[] }

export async function readContent(): Promise<SiteContent> {
  const res = await fetch("/site/content")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return (await res.json()) as SiteContent
}

/** Ask the Site view to bring a page's frame into view. The side panel's tiles use it. */
export const OPEN_PAGE = "ohm:site-open-page"
export const askToOpen = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: path }))

/** Ask the Site view to open one block, by its path, over the canvas. */
export const OPEN_BLOCK = "ohm:site-open-block"
export const askToOpenBlock = (path: string) => window.dispatchEvent(new CustomEvent(OPEN_BLOCK, { detail: path }))

export const siteUrl = (path: string) => `/site/${path.split("/").map(encodeURIComponent).join("/")}`

export async function listPages(): Promise<SitePage[]> {
  const res = await fetch("/site/pages")
  if (!res.ok) throw new Error("The site's folder couldn't be read")
  return ((await res.json()) as { pages: SitePage[] }).pages
}

/** Save one text change to a page's file. It refuses to write over a file that changed on disk. */
export async function saveText(page: string, before: string, after: string, nth = 0, count?: number): Promise<void> {
  const url = `/site/${page.split("/").map(encodeURIComponent).join("/")}`
  const read = await fetch(url, { cache: "no-store" })
  if (!read.ok) throw new EditProblem("That page isn't in the site")
  const next = replaceText(await read.text(), before, after, nth, count)
  const wrote = await fetch(url, { method: "PUT", headers: { "If-Match": read.headers.get("ETag") ?? "" }, body: next })
  if (wrote.status === 412) throw new EditProblem("This page changed on disk since it was read. Reload it and try again")
  if (!wrote.ok) throw new EditProblem("The page couldn't be saved")
}
