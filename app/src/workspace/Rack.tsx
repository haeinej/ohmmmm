import type { LucideIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BotIcon, FileTextIcon, MessageSquareIcon, HouseIcon, LayoutGridIcon, ImageIcon, LinkIcon, FolderPlusIcon, PlusIcon, SparklesIcon, StickyNoteIcon, WrenchIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { addLink, addSiteFile, NEW_CHANNEL, NEW_NOTE, NEW_PROMPT } from "@/site/source"
import { notify } from "@/components/ui/notice"
import { NotificationCenter } from "./NotificationCenter"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { icons } from "@/lib/icons"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"
import { createDraft, loadAgents, me, openSettings, report, setSearchOpen, SHORT_LENGTH, shortLength, showFeed, showMain, toggleSide, useWorkspace, waitingAgentActions, writeShort } from "./store"

const rackButton = cn(
  "inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none",
  "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
  // The place you are in is a filled square, as in the Codex app.
  "aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shade-1",
)

function RackButton({ label, shortcut, active, dot, onClick, children }: {
  label: string; shortcut?: string; active?: boolean; dot?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={cn(rackButton, "relative")} />}>
        {children}
        {dot && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar dark:bg-foreground dark:ring-background" />}
      </TooltipTrigger>
      <TooltipContent side="right">
        {label} {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

const RackIcon = ({ icon }: { icon: LucideIcon }) => <Icon icon={icon} />

/** The rack: a column of icons on the page itself, apart from the panels. */
export function Rack() {
  const { side, searchOpen, view } = useWorkspace()
  // Agents wait for the person: the rack marks Agents while any action waits. Read now and then;
  // a home without the vault service has no agents, and says nothing about it.
  useEffect(() => {
    const read = () => { loadAgents().catch(() => {}) }
    read()
    const every = setInterval(read, 15000)
    return () => clearInterval(every)
  }, [])
  const waiting = waitingAgentActions()
  const picker = useRef<HTMLInputElement>(null)
  const [linking, setLinking] = useState(false)
  const [posting, setPosting] = useState(false)
  const [short, setShort] = useState("")
  const left = SHORT_LENGTH - shortLength(short)
  return (
    <nav aria-label="Workspace" className="flex w-[68px] shrink-0 flex-col items-center gap-2.5 pt-4 pb-1">
      {/* The ohm dot, at the size of an icon, in a slot the size of a button. */}
      <RackButton label="Home" active={side === "repo"} onClick={() => toggleSide("repo")}><RackIcon icon={HouseIcon} /></RackButton>
      <RackButton label={waiting ? `Agents: ${waiting} waiting for you` : "Agents"} active={side === "agents"} dot={waiting > 0} onClick={() => toggleSide("agents")}><RackIcon icon={BotIcon} /></RackButton>
      {/* The feed: everything in your home, newest first, in the main panel (flows/feed.md). */}
      <RackButton label="Feed" active={view.kind === "feed"} onClick={() => (view.kind === "feed" ? showMain() : showFeed())}><RackIcon icon={LayoutGridIcon} /></RackButton>
      <span aria-hidden className="my-2 h-px w-6 bg-border" />
      <RackButton label="Search" shortcut="⌘K" active={searchOpen} onClick={() => setSearchOpen(true)}><RackIcon icon={icons.search} /></RackButton>
      {/* A picture chosen from this computer is added to the site, in Photographs › new, as a save. */}
      <input ref={picker} type="file" accept="image/*,video/*" multiple hidden onChange={e => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ""
        if (!files.length) return
        const safe = (name: string) => name.replace(/[^\w.-]+/g, "-").replace(/^-+/, "")
        Promise.all(files.map(f => addSiteFile(`photographs/new/${Date.now().toString(36)}-${safe(f.name)}`, f)))
          .then(() => notify({ message: files.length === 1 ? "Added to Photographs › new. It is on your computer only until you publish." : `${files.length} added to Photographs › new. They are on your computer only until you publish.` }),
            e => notify({ message: (e as Error).message, tone: "error" }))
      }} />
      {/* A link: a page that isn't yours, kept as it is, in Artifacts. Not in your site, not published. */}
      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent className="sm:max-w-md">
          <form className="contents" onSubmit={e => {
            e.preventDefault()
            const url = new FormData(e.currentTarget).get("url")?.toString() ?? ""
            setLinking(false)
            addLink(url).then(l => notify({ message: `Kept “${l.title}” in Artifacts.` }), e => notify({ message: (e as Error).message, tone: "error" }))
          }}>
            <DialogHeader>
              <DialogTitle>Keep a link</DialogTitle>
              <DialogDescription>A page that isn't yours, kept in Artifacts to look at, place and annotate. It stays out of your site.</DialogDescription>
            </DialogHeader>
            <Input name="url" type="url" required autoFocus placeholder="https://…" className="max-w-80" />
            <DialogFooter><Button type="submit">Keep</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* A short post, as on Bluesky (flows/short-post.md): saved private; publishing is its own step. */}
      <Dialog open={posting} onOpenChange={setPosting}>
        <DialogContent className="sm:max-w-lg">
          <form className="contents" onSubmit={e => {
            e.preventDefault()
            writeShort({ text: short }).then(() => {
              setPosting(false); setShort("")
              notify({ message: "Saved. Only you see it until you publish." })
              showFeed()
            }, problem => notify({ message: (problem as Error).message, tone: "error" }))
          }}>
            <DialogHeader>
              <DialogTitle>Post</DialogTitle>
              <DialogDescription>A short post, as on Bluesky. It is saved in Collections › posts, and only you see it until you publish it.</DialogDescription>
            </DialogHeader>
            <Textarea name="text" autoFocus rows={5} value={short} onChange={e => setShort(e.target.value)} placeholder="What's on your mind?"
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit() }} />
            <DialogFooter className="items-center">
              <span aria-live="polite" className={cn("me-auto text-small tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")}>{left}</span>
              <Button type="submit" disabled={!short.trim() || left < 0}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Make something. What lasts (a block, a channel) is made here, structured; a note is the canvas's own. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<button type="button" aria-label="New" className={rackButton} />} />}>
            <RackIcon icon={PlusIcon} />
          </TooltipTrigger>
          <TooltipContent side="right">New <Kbd>⌘N</Kbd></TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
          {/* A block is any kind of thing: writing now; an image or a link once the site can take new files. */}
          <DropdownMenuGroup>
          <DropdownMenuLabel className="text-small text-muted-foreground">New block</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void report(createDraft())}><Icon icon={FileTextIcon} size="sm" />Writing</DropdownMenuItem>
          <DropdownMenuItem onClick={() => picker.current?.click()}><Icon icon={ImageIcon} size="sm" />Image<span className="ms-auto text-small text-muted-foreground">Photographs</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPosting(true)}><Icon icon={MessageSquareIcon} size="sm" />Post<span className="ms-auto text-small text-muted-foreground">Short, as on Bluesky</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLinking(true)}><Icon icon={LinkIcon} size="sm" />Link<span className="ms-auto text-small text-muted-foreground">A page</span></DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent(NEW_CHANNEL))}><Icon icon={FolderPlusIcon} size="sm" />New channel</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent(NEW_PROMPT, { detail: "Build me a tool that " }))}><Icon icon={WrenchIcon} size="sm" />Tool<span className="ms-auto text-small text-muted-foreground">Your agent builds it</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent(NEW_PROMPT))}><Icon icon={SparklesIcon} size="sm" />Prompt<span className="ms-auto text-small text-muted-foreground">To your agent</span></DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent(NEW_NOTE))}><Icon icon={StickyNoteIcon} size="sm" />Note on canvas<span className="ms-auto text-small text-muted-foreground">Annotation</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <NotificationCenter />
      <RackButton label="You" active={side === "profile"} onClick={() => (side === "profile" ? toggleSide("profile") : openSettings())}>
        <Avatar className="size-7"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
      </RackButton>
    </nav>
  )
}
