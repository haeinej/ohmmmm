// Save and Publish as one line and one button (flows/site.md). Every save is written at once and
// kept in the save log; nothing leaves the computer until the person presses Publish. The line says
// where the site stands: Saved, then "N changes not published", then Publishing, then "Live, 2 min
// ago" with its address. Publish opens a dialog that lists what goes out, with the message the
// commit will carry, then pulls (fast-forward only), commits, pushes and deploys, stopping at the
// first step that fails with its reason; Publish again goes on from there. No tool publishes.
import { useCallback, useEffect, useState } from "react"
import { CheckIcon, CircleIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { cn } from "@/lib/cn"
import { messageFor } from "./SiteSync"
import { publishSite, readStatus, SITE_SAVED, type PublishStep, type Published, type SiteStatus } from "./source"

const STEPS: { step: PublishStep; label: string }[] = [
  { step: "pull", label: "Bring in changes made elsewhere" },
  { step: "commit", label: "Keep this version" },
  { step: "push", label: "Send it to your repository" },
  { step: "deploy", label: "Put it live" },
]

/** "2 min ago", "3 h ago", "yesterday". */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return s < 172800 ? "yesterday" : new Date(iso).toLocaleDateString()
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function PublishControl({ advanced, onAdvanced }: { advanced: boolean; onAdvanced(): void }) {
  const [status, setStatus] = useState<SiteStatus | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Published | null>(null)
  /** What the dialog lists: where the site stood when Publish was pressed. */
  const [shown, setShown] = useState<SiteStatus | null>(null)
  const [, tick] = useState(0)

  const refresh = useCallback(() => readStatus().then(setStatus, () => setStatus(null)), [])
  useEffect(() => {
    void refresh()
    const onSaved = () => { void refresh(); setJustSaved(true); setTimeout(() => setJustSaved(false), 2500) }
    window.addEventListener(SITE_SAVED, onSaved)
    const timer = setInterval(() => tick(n => n + 1), 30_000)
    return () => { window.removeEventListener(SITE_SAVED, onSaved); clearInterval(timer) }
  }, [refresh])

  if (!status) return null
  const waiting = status.changed.length + status.ahead
  const liveIsHead = Boolean(status.live && status.live.commit === status.head)
  const nothing = !waiting && liveIsHead
  const address = status.live ? (status.live.production && status.domain ? status.domain : status.live.url.replace(/^https:\/\//, "")) : ""
  const line = running ? "Publishing"
    : justSaved ? "Saved"
    : status.changed.length ? `${count(status.changed.length, "change", "changes")} not published`
    : status.ahead ? `${count(status.ahead, "version", "versions")} not sent`
    : status.live && liveIsHead ? `Live, ${ago(status.live.at)}`
    : status.live ? "Not live yet: the live site is an earlier version"
    : "Not live yet"

  const open = () => { setResult(null); setShown(status); setMessage(messageFor(status.changed.length ? status.changed : ["your site"])); setAsking(true) }
  /** The one handler for Publish and Publish again. */
  const run = async () => {
    setRunning(true)
    try {
      const done = await publishSite(message.trim())
      setResult(done)
      if (!done.failed) notify({ message: `Your site is live${done.live ? ` at ${done.live.url.replace(/^https:\/\//, "")}` : ""}.`, tone: "info" })
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setRunning(false)
    void refresh()
  }
  const stateOf = (step: PublishStep) => result?.failed?.step === step ? "failed" : result?.done.some(d => d.step === step) ? "done" : running ? "waiting" : "todo"

  return (
    <>
      <span role="status" className="shrink-0 text-small text-muted-foreground" title={status.live?.url}>
        {line}
        {!running && !justSaved && !waiting && address && <> · <a href={status.live!.production && status.domain ? `https://${status.domain}` : status.live!.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{address}</a></>}
      </span>
      <Button size="sm" variant="ghost" aria-pressed={advanced} onClick={onAdvanced}>Advanced</Button>
      <Button size="sm" disabled={running || nothing} onClick={open}>Publish</Button>

      <Dialog open={asking} onOpenChange={o => { if (!running) setAsking(o) }}>
        <DialogContent className="sm:max-w-md">
          <form className="contents" onSubmit={e => { e.preventDefault(); if (message.trim() || !(shown ?? status).changed.length) void run() }}>
            <DialogHeader>
              <DialogTitle>Publish your site</DialogTitle>
              <DialogDescription>
                {(shown ?? status).changed.length
                  ? <>What goes out: {(shown ?? status).changed.slice(0, 8).join(", ")}{(shown ?? status).changed.length > 8 && ` and ${(shown ?? status).changed.length - 8} more`}.</>
                  : (shown ?? status).ahead ? <>{count((shown ?? status).ahead, "version", "versions")} kept here and not sent yet.</> : <>The version you have here, which is not live yet.</>}
                {" "}It goes to {(shown ?? status).remote.replace(/^https?:\/\//, "").replace(/\.git$/, "") || "your repository"}, and then live{(shown ?? status).domain ? ` at ${(shown ?? status).domain}` : ""}, where everyone can see it.
              </DialogDescription>
            </DialogHeader>
            {(shown ?? status).changed.length > 0 && <Input aria-label="What changed" value={message} maxLength={200} disabled={running || Boolean(result && !result.failed)} onChange={e => setMessage(e.target.value)} autoFocus />}
            <ol className="flex flex-col gap-1.5 text-small">
              {STEPS.map(({ step, label }) => {
                const state = stateOf(step)
                return (
                  <li key={step} className={cn("flex items-start gap-2", state === "todo" && "text-muted-foreground")}>
                    <Icon icon={state === "done" ? CheckIcon : state === "failed" ? XIcon : CircleIcon} size="xs" className={cn("mt-0.5 shrink-0", state === "done" && "text-(--ohm-green)", state === "failed" && "text-destructive")} />
                    <span>{label}{state === "failed" && <span className="block text-destructive">{result!.failed!.reason}</span>}</span>
                  </li>
                )
              })}
            </ol>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={running} onClick={() => setAsking(false)}>{result && !result.failed ? "Done" : "Cancel"}</Button>
              {!(result && !result.failed) && <Button type="submit" disabled={running || ((shown ?? status).changed.length > 0 && !message.trim())}>{running ? "Publishing" : result?.failed ? "Publish again" : "Publish"}</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
