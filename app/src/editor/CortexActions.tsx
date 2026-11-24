// What the person does with a part of their cortex, beside its text in the editor (cortex/docs/model.md,
// "Who may change what"): pin or forget an observation, switch a tool on or off, remove a skill. And,
// on an open block, writing an observation about it: the person's own, or an agent's in the page,
// which waits for the person's approval (the cortex.observe tool, app/AGENTS.md rules 11 and 13).
import { useEffect, useState } from "react"
import { EyeIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { byId, titleOf, type Doc } from "@/data/workspace-data"
import { registerStepTool } from "@/webmcp"
import { requestDelete } from "@/workspace/PageActions"
import { pinObservation, switchTool, useWorkspace, writeObservation } from "@/workspace/store"
import { withAgent } from "@/workspace/tools"

const LIMIT = 2000
const about = (doc: Doc) => {
  const blocks = (doc.about ?? []).filter(item => !item.startsWith("channel:")).map(id => byId(id)).filter(Boolean) as Doc[]
  const channels = (doc.about ?? []).filter(item => item.startsWith("channel:")).map(item => item.slice(8).replaceAll("/", " › "))
  return [...blocks.map(titleOf), ...channels]
}

/** The actions on a cortex part open in the editor. */
export function CortexActions({ doc }: { doc: Doc }) {
  const pill = "flex items-center gap-1.5 ps-1 text-small whitespace-nowrap text-muted-foreground"
  if (doc.kind === "observation") {
    const on = about(doc)
    return (
      <span className={pill}>
        <span className="truncate">{doc.by && doc.by !== "you" ? `Seen by ${doc.by}` : "Yours"}{on.length ? ` · about ${on.join(", ")}` : " · about you"}</span>
        <Button size="xs" variant="ghost" aria-pressed={!!doc.pin} onClick={() => pinObservation(doc.id, !doc.pin)}
          title={doc.pin ? "Every agent session is handed it. Unpin" : "Hand it to every agent session"}>
          <Icon icon={doc.pin ? PinOffIcon : PinIcon} size="xs" />{doc.pin ? "Unpin" : "Pin"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => requestDelete(doc.id)}><Icon icon={Trash2Icon} size="xs" />Forget</Button>
      </span>
    )
  }
  if (doc.kind === "tool") {
    return (
      <span className={pill}>
        <span className="truncate">{doc.on ? "Agents may use it" : "Off: agents do not use it"}</span>
        <Switch aria-label={`${doc.title} is ${doc.on ? "on" : "off"}`} checked={!!doc.on} onCheckedChange={v => {
          switchTool(doc.id, v)
          notify({ message: `${doc.title} is ${v ? "on" : "off"}`, tone: "info" })
        }} />
      </span>
    )
  }
  if (doc.kind === "skill") {
    return (
      <span className={pill}>
        <span className="truncate">{doc.description || "A skill your agents use"}</span>
        <Button size="xs" variant="ghost" onClick={() => requestDelete(doc.id)}><Icon icon={Trash2Icon} size="xs" />Remove</Button>
      </span>
    )
  }
  return <span className={pill}><span className="truncate">Agents read it every session, and only propose changes</span></span>
}

/** An agent's observation, waiting for the person. */
type Asking = { text: string; why?: string; answer: (approved: boolean) => void }

/**
 * Write observation, on an open block: what you noticed about it goes into your cortex, about this
 * block. Its tool, cortex.observe, is registered while the block is open; an agent's observation
 * waits for the person's approval, and is written as the agent's.
 */
export function ObserveButton({ doc, className }: { doc: Doc; className?: string }) {
  const { agentsAllowed, offered } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [asking, setAsking] = useState<Asking | null>(null)

  const write = (said: string, why?: string) => writeObservation({ text: said, about: [doc.id] }, why)

  useEffect(() => {
    if (!agentsAllowed || !offered["cortex.observe"]) return
    const ac = new AbortController()
    registerStepTool<{ text: string; why?: string }, { id: string; about: string[]; next: string }>({
      name: "cortex.observe", title: "Write observation",
      description: "Asks the person to keep an observation about the open block in their cortex: something seen while working with them. Nothing is written until they approve it in the page. Say why in one line. Returns the observation's id.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", minLength: 1, maxLength: LIMIT }, why: { type: "string", maxLength: 400 } },
        required: ["text"], additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, about: { type: "array", items: { type: "string" } }, next: { const: "workspace.open" } } },
      annotations: { consequentialHint: true },
      approve: ({ text: said, why }, signal) => new Promise<boolean>((resolve, reject) => {
        if (!said.trim() || [...said.trim()].length > LIMIT) return reject(new DOMException(`An observation is what was seen, at most ${LIMIT} characters`, "DataError"))
        setAsking({ text: said.trim(), why, answer: resolve })
        signal.addEventListener("abort", () => { setAsking(null); reject(new DOMException("Cancelled", "AbortError")) })
      }),
      run: withAgent("Writing an observation", async ({ text: said, why }) => {
        const made = write(said, why)
        return { id: made.id, about: made.about, next: "workspace.open" }
      }),
    }, ac.signal).catch(console.error)
    return () => ac.abort()
  }, [agentsAllowed, offered, doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (approved: boolean) => {
    asking?.answer(approved)
    setAsking(null)
  }
  const mine = () => {
    try {
      write(text)
      setText("")
      setOpen(false)
      notify({ message: "Kept in your cortex, about this block", tone: "info" })
    } catch (error) {
      notify({ message: error instanceof Error ? error.message : "The observation could not be kept" })
    }
  }

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Write observation" title="Write observation" className={className} />}>
        <Icon icon={EyeIcon} size="sm" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2">
        <span className="text-body font-semibold">What did you notice?</span>
        <span className="text-small text-muted-foreground">Kept in your cortex, about “{titleOf(doc)}”. Your agents read it when they read this block.</span>
        <Textarea value={text} maxLength={LIMIT} rows={4} aria-label="Observation" onChange={e => setText(e.target.value)} />
        <Button disabled={!text.trim()} onClick={mine}>Write observation</Button>
      </PopoverContent>
    </Popover>
    <Dialog open={!!asking} onOpenChange={o => !o && answer(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>An agent asks to keep an observation</DialogTitle>
          <DialogDescription>
            About “{titleOf(doc)}”{asking?.why ? <>, because “{asking.why}”</> : null}. It goes into your cortex as the agent’s, and you can edit or forget it.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-muted px-4 py-3 text-body">{asking?.text}</p>
        <Badge variant="secondary" className="self-start">Only you</Badge>
        <DialogFooter>
          <Button variant="ghost" onClick={() => answer(false)}>Decline</Button>
          <Button onClick={() => answer(true)}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
