// The site's history (flows/site.md, History): the history timeline (History.tsx) with the site as
// its source. Three kinds of entry, from the site's own records: saves (the save log,
// site/.ohm/saves.jsonl), publishes (git log) and deploys (site/.ohm/deploys.jsonl). By date or by
// author. Each entry opens to see the change. **Restore** puts a version back on this computer as a
// new save: never live, the person then publishes. **Put back live** deploys a published commit
// again, after the person says yes; no tool does it.
import { useCallback, useEffect, useMemo, useState } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { cn } from "@/lib/cn"
import { Day, dayKey, dayOf, Stop, when, type Mark } from "./History"
import { deploySite, readCommitFile, readHistory, readKept, restoreVersion, SITE_SAVED, type Deployed, type SiteCommit, type SiteHistory as Records, type SiteSave } from "@/site/source"

type Entry =
  | { id: string; kind: "save"; at: string; who: string; save: SiteSave }
  | { id: string; kind: "publish"; at: string; who: string; commit: SiteCommit; live: boolean }
  | { id: string; kind: "deploy"; at: string; who: string; deploy: Deployed; live: boolean }

const short = (hash: string) => hash.slice(0, 7)
const VIA: Record<string, string> = { canvas: "on the canvas", editor: "in the editor", restore: "by restoring", files: "in Files" }

