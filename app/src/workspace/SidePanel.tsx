import { useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AtSignIcon, BrainIcon, EllipsisIcon, EyeIcon, EyeOffIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, GlobeIcon, HistoryIcon, ListTreeIcon, LockIcon, LogOutIcon, MessageCircleIcon, NetworkIcon, UserPlusIcon, UsersIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { isBlock, locationOf, channelRowId, byId, channelRecords, channelsOf, cortex, docIdOf, inOrder, placedIn, blocks, sees, titleOf, cortexState, homeStatus, privateLayer, type Audience, type Doc } from "@/data/workspace-data"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/cn"
import { DOC_DRAG } from "./drop"
import { GraphView } from "./GraphView"
import { RepoHistory } from "@/history/History"
import { PrimeIcon } from "./PrimeIcon"
import { RowMenu } from "./RowMenu"
import { FilterMenu } from "./FilterMenu"
import { activeCount, NO_FILTERS } from "./filters"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { VisibilityMarks } from "./VisibilityMarks"
import { startChannel } from "./PageActions"
import { SETTINGS_TABS } from "./settings-tabs"
import { panelTitle, SidePanelFrame } from "./Surface"
import {
  createDraft, kept, marks, me, moveBlock, moveChannel, open, openSettings, report, signOut, setAudience, setFilters, setRepoMode, setScope, setShowVisibility, useWorkspace,
} from "./store"

/**
 * Folders › folders inside them › items. In the vault the folders are channels, and a block is in
 * every channel it was collected into: its row in its home channel has its own id, and each other
 * row `<id>/<channel path>`. In the cortex the folders are fixed categories. Folder ids are prefixed so they
 * never collide with docs.
 */
type Placement = { path: string; id: string }
const inSection = (d: Doc): Placement[] => [{ path: locationOf(d), id: d.id }]
const inChannels = (d: Doc): Placement[] => channelsOf(d).map((path, i) => ({ path, id: i === 0 ? d.id : channelRowId(d.id, path) }))
function toTree(prime: string, docs: Doc[], order?: string[], placements = inSection, empty: string[] = []): FileTreeNode[] {
  const labels = new Map<string, Map<string | undefined, { doc: Doc; id: string }[]>>()
  // Channels are records: an empty one is still a folder.
  for (const path of empty) {
    const [top, inner] = path.split("/")
    const subs = labels.get(top) ?? new Map()
    if (inner && !subs.has(inner)) subs.set(inner, [])
    labels.set(top, subs)
  }
  for (const d of docs) for (const { path, id } of placements(d)) {
    const [top, inner] = path.split("/")
    const subs = labels.get(top) ?? new Map()
    subs.set(inner, [...(subs.get(inner) ?? []), { doc: d, id }])
    labels.set(top, subs)
  }
  // Blocks in each channel's own order (its _channel.md, through workspace-data inOrder).
  const leaves = (path: string, list: { doc: Doc; id: string }[] = []): FileTreeNode[] => {
    const ordered = inOrder(path, list.map(l => l.doc))
    return ordered.map(d => list.find(l => l.doc === d)!).map(({ doc: d, id }) => ({ id, name: `${d.icon ? `${d.icon} ` : ""}${titleOf(d)}` }))
  }
  const names = [...labels.keys()].sort((a, b) => {
    if (a === "other") return 1
    if (b === "other") return -1
    const ia = order?.indexOf(a) ?? -1, ib = order?.indexOf(b) ?? -1
    return ia === -1 || ib === -1 ? a.localeCompare(b) : ia - ib
  })
  return names.map(label => {
    const subs = labels.get(label)!
    return {
      id: `${prime}:${label}`, name: label,
      children: [
        ...[...subs].filter(([s]) => s).map(([s, list]) => ({ id: `${prime}:${label}/${s}`, name: s!, children: leaves(`${label}/${s}`, list) })),
        ...leaves(label, subs.get(undefined)),
      ],
    }
  })
}
const folderIds = (nodes: FileTreeNode[]): string[] =>
  nodes.flatMap(n => (n.children ? [n.id, ...folderIds(n.children)] : []))

const toggle = "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"

const AUDIENCES: { id: Audience; label: string; note: string; icon: LucideIcon }[] = [
  { id: "private", label: "You", note: "As you: everything, your vault and your cortex.", icon: LockIcon },
  { id: "friends", label: "Friends", note: "As a friend: blocks for friends, and for everyone.", icon: UsersIcon },
  { id: "public", label: "Public", note: "As anyone: blocks for everyone.", icon: GlobeIcon },
]

// ─── Home ──────────────────────────────────────────────────────


/** A channel's row being dragged: the channel's path. Blocks travel as DOC_DRAG, with their row in ROW_DRAG. */
const CHANNEL_DRAG = "application/x-ohm-channel"
const ROW_DRAG = "application/x-ohm-row"
const shown = (path: string) => path.replace("/", " › ")

/**
 * Dragging in the tree moves things, as in a file manager. A block's row dropped on a channel moves it
 * there; dropped above or below another block, it moves to that place in that block's channel. Hold
 * ⌥ to add it there and keep it where it was. A channel's row dropped on another channel goes inside
 * it; dropped on the vault row, it goes to the top. FileTree draws the rows; this marks them
 * draggable and handles the events by delegation, so the tree itself stays as ohm-ui has it.
 */
function useTreeDragDrop(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll<HTMLElement>("[data-slot=file-tree-item]").forEach(row => {
      const id = row.dataset.id ?? ""
      row.draggable = !id.includes(":") || id.startsWith("vault:")
    })
  })
  useEffect(() => {
    const root = ref.current
    if (!root) return
    type Target = { row: HTMLElement; channel: string | null; where: "into" | "before" | "after"; block?: string }
    let dragging: { kind: "block"; id: string; from: string | null } | { kind: "channel"; path: string } | null = null
    let over: HTMLElement | null = null
    const clear = () => { over?.removeAttribute("data-drop"); over = null }
    const rowOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-slot=file-tree-item], [data-drop-prime]")
    // The channel a block's row sits in: the one in its id, or its home channel for its own row.
    const channelOfRow = (id: string) => placedIn(id) ?? (byId(docIdOf(id)) ? locationOf(byId(docIdOf(id))!) : null)

    // What is being dragged: a row of this tree, or a block from elsewhere (its path pill), read fresh
    // from each event so a drag that ended outside the tree leaves nothing behind.
    const current = (e: DragEvent) => dragging ?? (e.dataTransfer?.types.includes(DOC_DRAG) ? { kind: "block" as const, id: "", from: null } : null)
    const targetOf = (e: DragEvent): Target | null => {
      const row = rowOf(e)
      const dragging = current(e)
      if (!row || !dragging) return null
      const id = row.dataset.id ?? ""
      if (row.dataset.dropPrime === "vault") return dragging.kind === "channel" ? { row, channel: null, where: "into" } : null
      if (id.startsWith("vault:")) return { row, channel: id.slice(6), where: "into" }
      if (dragging.kind === "block" && !id.includes(":") && isBlock(byId(docIdOf(id)))) {
        const r = row.getBoundingClientRect()
        return { row, channel: channelOfRow(id), where: e.clientY < r.top + r.height / 2 ? "before" : "after", block: docIdOf(id) }
      }
      return null
    }

    const start = (e: DragEvent) => {
      const id = rowOf(e)?.dataset.id
      if (!id || !e.dataTransfer) return
      if (id.startsWith("vault:")) {
        dragging = { kind: "channel", path: id.slice(6) }
        e.dataTransfer.setData(CHANNEL_DRAG, dragging.path)
        e.dataTransfer.effectAllowed = "move"
      } else if (!id.includes(":")) {
        dragging = { kind: "block", id: docIdOf(id), from: channelOfRow(id) }
        e.dataTransfer.setData(DOC_DRAG, docIdOf(id))
        e.dataTransfer.setData(ROW_DRAG, id)
        e.dataTransfer.effectAllowed = "copyMove"
      }
    }
    const dragover = (e: DragEvent) => {
      // A block dragged in from elsewhere (its path pill) moves from its home channel.
      const t = targetOf(e)
      if (!t) return clear()
      e.preventDefault()
      e.dataTransfer!.dropEffect = current(e)?.kind === "block" && e.altKey ? "copy" : "move"
      if (t.row !== over || over?.dataset.drop !== t.where) { clear(); over = t.row; t.row.setAttribute("data-drop", t.where) }
    }
    const drop = (e: DragEvent) => {
      const t = targetOf(e)
      const was = current(e)
      clear()
      dragging = null
      if (!t || !was) return
      e.preventDefault()
      try {
        if (was.kind === "channel") {
          void report(moveChannel(was.path, t.channel).then(({ path }) => {
            if (path !== was.path) window.dispatchEvent(new CustomEvent("ohm:channel-renamed", { detail: { from: was.path, to: path } }))
            notify({ message: `Moved ${shown(was.path.split("/").at(-1)!)} to ${t.channel ? shown(t.channel) : "the top"}`, tone: "info" })
          }))
          return
        }
        const id = was.id || e.dataTransfer?.getData(DOC_DRAG) || ""
        const doc = byId(id)
        if (!doc || !t.channel || t.block === id) return
        const from = was.from ?? locationOf(doc)
        const into = t.channel, copy = e.altKey
        void report(moveBlock(id, from, into, { keep: copy, ...(t.where === "before" ? { before: t.block } : t.where === "after" ? { after: t.block } : {}) })
          .then(({ published, ordered }) => notify({ message: from === into && !ordered && t.where !== "into" ? "A private block's place in a channel's order isn't kept yet"
            : from === into ? `Moved within ${shown(into)}`
            : `${copy ? "Added" : "Moved"} “${titleOf(doc)}” to ${shown(into)}${published ? ". Its address changes when you next publish" : ""}`, tone: "info" })))
      } catch (err) { notify({ message: (err as Error).message }) }
    }
    const end = () => { dragging = null; clear() }
    root.addEventListener("dragstart", start)
    root.addEventListener("dragover", dragover)
    root.addEventListener("dragleave", clear)
    root.addEventListener("drop", drop)
    root.addEventListener("dragend", end)
    return () => {
      root.removeEventListener("dragstart", start)
      root.removeEventListener("dragover", dragover)
      root.removeEventListener("dragleave", clear)
      root.removeEventListener("drop", drop)
      root.removeEventListener("dragend", end)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * One of the home’s two parts: its own icon (PrimeIcon) and its name, bold forest. The icon is an
 * outline when closed and filled when open, so open and closed read at a glance.
 */
function PrimeRow({ prime, open: isOpen, onOpen, locked, onExpandAll, allOpen, onOnly, onNew, onNewChannel }: {
  prime: "cortex" | "vault"; open: boolean; onOpen: () => void; locked?: boolean
  onExpandAll: () => void; allOpen: boolean; onOnly: () => void; onNew?: () => void; onNewChannel?: () => void
}) {
  const [menu, setMenu] = useState(false)
  const run = (k: string) => {
    if (k === "e") onExpandAll()
    else if (k === "o") onOnly()
    else if (k === "n" && onNew) onNew()
    else if (k === "c" && onNewChannel) onNewChannel()
    else return false
    setMenu(false)
    return true
  }
  return (
    <div className="group/prime relative" data-drop-prime={prime === "vault" ? "vault" : undefined} onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && run(e.key.toLowerCase())) e.preventDefault() }}>
      <button type="button" aria-expanded={isOpen} onClick={onOpen} disabled={locked}
        className="ux-row flex w-full items-center gap-1.5 px-1.5 pe-8 text-left">
        <Icon icon={isOpen ? ChevronDownIcon : ChevronRightIcon} size="sm" className={cn("text-muted-foreground", locked && "invisible")} />
        <PrimeIcon kind={prime} filled={isOpen} className="text-primary dark:text-foreground" />
        <span className="text-body font-bold text-primary dark:text-foreground">{prime}</span>
        {locked && <Icon icon={LockIcon} size="xs" className="ms-auto text-muted-foreground" aria-label="Only you see your cortex" />}
      </button>
      {!locked && (
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`More for ${prime}`}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color] duration-(--ohm-duration-press) group-hover/prime:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 aria-expanded:bg-foreground/10 aria-expanded:opacity-100" />
          }>
            <Icon icon={EllipsisIcon} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={6} className="w-56"
            onKeyDown={e => { if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && run(e.key.toLowerCase())) e.preventDefault() }}>
            {onNew && <DropdownMenuItem onClick={() => run("n")}>New block<DropdownMenuShortcut>N</DropdownMenuShortcut></DropdownMenuItem>}
            {onNewChannel && <DropdownMenuItem onClick={() => run("c")}>New channel<DropdownMenuShortcut>C</DropdownMenuShortcut></DropdownMenuItem>}
            <DropdownMenuItem onClick={() => run("e")}>{allOpen ? "Collapse all" : "Expand all"}<DropdownMenuShortcut>E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => run("o")}>Show only {prime}<DropdownMenuShortcut>O</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function RepoPanel() {
  const { view, rev, repoMode, scope, audience, showVisibility } = useWorkspace()
  const { filters } = useWorkspace()
  const filtering = activeCount(filters) > 0
  const cortexTree = useMemo(() => toTree("cortex", cortex.filter(kept), ["profile", "observations", "skills", "tools"]), [rev, filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const vaultDocs = useMemo(() => blocks.filter(p => sees(audience, p) && !marks.archived.has(p.id) && kept(p)), [rev, audience, filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = blocks.concat(cortex).filter(d => marks.pinned.has(d.id) && (!isBlock(d) || sees(audience, d)) && kept(d))
  const archived = blocks.filter(d => marks.archived.has(d.id) && kept(d))
  const [showArchived, setShowArchived] = useState(false)
  const [rows, setRows] = useState<HTMLDivElement | null>(null)
  // Empty channels show to you, unfiltered; seen as someone else, a channel shows only what they can see in it.
  const vaultTree = useMemo(() => toTree("vault", vaultDocs, undefined, inChannels,
    audience === "private" && !filtering ? channelRecords.map(c => c.path) : []), [vaultDocs, audience, filtering, rev]) // eslint-disable-line react-hooks/exhaustive-deps
  const showCortex = scope.cortex, showVault = scope.vault
  const treeRef = useRef<HTMLDivElement | null>(null)
  useTreeDragDrop(treeRef, [repoMode])
  // The cortex is yours alone, and opens only on a device that unlocked your keys.
  const cortexLocked = audience !== "private" || cortexState !== "open"
  const allFolders = useMemo(() => [
    ...(showCortex ? ["prime:cortex", ...folderIds(cortexTree)] : []),
    ...(showVault ? ["prime:vault", ...folderIds(vaultTree)] : []),
  ], [cortexTree, vaultTree, showCortex, showVault])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["prime:cortex", "prime:vault", ...folderIds(vaultTree)]))
  // The tree follows the open block: when something asks to be revealed (a block opened from anywhere,
  // or a folder from the path pill), the way to it opens, it scrolls into view and flashes once.
  const { reveal } = useWorkspace()
  useEffect(() => {
    if (!reveal || repoMode !== "tree") return
    const doc = byId(reveal.target)
    const [prime, path] = doc ? [isBlock(doc) ? "vault" : "cortex", locationOf(doc)]
      : (reveal.target.split(":") as [string, string])
    if (path === undefined) return
    const parts = path.split("/")
    const ways = [`prime:${prime}`, ...parts.map((_, i) => `${prime}:${parts.slice(0, i + 1).join("/")}`)]
    setExpanded(s => (ways.every(w => s.has(w)) ? s : new Set([...s, ...ways])))
    const t = setTimeout(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-slot=file-tree-item][data-id="${CSS.escape(reveal.target)}"]`)
      if (!row) return
      row.scrollIntoView({ block: "nearest", behavior: "smooth" })
      row.setAttribute("data-flash", "")
      setTimeout(() => row.removeAttribute("data-flash"), 900)
    }, 60)
    return () => clearTimeout(t)
  }, [reveal?.n, repoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtering opens every folder, so what matches is in view.
  useEffect(() => { if (filtering) setExpanded(new Set(allFolders)) }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // A renamed channel stays open along with any nested channels.
  useEffect(() => {
    const moved = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail
      setExpanded(s => new Set([...s].map(id => (id === `vault:${from}` || id.startsWith(`vault:${from}/`) ? `vault:${to}${id.slice(6 + from.length)}` : id))))
    }
    window.addEventListener("ohm:channel-renamed", moved)
    return () => window.removeEventListener("ohm:channel-renamed", moved)
  }, [])
  // One prime folder's own expand-all, from its ⋯.
  const primeFolders = (p: "cortex" | "vault") => [`prime:${p}`, ...folderIds(p === "cortex" ? cortexTree : vaultTree)]
  const primeAllOpen = (p: "cortex" | "vault") => primeFolders(p).every(id => expanded.has(id))
  const expandPrime = (p: "cortex" | "vault") => {
    const ids = primeFolders(p), open = !primeAllOpen(p)
    setExpanded(s => { const n = new Set(s); for (const id of ids) open ? n.add(id) : n.delete(id); return n })
  }
  const flip = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selected = view.kind === "doc" ? view.id : null

  return (
    <SidePanelFrame
      label={`${me.name}'s home`}
      scroll={repoMode !== "graph"}
      heading={
        /* The home menu chooses which parts are visible. */
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <button type="button" aria-label={`Choose what to show in ${me.name}'s home`}
              className="flex max-w-full items-center gap-2 rounded-full bg-muted py-1 ps-1 pe-2.5 text-left transition-colors duration-(--ohm-duration-state) hover:bg-foreground/8 aria-expanded:bg-foreground/8" />
          }>
            <Avatar className="size-6"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
            <span className="truncate text-body font-medium">{me.name}</span>
            <Icon icon={ChevronDownIcon} size="sm" className="flex-none text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuCheckboxItem checked={scope.cortex && scope.vault} onCheckedChange={() => setScope({ cortex: true, vault: true })}>All</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={scope.cortex} onCheckedChange={v => setScope({ ...scope, cortex: v })}>Cortex</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={scope.vault} onCheckedChange={v => setScope({ ...scope, vault: v })}>Vault</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      actions={<>
        {/* The eye toggles visibility marks and lets you preview another audience. */}
        <Popover>
          <PopoverTrigger openOnHover delay={150} closeDelay={200} render={
            <Button size="icon-sm" variant="ghost" className={cn(toggle, audience !== "private" && "text-primary dark:text-(--ohm-green-light)")}
              aria-label="Show visibility marks" aria-pressed={showVisibility} onClick={() => setShowVisibility(!showVisibility)} />
          }>
            <Icon icon={showVisibility ? EyeIcon : EyeOffIcon} size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 gap-0 p-1">
            <p className="px-2.5 pt-1.5 pb-1 text-small text-muted-foreground">View as</p>
            <div role="radiogroup" aria-label="View as" className="flex flex-col">
              {AUDIENCES.map(a => (
                <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} onClick={() => setAudience(a.id)} title={a.note}
                  className="ux-menu-row flex w-full items-center gap-2 text-left">
                  <Icon icon={a.icon} size="sm" className="text-muted-foreground" />
                  <span className="flex-1">{a.label}</span>
                  <Icon icon={CheckIcon} size="sm" className={cn(audience !== a.id && "invisible")} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <FilterMenu />
        {/* History: every change and save, by you and by agents. Pressed while it shows. */}
        <Button size="icon-sm" variant="ghost" className={toggle} aria-label="History" title="History" aria-pressed={repoMode === "history"}
          onClick={() => setRepoMode(repoMode === "history" ? "tree" : "history")}>
          <Icon icon={HistoryIcon} size="sm" />
        </Button>
        {/* One switch: it shows the view you would go to. */}
        <Button size="icon-sm" variant="ghost" className="text-muted-foreground"
          aria-label={repoMode === "graph" ? "Show as list" : "Show as graph"} title={repoMode === "graph" ? "List" : "Graph"}
          onClick={() => setRepoMode(repoMode === "graph" ? "tree" : "graph")}>
          <Icon icon={repoMode === "graph" ? ListTreeIcon : NetworkIcon} size="sm" />
        </Button>
      </>}
    >
      {repoMode === "tree" ? (
        <div ref={el => { treeRef.current = el; setRows(el) }} data-show-visibility={showVisibility || undefined} className="relative flex flex-col gap-0.5 [&_[data-drop=into]]:bg-primary/10 [&_[data-drop=into]]:ring-1 [&_[data-drop=into]]:ring-primary/40">
          {pinned.length > 0 && <>
            <p className="px-2 pt-1 pb-0.5 text-small text-muted-foreground">Pinned</p>
            {pinned.map(d => (
              <button key={d.id} type="button" data-row-id={d.id} aria-current={selected === d.id || undefined} onClick={() => open(d.id)}
                className="ux-row flex w-full items-center gap-2 px-2.5 pe-8 text-left text-body">
                <span className="truncate">{d.icon ? `${d.icon} ` : ""}{titleOf(d)}</span>
              </button>
            ))}
            <div className="h-2" />
          </>}
          {filtering && vaultDocs.length + cortexTree.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-small text-muted-foreground">
              Nothing matches the filter.
              <Button size="xs" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>Clear filter</Button>
            </div>
          )}
          {!showCortex && !showVault && (
            <p className="px-2 py-6 text-center text-small text-muted-foreground">Choose Cortex or Vault from the menu above.</p>
          )}
          {showCortex && <>
            <PrimeRow prime="cortex" locked={cortexLocked} open={!cortexLocked && expanded.has("prime:cortex")} onOpen={() => flip("prime:cortex")}
              allOpen={primeAllOpen("cortex")} onExpandAll={() => expandPrime("cortex")} onOnly={() => setScope({ cortex: true, vault: false })} />
            {!cortexLocked && expanded.has("prime:cortex") && (
              <FileTree aria-label="cortex" className="ms-4 [--tree-inset:1rem] animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={cortexTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(id)} />
            )}
          </>}
          {showVault && <>
            <PrimeRow prime="vault" open={expanded.has("prime:vault")} onOpen={() => flip("prime:vault")}
              allOpen={primeAllOpen("vault")} onExpandAll={() => expandPrime("vault")} onOnly={() => setScope({ cortex: false, vault: true })}
              onNew={() => void report(createDraft())} onNewChannel={() => startChannel()} />
            {expanded.has("prime:vault") && (
              <FileTree aria-label="vault" className="ms-4 [--tree-inset:1rem] animate-in fade-in-0 slide-in-from-top-1 duration-(--ohm-duration-open)" nodes={vaultTree}
                expanded={expanded} onExpandedChange={setExpanded} selected={selected} onSelect={id => open(docIdOf(id))} />
            )}
            {expanded.has("prime:vault") && !filtering && blocks.length === 0 && (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyTitle>Your vault is empty</EmptyTitle>
                  <EmptyDescription>
                    {privateLayer === "open" ? "Start a block, or drop a Markdown file here." : "Nothing shared is here yet. Private blocks show once this device unlocks your keys."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>}
          {archived.length > 0 && <>
            <button type="button" onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
              className="ux-row mt-2 flex w-full items-center gap-1.5 px-1.5 text-left text-small text-muted-foreground">
              <Icon icon={showArchived ? ChevronDownIcon : ChevronRightIcon} size="sm" />Archived · {archived.length}
            </button>
            {showArchived && archived.map(d => (
              <button key={d.id} type="button" data-row-id={d.id} aria-current={selected === d.id || undefined} onClick={() => open(d.id)}
                className="ux-row ms-4 flex items-center gap-2 px-2.5 pe-8 text-left text-body text-muted-foreground">
                <span className="truncate">{titleOf(d)}</span>
              </button>
            ))}
          </>}
          <RowMenu container={rows} />
          <VisibilityMarks container={rows} />
        </div>
      ) : repoMode === "history" ? (
        <RepoHistory />
      ) : (
        <div className="-mx-1 flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-background">
          <GraphView />
        </div>
      )}
    </SidePanelFrame>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/** Who you are on top, then the settings, as agentic-twitter's account directory. */
function ProfilePanel() {
  const { view } = useWorkspace()
  const tab = view.kind === "settings" ? view.tab : undefined
  const row = "h-auto min-h-10 w-full justify-start gap-2.5 px-2.5 py-2 text-left font-normal whitespace-normal aria-[current=page]:bg-muted [&>svg]:text-muted-foreground aria-[current=page]:[&>svg]:text-foreground"
  return (
    <SidePanelFrame label="You"
      heading={
        /* You: picture, then name with handle under it. */
        <div className="flex min-w-0 items-center gap-3 px-1.5 pt-2">
          <Avatar className="size-12 flex-none"><AvatarFallback className="bg-primary text-body text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-(length:--ohm-type-title-size) leading-(--ohm-type-title-leading) font-semibold">{me.name}</span>
            <span className="truncate text-small text-muted-foreground">@{me.handle}</span>
          </div>
        </div>
      }>
      <nav aria-label="Your settings" className="flex flex-col gap-0.5">
        <p className="mx-2.5 mt-1 mb-2 text-small text-muted-foreground">Settings</p>
        {SETTINGS_TABS.map(t => (
          <Button key={t.id} variant="ghost" className={row} aria-current={tab === t.id ? "page" : undefined} onClick={() => openSettings(t.id)}>
            <Icon icon={t.icon} size="sm" /><span>{t.label}</span>
          </Button>
        ))}
        <div className="mt-9 flex flex-col">
          {/* Signing out ends the ohm session, which lives with ohm's sign-in on this address. */}
          <Button variant="ghost" className={row} onClick={() => void report(signOut())}>
            <Icon icon={LogOutIcon} size="sm" /><span>Sign out</span>
          </Button>
        </div>
      </nav>
    </SidePanelFrame>
  )
}

export function SidePanel() {
  const { side } = useWorkspace()
  if (side && homeStatus() !== "ready") return null
  if (side === "repo") return <RepoPanel />
  if (side === "profile") return <ProfilePanel />
  return null
}
