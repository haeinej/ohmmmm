// Publishing a block from the home on this computer (docs/serve.md, "Publishing"; flows/paths.md C5,
// C6): choosing Everyone on a block shows the plan the bridge makes — its address, its label, the
// images that go with it — and nothing is written until the person presses Publish. The bridge then
// writes the post to their PDS with the app password kept on this computer, and marks the file public.
// Taking a public block back first takes its post down. These are the person's alone: no WebMCP tool
// publishes or takes down (vault/plans/standard-site.md: what no agent can do).
import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { LoadingDot } from "@/components/ui/screen"
import type { LocalSource, PostLabel, PublishDraft } from "@/data/local-source"
import { blockVersion, getSource, titleOf, type Doc } from "@/data/workspace-data"
import { sourceChanged } from "./store"

/** The home on this computer, when the workspace is it and its bridge can publish. */
export const publisher = (): LocalSource | null => {
  const source = getSource()
  return "planPublish" in source ? source as LocalSource : null
}

const said = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem))
const sizeOf = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

export function PublishDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const source = publisher()
  const [draft, setDraft] = useState<PublishDraft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // What the fields hold, and what the person last asked to be planned (nothing: the channel's default).
  const [label, setLabel] = useState<{ label: string; sublabel: string } | null>(null)
  const [asked, setAsked] = useState<PostLabel | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const labelId = useId()
  const sublabelId = useId()

  // The plan, again whenever the person tries another label (after they stop typing).
  useEffect(() => {
    if (!source) return
    const held = blockVersion(doc.id)
    if (!held) return setProblem("There is no such block any more.")
    let live = true
    const wait = setTimeout(() => {
      source.planPublish(held.ref, asked)
        .then(next => {
          if (!live) return
          setDraft(next)
          setProblem(null)
          if (!asked) setLabel({ label: next.label, sublabel: next.sublabel })
        })
        .catch(error => { if (live) setProblem(said(error)) })
    }, asked ? 350 : 0)
    return () => { live = false; clearTimeout(wait) }
  }, [doc.id, asked?.label, asked?.sublabel]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (next: { label: string; sublabel: string }) => {
    setLabel(next)
    setAsked({ label: next.label.trim(), sublabel: next.label.trim() ? next.sublabel.trim() : "" })
  }

  const title = titleOf(doc)
  // Publish only what the plan on screen says: while a new label is being planned, the button waits.
  const current = draft && label && (draft.update || (draft.label === label.label.trim() && draft.sublabel === (label.label.trim() ? label.sublabel.trim() : ""))) ? draft : null
  const publish = () => {
    const held = blockVersion(doc.id)
    if (!source || !current || !held) return
    setBusy(true)
    source.publishBlock(held.ref, current)
      .then(done => {
        sourceChanged()
        notify({ message: `${done.update ? "Updated" : "Published"} “${title}” at ${done.address}`, tone: "info", action: { label: "Open", run: () => window.open(done.address, "_blank", "noopener") } })
        onClose()
      })
      .catch(error => setProblem(said(error)))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft?.update ? `Update “${title}” on your site?` : `Publish “${title}”?`}</DialogTitle>
          <DialogDescription>
            {draft?.update
              ? "Its post is rewritten with the block as it is now. It keeps its address and its date."
              : "It becomes a post on your PDS, public the moment it is written: anyone can read it, and copies others make cannot be recalled."}
          </DialogDescription>
        </DialogHeader>

        {!draft && !problem ? <div className="flex justify-center py-4"><LoadingDot /></div> : null}
        {draft ? (
          <div className="flex flex-col gap-3 text-body">
            {draft.update ? null : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={labelId} className="font-medium">Label</label>
                  <Input id={labelId} value={label?.label ?? ""} maxLength={100} disabled={busy} placeholder="other"
                    onChange={event => edit({ label: event.target.value, sublabel: label?.sublabel ?? "" })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={sublabelId} className="font-medium">Sublabel</label>
                  <Input id={sublabelId} value={label?.sublabel ?? ""} maxLength={100} disabled={busy || !label?.label.trim()} placeholder="none"
                    onChange={event => edit({ label: label?.label ?? "", sublabel: event.target.value })} />
                </div>
              </div>
            )}
            {draft.address ? <p className="break-all text-muted-foreground">At <span className="font-mono text-foreground">{draft.address}</span></p> : null}
            {!draft.update && !draft.labelSaved && label?.label.trim() ? <p className="text-muted-foreground">The label is kept on its channel, for the next block you publish from it.</p> : null}
            {draft.attachments.length ? (
              <p className="text-muted-foreground">
                With {draft.attachments.length === 1 ? "its image" : `${draft.attachments.length} files`}: {draft.attachments.map(each => `${each.path.split("/").at(-1)} (${sizeOf(each.size)})`).join(", ")}
              </p>
            ) : null}
            {draft.notes.map(note => <p key={note} className="text-muted-foreground">{note}</p>)}
            {[...draft.problems, ...draft.needs.map(need => need.say)].map(text => <p key={text} className="text-destructive">{text}</p>)}
          </div>
        ) : null}
        {problem ? <p className="text-body text-destructive">{problem}</p> : null}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !current?.ready} onClick={publish}>{busy ? <LoadingDot /> : null}{draft?.update ? "Update" : "Publish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TakeDownDialog({ doc, to, onClose }: { doc: Doc; to: "private" | "friends"; onClose: () => void }) {
  const source = publisher()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const title = titleOf(doc)
  const takeDown = () => {
    const held = blockVersion(doc.id)
    if (!source || !held) return
    setBusy(true)
    source.unpublishBlock(held.ref, to)
      .then(done => {
        sourceChanged()
        notify({ message: done.removed ? `Took “${title}” down from your site` : `“${title}” had no post; it is now ${to === "private" ? "only yours" : "for friends"}`, tone: "info" })
        onClose()
      })
      .catch(error => setProblem(said(error)))
      .finally(() => setBusy(false))
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Take “{title}” down from your site?</DialogTitle>
          <DialogDescription>
            Its post is removed from your PDS first; then the block is kept {to === "private" ? "only for you" : "for friends, not shared yet"}. Copies others already made are not recalled.
          </DialogDescription>
        </DialogHeader>
        {problem ? <p className="text-body text-destructive">{problem}</p> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={takeDown}>{busy ? <LoadingDot /> : null}Take down</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
