// Deploying the site to Cloudflare from the canvas header (flows/site.md). The person's own step,
// like Push: it says what will go where before anything is sent, and no tool does it. A deploy is
// of a commit, so what went up can be named, found again and put back.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { deploySite, readDeploy, type Deployed, type DeployStatus } from "./source"

const short = (commit: string) => commit.slice(0, 7)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export function DeployControl({ onDeployed }: { onDeployed?(): void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<DeployStatus | null>(null)
  const [failed, setFailed] = useState("")
  const [project, setProject] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<Deployed | null>(null)

  useEffect(() => {
    if (!open) return
    setStatus(null); setFailed(""); setLast(null)
    readDeploy().then(s => { setStatus(s); setProject(s.project) }, e => setFailed((e as Error).message))
  }, [open])

  const send = async (commit?: string) => {
    setBusy(commit ?? "head")
    try {
      const deployed = await deploySite(project, commit)
      setLast(deployed)
      setStatus(await readDeploy())
      notify({ message: `Deployed ${short(deployed.commit)} to ${deployed.url}`, tone: "info" })
      onDeployed?.()
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setBusy(null)
  }

  const blocked = !status ? "" : !status.signedIn ? "Sign in to Cloudflare first: run `npx wrangler login` in a terminal, then open this again."
    : status.changed ? `${status.changed === 1 ? "1 file is" : `${status.changed} files are`} changed and not committed. Commit first: a deploy is of a commit, so they would be left behind.` : ""

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Deploy</Button>
      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deploy to Cloudflare</DialogTitle>
            <DialogDescription>
              {failed ? failed : !status ? "Reading where your site would go." : (
                <>The commit {short(status.commit)} (“{status.subject}”) on {status.branch} goes to {status.account ? `${status.account}, ` : ""}Cloudflare Pages.
                  {status.production ? " This branch is the live one, so it replaces what the project serves." : ` This branch gets a preview address of its own; ${status.productionBranch} stays as it is.`}
                  {" "}Everyone with the address can see it.</>
              )}
            </DialogDescription>
          </DialogHeader>

          {status && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-small">
                <span className="text-muted-foreground">Project {status.projects.includes(project) ? "" : "(new: it is made on the first deploy)"}</span>
                <Input className="max-w-64" value={project} maxLength={58} spellCheck={false} list="ohm-pages-projects" onChange={e => setProject(e.target.value)} />
                <datalist id="ohm-pages-projects">{status.projects.map(p => <option key={p} value={p} />)}</datalist>
              </label>
              {blocked && <p className="text-small text-muted-foreground">{blocked}</p>}
              {last && <p className="text-small">Now at <a className="underline underline-offset-2" href={last.url} target="_blank" rel="noopener noreferrer">{last.url}</a>. Your own domain follows once it points at this project in Cloudflare.</p>}

              {status.history.length > 0 && (
                <section aria-label="Earlier deploys" className="flex flex-col gap-1">
                  <h3 className="text-small font-medium">Earlier deploys</h3>
                  {status.history.map(d => (
                    <div key={`${d.at}:${d.commit}`} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-small">
                      <a className="min-w-0 flex-1 truncate underline-offset-2 hover:underline" href={d.url} target="_blank" rel="noopener noreferrer" title={d.url}>{short(d.commit)} · {d.subject}</a>
                      <span className="shrink-0 text-muted-foreground">{when(d.at)}{d.production ? "" : " · preview"}</span>
                      <Button size="xs" variant="ghost" disabled={!!busy || !status.signedIn} onClick={() => void send(d.commit)}>{busy === d.commit ? "Putting back" : "Put back"}</Button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>Close</Button>
            <Button disabled={!status || !!blocked || !!busy || !project.trim()} onClick={() => void send()}>{busy === "head" ? "Deploying" : "Deploy"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
