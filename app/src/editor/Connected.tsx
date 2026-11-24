// A block's connections: what it connects to (↗) and what connects to it (↙). Both kinds you make
// show here: a link in the text (`[[slug]]`, or words connected from the selection toolbar) and a
// connection on the whole block, made with + Connect, with an optional line on why. Both are
// evidence: you made them, they are in the content, and anyone can check them. The cortex never adds
// one; it can only point at them. Shown inside the connections card (ConnectionsCard).
import { useState } from "react"
import { ArrowDownLeftIcon, ArrowUpRightIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { bySlug, incoming, outgoing, titleOf, type Doc, type Outgoing } from "@/data/workspace-data"
import { connectDocs, disconnect, open, report, setWhy, useWorkspace } from "@/workspace/store"
import { ConnectPicker } from "./ConnectPicker"

const row = "group/row flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-(--ohm-duration-state) hover:bg-muted"

/** Where a connection was read: the words in the text. */
function Evidence({ o }: { o: Outgoing }) {
  if (!o.inText) return null
  return <span className="min-w-0 truncate text-small text-muted-foreground">in the text{o.words ? `: “${o.words}”` : ""}</span>
}

function WhyField({ doc, o }: { doc: Doc; o: Outgoing }) {
  const [value, setValue] = useState(o.why ?? "")
  return (
    <input value={value} onChange={e => setValue(e.target.value)} placeholder="Why? (optional)" aria-label={`Why it connects to ${o.slug}`}
      onBlur={() => value !== (o.why ?? "") && void report(setWhy(doc.id, o.slug, value))}
      onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); setValue(o.why ?? ""); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()) }
        if (e.key === "Enter") { e.stopPropagation(); e.currentTarget.blur() }
      }}
      className="h-6 min-w-0 flex-1 rounded-md bg-transparent px-1 text-small text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-background focus:text-foreground" />
  )
}

export const connectionCount = (doc: Doc) => outgoing(doc).filter(o => bySlug(o.slug)).length + incoming(doc).length

/** The rows and + Connect. `onOpen` runs before another block opens, so a card can close. */
export function ConnectionList({ doc, editable, onOpen }: { doc: Doc; editable: boolean; onOpen?: () => void }) {
  useWorkspace() // re-read on every change, so a link typed in the text shows here at once
  const [picking, setPicking] = useState(false)
  const go = (id: string) => { onOpen?.(); open(id) }
  const out = outgoing(doc).filter(o => bySlug(o.slug))
  const into = incoming(doc)

  return (
    <div className="flex flex-col gap-0.5">
      {out.map(o => {
        const target = bySlug(o.slug)!
        // A connection on the whole block carries a why and can be taken away here; one in the
        // text is changed by editing the text.
        const own = !!doc.connect?.some(c => c.to === o.slug)
        return (
          <div key={`to:${o.slug}`} className={row}>
            <Icon icon={ArrowUpRightIcon} size="sm" className="flex-none text-muted-foreground" aria-label="Connects to" />
            <button type="button" onClick={() => go(target.id)} className="max-w-[50%] flex-none truncate text-left text-body hover:underline">
              {target.icon ? `${target.icon} ` : ""}{titleOf(target)}
            </button>
            <Evidence o={o} />
            {own && (editable
              ? <WhyField key={o.why ?? ""} doc={doc} o={o} />
              : o.why && <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">{o.why}</span>)}
            {!own && <span className="flex-1" />}
            {editable && own && (
              <Button size="icon-sm" variant="ghost" aria-label={`Disconnect from ${titleOf(target)}`}
                className="size-6 flex-none text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                onClick={() => { void report(disconnect(doc.id, o.slug)); notify({ message: `Disconnected from “${titleOf(target)}”`, tone: "info" }) }}>
                <Icon icon={XIcon} size="sm" />
              </Button>
            )}
          </div>
        )
      })}

      {into.map(from => {
        const o = outgoing(from).find(x => x.slug === doc.slug)!
        return (
          <div key={`from:${from.id}`} className={row}>
            <Icon icon={ArrowDownLeftIcon} size="sm" className="flex-none text-muted-foreground" aria-label="Connected from" />
            <button type="button" onClick={() => go(from.id)} className="max-w-[50%] flex-none truncate text-left text-body hover:underline">
              {from.icon ? `${from.icon} ` : ""}{titleOf(from)}
            </button>
            {o.inText
              ? <Evidence o={o} />
              : o.why && <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">{o.why}</span>}
          </div>
        )
      })}

      {!out.length && !into.length && (
        <p className="px-2 py-1 text-small text-muted-foreground">
          Nothing connected yet.{editable ? " Select words and choose Connect, or connect the whole block." : ""}
        </p>
      )}

      {editable && (picking ? (
        <div className="mt-1 rounded-xl bg-muted/60 p-1 animate-in fade-in-0 duration-(--ohm-duration-open)">
          <ConnectPicker fromId={doc.id} className="w-full" onCancel={() => setPicking(false)} onPick={target => {
            setPicking(false)
            connectDocs(doc.id, target.id)
              .then(({ added }) => notify({ message: added ? `Connected to “${titleOf(target)}”` : `Already connected to “${titleOf(target)}”`, tone: "info" }))
              .catch(err => notify({ message: (err as Error).message }))
          }} />
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="mt-0.5 h-8 w-fit gap-1.5 px-2 font-normal text-muted-foreground" onClick={() => setPicking(true)}>
          <Icon icon={PlusIcon} size="sm" /> Connect
        </Button>
      ))}
    </div>
  )
}
