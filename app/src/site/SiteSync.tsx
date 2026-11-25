// Where the site's folder stands against its remote, and the three steps that move it
// (flows/site.md): pull the remote's commits in, commit what changed here, push commits out.
// Pushing is the person's alone: it asks first, and no tool does it.
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { SiteSync } from "./source"

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** `https://github.com/alice/site.git` as `github.com/alice/site`. */
const where = (remote: string) => remote.replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/").replace(/\.git$/, "")
/** A first message for a commit: the files it holds. */
export const messageFor = (changed: string[]) => changed.length <= 2 ? `Edit ${changed.join(" and ")}` : `Edit ${changed.length} pages`

export function SyncControls({ sync, busy, onPull, onCommit, onPublish }: {
  sync: SiteSync | null
  busy: boolean
  onPull(): void
  onCommit(message: string): void
  onPublish(): void
}) {
  const [asking, setAsking] = useState<"commit" | "publish" | null>(null)
  const [message, setMessage] = useState("")
  if (!sync) return null
  const state = [
    sync.changed.length && count(sync.changed.length, "file changed", "files changed"),
    sync.ahead && count(sync.ahead, "commit to push", "commits to push"),
    sync.behind && `${sync.behind} behind`,
  ].filter(Boolean).join(" · ") || "Up to date"
  return (
    <>
      <span className="shrink-0 text-small text-muted-foreground" title={sync.remote ? where(sync.remote) : undefined}>{sync.branch} · {state}</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onPull}>Pull</Button>
      {sync.changed.length > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMessage(messageFor(sync.changed)); setAsking("commit") }}>Commit</Button>}
      {sync.ahead > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking("publish")}>Push</Button>}

      <Dialog open={asking !== null} onOpenChange={open => { if (!open) setAsking(null) }}>
        <DialogContent className="sm:max-w-sm">
          {asking === "commit" ? (
            <form className="contents" onSubmit={e => { e.preventDefault(); if (message.trim()) { onCommit(message.trim()); setAsking(null) } }}>
              <DialogHeader>
                <DialogTitle>Commit {count(sync.changed.length, "file", "files")}</DialogTitle>
                <DialogDescription>{sync.changed.slice(0, 6).join(", ")}{sync.changed.length > 6 && ` and ${sync.changed.length - 6} more`}. It stays on your computer until you push or deploy.</DialogDescription>
              </DialogHeader>
              <Input aria-label="What changed" value={message} maxLength={200} onChange={e => setMessage(e.target.value)} autoFocus />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
                <Button type="submit" disabled={!message.trim()}>Commit</Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Push {count(sync.ahead, "commit", "commits")}?</DialogTitle>
                <DialogDescription>They go to {where(sync.remote) || "your remote"} on {sync.branch}. Everyone who can see that repository can see them, and a site that is served from it follows.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
                <Button onClick={() => { onPublish(); setAsking(null) }}>Push</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