/** Every entry, newest first. */
export function entriesOf(records: Records): Entry[] {
  const live = [...records.deploys].reverse().find(d => d.production)
  return [
    ...records.saves.map((save, i): Entry => ({ id: `save:${i}`, kind: "save", at: save.at, who: save.by === "me" ? "You" : save.by, save })),
    ...records.commits.map((commit): Entry => ({ id: `commit:${commit.hash}`, kind: "publish", at: commit.at, who: commit.author, commit, live: live?.commit === commit.hash })),
    ...records.deploys.map((deploy, i): Entry => ({ id: `deploy:${i}`, kind: "deploy", at: deploy.at, who: "You", deploy, live: deploy === live })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Lines that differ between two texts: what is the same at the start and the end is left out. */
export function changedLines(before: string, after: string, most = 40) {
  const a = before.split("\n"), b = after.split("\n")
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return { at: start + 1, removed: a.slice(start, a.length - end).slice(0, most), added: b.slice(start, b.length - end).slice(0, most) }
}

function Change({ before, after }: { before: string | null; after: string | null }) {
  if (before === null && after === null) return <p className="text-small text-muted-foreground">This version isn't text, or isn't kept.</p>
  const { at, removed, added } = changedLines(before ?? "", after ?? "")
  if (!removed.length && !added.length) return <p className="text-small text-muted-foreground">No change in the text.</p>
  return (
    <pre className="max-h-56 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-small leading-relaxed whitespace-pre-wrap">
      <span className="text-muted-foreground">line {at}{"\n"}</span>
      {removed.map((l, i) => <span key={`r${i}`} className="block text-muted-foreground line-through">{l || " "}</span>)}
      {added.map((l, i) => <span key={`a${i}`} className="block rounded-sm bg-(--ohm-green-light)/45">{l || " "}</span>)}
    </pre>
  )
}

function SaveDetail({ save }: { save: SiteSave }) {
  const [texts, setTexts] = useState<{ before: string | null; after: string | null } | null>(null)
  useEffect(() => {
    if (save.kind === "move") return
    Promise.all([readKept(save.before).catch(() => null), readKept(save.after).catch(() => null)]).then(([before, after]) => setTexts({ before, after }))
  }, [save])
  const restore = (hash: string, what: string) => restoreVersion({ path: save.path, hash })
    .then(() => notify({ message: `${what} ${save.path}. It is on your computer only until you publish.` }), e => notify({ message: (e as Error).message, tone: "error" }))
  return (
    <>
      <p className="text-small text-muted-foreground">{when(save.at)} · {VIA[save.via] ?? save.via}</p>
      {save.kind === "move" ? <p className="text-small">Moved from {String(save.from)}</p> : texts ? <Change {...texts} /> : null}
      {save.kind === "save" && (
        <span className="flex flex-wrap gap-1">
          <Button size="xs" variant="ghost" onClick={() => void restore(save.before, "Put back the version before this save, in")}>Restore the version before</Button>
          <Button size="xs" variant="ghost" onClick={() => void restore(save.after, "Restored this version of")}>Restore this version</Button>
        </span>
      )}
    </>
  )
}

function PublishDetail({ commit, live, onLive }: { commit: SiteCommit; live: boolean; onLive(): void }) {
  const [file, setFile] = useState<string | null>(null)
  const [texts, setTexts] = useState<{ before: string | null; after: string | null } | null>(null)
  useEffect(() => { setTexts(null); if (file) readCommitFile(commit.hash, file).then(setTexts, () => setTexts({ before: null, after: null })) }, [commit, file])
  return (
    <>
      <p className="text-small text-muted-foreground">{when(commit.at)} · {commit.author} · {short(commit.hash)}{live && " · live now"}</p>
      <ul className="flex flex-col">
        {commit.files.slice(0, 30).map(f => (
          <li key={f}><button type="button" onClick={() => setFile(file === f ? null : f)} className={cn("w-full truncate rounded-md px-1 text-left text-small hover:bg-muted", file === f && "bg-muted")}>{f}</button></li>
        ))}
        {commit.files.length > 30 && <li className="px-1 text-small text-muted-foreground">and {commit.files.length - 30} more</li>}
      </ul>
      {file && texts && <Change {...texts} />}
      <span className="flex flex-wrap gap-1">
        {file && <Button size="xs" variant="ghost" onClick={() => restoreVersion({ path: file, commit: commit.hash })
          .then(() => notify({ message: `Restored ${file} as it was published then. It is on your computer only until you publish.` }), e => notify({ message: (e as Error).message, tone: "error" }))}>Restore this file</Button>}
        {!live && <Button size="xs" variant="ghost" onClick={onLive}>Put back live</Button>}
      </span>
    </>
  )
}

export function SiteHistory({ onClose }: { onClose(): void }) {
  const [records, setRecords] = useState<Records | null>(null)
  const [by, setBy] = useState<"date" | "author">("date")
  const [picked, setPicked] = useState<string | null>(null)
  const [puttingBack, setPuttingBack] = useState<{ commit: string; subject: string; project: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => readHistory().then(setRecords, e => notify({ message: (e as Error).message, tone: "error" })), [])
  useEffect(() => {
    void reload()
    window.addEventListener(SITE_SAVED, reload)
    return () => window.removeEventListener(SITE_SAVED, reload)
  }, [reload])
  const entries = useMemo(() => (records ? entriesOf(records) : []), [records])
  const project = records?.deploys.at(-1)?.project ?? ""
  const groups = useMemo(() => {
    const out = new Map<string, Entry[]>()
    for (const e of entries) { const key = by === "date" ? dayKey(e.at) : e.who; out.set(key, [...(out.get(key) ?? []), e]) }
    return [...out].map(([key, list]) => ({ label: by === "date" ? dayOf(list[0].at) : key, list }))
  }, [entries, by])

  const putBack = async () => {
    if (!puttingBack) return
    setBusy(true)
    try {
      const deployed = await deploySite(puttingBack.project, puttingBack.commit)
      notify({ message: `Put back live: ${short(deployed.commit)} at ${deployed.url.replace(/^https:\/\//, "")}`, tone: "info" })
      setPuttingBack(null); void reload(); window.dispatchEvent(new CustomEvent(SITE_SAVED))
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setBusy(false)
  }

  const mark = (e: Entry): Mark => e.kind === "save" ? "human" : e.kind === "publish" ? "save" : "day"
  const text = (e: Entry) => e.kind === "save"
    ? <><span className="text-muted-foreground">{e.save.kind === "move" ? "Moved" : e.save.via === "restore" ? "Restored" : "Saved"}</span> <span className="font-medium">{e.save.path}</span></>
    : e.kind === "publish" ? <><span className="text-muted-foreground">Published</span> <span className="font-medium">{e.commit.subject}</span></>
    : <><span className="text-muted-foreground">{e.deploy.putBack ? "Put back live" : e.deploy.production ? "Went live" : "Preview"}</span> <span className="font-medium">{e.deploy.subject}</span></>

  return (
    <div role="dialog" aria-label="Site history" className="absolute inset-0 z-10 flex min-h-0 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <span className="flex-1 text-small font-medium">History</span>
        <div role="tablist" aria-label="Group" className="flex gap-1">
          {(["date", "author"] as const).map(v => <Button key={v} role="tab" aria-selected={by === v} size="xs" variant={by === v ? "secondary" : "ghost"} onClick={() => setBy(v)}>{v === "date" ? "By date" : "By author"}</Button>)}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {records === null ? <p className="text-small text-muted-foreground">Reading your site's history</p>
          : !entries.length ? <p className="text-small text-muted-foreground">Nothing yet. Every save, publish and deploy is kept here.</p>
          : <ol className="mx-auto flex max-w-2xl flex-col">
              {groups.map(g => (
                <li key={g.label}><ol className="flex flex-col">
                  <Day day={g.label} />
                  {g.list.map((e, i) => (
                    <Stop key={e.id} mark={mark(e)} who={e.who} text={text(e)} at={e.at} first={i === 0} last={i === g.list.length - 1}
                      tag={"live" in e && e.live ? <span className="text-small text-(--ohm-green)">live</span> : undefined}
                      open={picked === e.id} onToggle={() => setPicked(picked === e.id ? null : e.id)}>
                      {e.kind === "save" ? <SaveDetail save={e.save} />
                        : e.kind === "publish" ? <PublishDetail commit={e.commit} live={e.live} onLive={() => setPuttingBack({ commit: e.commit.hash, subject: e.commit.subject, project })} />
                        : <>
                            <p className="text-small text-muted-foreground">{when(e.at)} · {short(e.deploy.commit)} · <a className="hover:underline" href={e.deploy.url} target="_blank" rel="noreferrer">{e.deploy.url.replace(/^https:\/\//, "")}</a></p>
                            {!e.live && <Button size="xs" variant="ghost" className="self-start" onClick={() => setPuttingBack({ commit: e.deploy.commit, subject: e.deploy.subject, project: e.deploy.project })}>Put back live</Button>}
                          </>}
                    </Stop>
                  ))}
                </ol></li>
              ))}
            </ol>}
      </div>
      <Dialog open={puttingBack !== null} onOpenChange={o => { if (!o && !busy) setPuttingBack(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Put this version back live?</DialogTitle>
            <DialogDescription>“{puttingBack?.subject}” ({puttingBack && short(puttingBack.commit)}) becomes your live site again, for everyone. What you have on this computer stays as it is.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPuttingBack(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void putBack()}>{busy ? "Putting back" : "Put back live"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
