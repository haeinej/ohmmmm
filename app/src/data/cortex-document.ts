// A cortex file (cortex/docs/model.md) as the workspace shows it, and back. The files are opened on
// this device; the service holds them sealed. `profile.md`, `observations/<slug>.md`,
// `skills/<slug>.md` and `tools/<slug>.md`, each Markdown with a few properties at the top.
import { readProperties, setProperty, splitFile, writeNoteFile } from "../../../vault/vault/file.mjs"
import { withBody } from "./block-document"
import type { CortexFile, HomeFile } from "./source"
import { CORTEX_FOLDERS, type CortexKind, type Doc } from "./workspace-model"

const KIND_OF_FOLDER = Object.fromEntries(Object.entries(CORTEX_FOLDERS).map(([kind, folder]) => [folder, kind])) as Record<string, CortexKind>

export function cortexKindOf(path: string): CortexKind | undefined {
  if (path === "profile.md") return "profile"
  return KIND_OF_FOLDER[path.split("/", 1)[0]]
}

export function cortexDocOf(file: CortexFile): Doc | undefined {
  const kind = cortexKindOf(file.path)
  if (!kind) return undefined
  const { head, body } = splitFile(file.text)
  const properties = readProperties(head).properties as Record<string, unknown>
  const slug = file.path.split("/").at(-1)!.replace(/\.md$/, "")
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  const text = (key: string) => typeof properties[key] === "string" ? properties[key] as string : undefined
  const about = Array.isArray(properties.about) ? properties.about.map(String).map(item => item.replace(/^block:/, "")) : undefined
  return {
    id: file.id, kind, slug, title: text("title") ?? heading ?? slug, visibility: "private", body: body.replace(/^\n+/, ""),
    updated: (text("updated") ?? text("at") ?? "").slice(0, 10),
    ...(text("by") ? { by: text("by") } : {}),
    ...(about?.length ? { about } : {}),
  }
}

/** A cortex file. Given the file it was read from, it keeps every property the workspace doesn't edit (an observation's evidence, session, a skill's or tool's own fields). */
export function cortexFileOf(doc: Doc, base?: HomeFile): HomeFile {
  const kind = doc.kind as CortexKind
  if (!(kind in CORTEX_FOLDERS)) throw new DOMException("Give a cortex file.", "DataError")
  const path = base?.path ?? (kind === "profile" ? "profile.md" : `${CORTEX_FOLDERS[kind]}/${doc.slug}.md`)
  const properties = {
    title: doc.title || undefined, by: doc.by, updated: doc.updated || undefined,
    about: doc.about?.map(item => item.startsWith("channel:") ? item : `block:${item}`),
  }
  if (!base) return { path, text: writeNoteFile({ properties, body: doc.body }) }
  return { path, text: withBody(Object.entries(properties).reduce((text, [key, value]) => setProperty(text, key, value), base.text), doc.body) }
}
