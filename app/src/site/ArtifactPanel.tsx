// An artifact's detail panel (docs/plans/information-and-viewer.md): the third column, beside the artifact
// itself, with everything about its code in one place: its history (saves, yours and your agent's, and
// commits, as one timeline), its pull requests, its deploys, and Publish, the one thing done here.
// Shown, never spread over the artifact.
import { useCallback, useEffect, useMemo, useState } from "react"
import { XIcon } from "lucide-react"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { PullRequests } from "./CodePanel"
import { PublishControl } from "./SitePublish"
import { DeployControl } from "./SiteDeploy"
import { readHistory, SITE_SAVED, type SiteHistory } from "./source"

type Tab = "about" | "history" | "pulls" | "deploys"
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const who = (via: string) => (via.startsWith("agent:") ? via.slice(6) : "you")

/** One thing that happened: a list row, its words and when, with a dot for your agent's work and for what is live. */
function Row({ title, meta, tone }: { title: string; meta: string; tone?: "agent" | "live" }) {
  return (
    <li className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
      <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "agent" ? "bg-foreground" : tone === "live" ? "bg-success" : "bg-transparent")} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-small">{title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{meta}</span>
      </span>
    </li>
  )
}

/** A day's rows under its name, as the panel's groups are labelled. */
function Days<T extends { at: string }>({ items, row }: { items: T[]; row(item: T, i: number): React.ReactNode }) {
  const groups = new Map<string, T[]>()
  for (const item of items) { const d = new Date(item.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); groups.set(d, [...(groups.get(d) ?? []), item]) }
  return (
    <div className="flex flex-col gap-3">
      {[...groups].map(([day, list]) => (
        <section key={day} aria-label={day} className="flex flex-col">
          <h3 className="px-2 pb-1 text-small font-semibold">{day}</h3>
          <ul className="flex flex-col">{list.map(row)}</ul>
        </section>
      ))}
    </div>
  )
}

function Nothing({ say }: { say: string }) {
  return <Empty className="flex-1"><EmptyHeader><EmptyDescription>{say}</EmptyDescription></EmptyHeader></Empty>
}

/**
 * `path`: the artifact's own files (a page, or a folder ending in /); without it, the whole site, which
 * is what the website artifact is.
 */
export function ArtifactPanel({ path, onClose, about }: { path?: string; onClose(): void
  /** What the artifact is (a block's kind, channel, connections): its first tab, when given. */
  about?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>(about ? "about" : "history")
  const [records, setRecords] = useState<SiteHistory | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const read = useCallback(() => { readHistory().then(setRecords, () => setRecords({ saves: [], commits: [], deploys: [] })) }, [])
  useEffect(() => { read(); window.addEventListener(SITE_SAVED, read); return () => window.removeEventListener(SITE_SAVED, read) }, [read])

  const timeline = useMemo(() => {
    if (!records) return []
    const of = (p?: string) => !path || (!!p && (p === path || (path.endsWith("/") && p.startsWith(path))))
    return [
      ...records.saves.filter(s => of(s.path)).map(s => ({ at: s.at, kind: "save" as const, title: s.kind === "move" ? `Moved ${s.path}` : `Saved ${s.path}`, meta: `${who(s.via ?? "")} · ${ago(s.at)}`, agent: (s.via ?? "").startsWith("agent:") })),
      ...records.commits.filter(c => !path || c.files.some(f => of(f))).map(c => ({ at: c.at, kind: "commit" as const, title: c.subject, meta: `${c.hash.slice(0, 7)} · ${c.author} · ${ago(c.at)}`, agent: false })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120)
  }, [records, path])

  // A block (a writing) has what it is and its history; the website, the whole site, also has its pull
  // requests and what is live.
  const TABS: [Tab, string][] = about ? [["about", "About"], ["history", "History"]] : [["history", "History"], ["pulls", "Pull requests"], ["deploys", "Live"]]
  return (
    <aside aria-label="Details" className="flex h-full w-[22rem] shrink-0 flex-col rounded-3xl bg-card shade-4">
      <header className="flex items-center gap-2 px-3 pt-3">
        {/* The same pills as the home panel's (Collections, Sources, Mind). */}
        <div role="tablist" aria-label="Show" className="flex flex-1 flex-wrap gap-1.5">
          {TABS.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className="h-8 rounded-full bg-muted px-3 text-small outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-primary aria-selected:text-primary-foreground">
              {label}
            </button>
          ))}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}><Icon icon={XIcon} /></Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-4">
        {tab === "about" && about}
        {tab === "history" && (!records ? <div className="flex-1" aria-busy />
          : timeline.length ? <Days items={timeline} row={(e, i) => <Row key={i} title={e.title} meta={e.meta} tone={e.agent ? "agent" : undefined} />} />
          : <Nothing say="Nothing has changed here yet." />)}
        {tab === "pulls" && <div className="flex min-h-0 flex-1 flex-col px-1"><PullRequests /></div>}
        {tab === "deploys" && (!records ? <div className="flex-1" aria-busy />
          : records.deploys.length ? <Days items={[...records.deploys].reverse()} row={(d, i) => <Row key={i} tone={d === records.deploys.at(-1) ? "live" : undefined} title={`${d === records.deploys.at(-1) ? "Live · " : ""}${d.subject || d.commit.slice(0, 7)}`} meta={`${d.commit.slice(0, 7)} · ${d.project} · ${ago(d.at)}`} />} />
          : <Nothing say="Your site hasn't been put online from here yet. Publish puts it live: each time it does, it shows here, the latest one marked live." />)}
      </div>

      {/* The one thing done here: publish what you saved. */}
      <footer className="flex flex-wrap items-center gap-2 p-3">
        {advanced && <DeployControl />}
        <span className="flex-1" />
        <PublishControl advanced={advanced} onAdvanced={() => setAdvanced(a => !a)} />
      </footer>
    </aside>
  )
}
