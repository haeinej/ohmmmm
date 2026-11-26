// What is happening to the site's code, to see and decide on, minimally (docs/plans/information-and-viewer.md):
// its pull requests, each with its branch into the base, its state, and its files as a diff, with its
// conversation and checks. Read with the person's own gh on this computer; ohm changes nothing here.
// Opening, updating and merging is their coding agent's work, or GitHub's.
import { useEffect, useMemo, useState } from "react"
import { ChevronLeftIcon, ExternalLinkIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/cn"
import { readPull, readPulls, type SitePull, type SitePullDetail } from "./source"

const when = (iso: string) => {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`
}
const STATE: Record<string, string> = { OPEN: "Open", MERGED: "Merged", CLOSED: "Closed" }
/** A pull request's state, as ohm-ui's Badge: open in ink, the rest quiet. */
function State({ pr }: { pr: SitePull }) {
  const label = pr.isDraft ? "Draft" : STATE[pr.state] ?? pr.state
  return <Badge variant={pr.state === "OPEN" && !pr.isDraft ? "default" : "secondary"}>{label}</Badge>
}

/** A unified diff, file by file: each file's name with what it adds and takes away, then its hunks. */
function Diff({ text }: { text: string }) {
  const files = useMemo(() => text.split(/^diff --git /m).filter(Boolean).map(chunk => {
    const lines = chunk.split("\n")
    const name = /^a\/(\S+)/.exec(lines[0])?.[1] ?? lines[0]
    const body = lines.slice(lines.findIndex(l => l.startsWith("@@")))
    return { name, body: body[0]?.startsWith("@@") ? body : [], add: body.filter(l => l.startsWith("+")).length, del: body.filter(l => l.startsWith("-")).length }
  }), [text])
  if (!files.length) return <p className="text-small text-muted-foreground">No changes to show.</p>
  return (
    <div className="flex flex-col gap-4">
      {files.map(f => (
        <section key={f.name} aria-label={f.name} className="flex flex-col gap-1">
          <h4 className="flex items-baseline gap-2 text-small font-semibold">{f.name}<span className="font-normal text-success">+{f.add}</span><span className="font-normal text-destructive">−{f.del}</span></h4>
          <pre className="overflow-x-auto rounded-lg bg-muted/50 py-1 font-mono text-[11px] leading-[1.55]">
            {f.body.map((l, i) => (
              <div key={i} className={cn("px-2 whitespace-pre", l.startsWith("@@") ? "bg-muted text-muted-foreground" : l.startsWith("+") ? "bg-success/12" : l.startsWith("-") ? "bg-destructive/10" : "")}>{l || " "}</div>
            ))}
          </pre>
        </section>
      ))}
    </div>
  )
}

function Detail({ number, onBack }: { number: number; onBack(): void }) {
  const [pr, setPr] = useState<SitePullDetail | null>(null)
  const [failed, setFailed] = useState("")
  const [tab, setTab] = useState<"conversation" | "files" | "checks">("files")
  useEffect(() => { readPull(number).then(setPr, e => setFailed((e as Error).message)) }, [number])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onBack}><Icon icon={ChevronLeftIcon} size="sm" />Back</Button>
        <span className="flex-1" />
        {pr && <Button size="icon-sm" variant="ghost" aria-label="Open on GitHub" onClick={() => window.open(pr.url, "_blank", "noopener")}><Icon icon={ExternalLinkIcon} /></Button>}
      </div>
      {failed ? <p className="text-small text-muted-foreground">{failed}</p> : !pr ? <div className="flex-1" aria-busy /> : <>
        <div className="flex flex-wrap items-center gap-1.5 text-small">
          <State pr={pr} />
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{pr.headRefName}</span>
          <span className="text-muted-foreground">→</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{pr.baseRefName}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-body font-semibold leading-snug">{pr.title}</h3>
          <p className="text-small text-muted-foreground">#{pr.number} · {pr.author} · updated {when(pr.updatedAt)}</p>
        </div>
        <div role="tablist" aria-label="Show" className="flex gap-4 text-small">
          {([["conversation", "Conversation", pr.comments.length + (pr.body ? 1 : 0)], ["files", "Files", pr.files.length], ["checks", "Checks", pr.checks.length]] as const).map(([v, label, n]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className="pb-1 text-muted-foreground outline-none aria-selected:font-medium aria-selected:text-foreground aria-selected:shadow-[inset_0_-2px_0_var(--foreground)]">
              {label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "files" && <Diff text={pr.diff} />}
          {tab === "conversation" && (
            <div className="flex flex-col gap-3 text-small">
              {pr.body && <p className="whitespace-pre-wrap">{pr.body}</p>}
              {pr.comments.map((c, i) => <div key={i} className="rounded-lg bg-muted/50 p-2"><p className="font-medium">{c.author}</p><p className="whitespace-pre-wrap">{c.body}</p></div>)}
              {!pr.body && !pr.comments.length && <p className="text-muted-foreground">No conversation yet.</p>}
            </div>
          )}
          {tab === "checks" && (
            <ul className="flex flex-col gap-1 text-small">
              {pr.checks.map((c, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="text-muted-foreground">{c.state.toLowerCase()}</span></li>)}
              {!pr.checks.length && <li className="text-muted-foreground">No checks.</li>}
            </ul>
          )}
        </div>
      </>}
    </div>
  )
}

/** A pull request's state as one icon and word: open, draft, merged, closed. */
const KINDS = {
  open: { icon: GitPullRequestIcon, word: "Open", tone: "text-foreground" },
  draft: { icon: GitPullRequestDraftIcon, word: "Draft", tone: "text-muted-foreground" },
  merged: { icon: GitMergeIcon, word: "Merged", tone: "text-foreground" },
  closed: { icon: GitPullRequestClosedIcon, word: "Closed", tone: "text-muted-foreground" },
} as const
const kindOf = (p: SitePull) => (p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : p.isDraft ? "draft" : "open")

/**
 * The site's pull requests, as much as a person needs to decide: whether each is open, merged or closed,
 * what it is, what it is about in a line, and its page on GitHub for the rest. Read only.
 */
export function PullRequests() {
  const [pulls, setPulls] = useState<SitePull[] | null>(null)
  const [failed, setFailed] = useState("")
  useEffect(() => { readPulls().then(setPulls, e => setFailed((e as Error).message)) }, [])
  if (failed) return <p className="px-2 text-small text-muted-foreground">{failed}</p>
  if (!pulls) return <div className="flex-1" aria-busy />
  if (!pulls.length) return <p className="px-2 text-small text-muted-foreground">No pull requests. When your coding agent opens one against your site, it shows here.</p>
  return (
    <ul className="flex flex-col gap-0.5">
      {pulls.map(p => {
        const k = KINDS[kindOf(p)]
        return (
          <li key={p.number}>
            <a href={p.url} target="_blank" rel="noreferrer" title="Open on GitHub"
              className="group flex gap-2.5 rounded-lg px-2 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40">
              <Icon icon={k.icon} size="sm" className={cn("mt-0.5 shrink-0", k.tone)} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-small font-medium leading-snug">{p.title}</span>
                {p.summary && <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.summary}</span>}
                <span className="text-[11px] text-muted-foreground">{k.word} · #{p.number} · {when(p.updatedAt)}</span>
              </span>
              <Icon icon={ExternalLinkIcon} size="xs" className="mt-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
