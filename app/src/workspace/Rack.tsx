import type { LucideIcon } from "lucide-react"
import { useEffect } from "react"
import { features } from "@/features"
import { BotIcon, FolderGitIcon, UsersIcon } from "lucide-react"
import { NotificationCenter } from "./NotificationCenter"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { icons } from "@/lib/icons"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"
import { createDraft, loadAgents, me, openSettings, report, setSearchOpen, toggleSide, useWorkspace, waitingAgentActions } from "./store"

const rackButton = cn(
  "inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none",
  "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
  "aria-pressed:bg-muted aria-pressed:text-foreground",
)

function RackButton({ label, shortcut, active, dot, onClick, children }: {
  label: string; shortcut?: string; active?: boolean; dot?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={cn(rackButton, "relative")} />}>
        {children}
        {dot && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-sidebar dark:bg-foreground dark:ring-background" />}
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
  const { side, searchOpen } = useWorkspace()
  // Agents wait for the person: the rack marks Agents while any action waits. Read now and then;
  // a home without the vault service has no agents, and says nothing about it.
  useEffect(() => {
    const read = () => { loadAgents().catch(() => {}) }
    read()
    const every = setInterval(read, 15000)
    return () => clearInterval(every)
  }, [])
  const waiting = waitingAgentActions()
  return (
    <nav aria-label="Workspace" className="flex w-[68px] shrink-0 flex-col items-center gap-1 py-3">
      {/* The ohm dot, at the size of an icon, in a slot the size of a button. */}
      <span className="mb-6 flex size-10 items-center justify-center" aria-hidden>
        <span className="size-icon rounded-full bg-primary dark:bg-foreground" />
      </span>
      <RackButton label="Search" shortcut="⌘K" active={searchOpen} onClick={() => setSearchOpen(true)}><RackIcon icon={icons.search} /></RackButton>
      <RackButton label="New block" shortcut="⌘N" onClick={() => void report(createDraft())}><RackIcon icon={icons.write} /></RackButton>
      <div className="h-4" />
      <RackButton label="Home" active={side === "repo"} onClick={() => toggleSide("repo")}><RackIcon icon={FolderGitIcon} /></RackButton>
      {features.connections && <RackButton label="Connections" active={side === "connections"} onClick={() => toggleSide("connections")}><RackIcon icon={UsersIcon} /></RackButton>}
      <RackButton label={waiting ? `Agents: ${waiting} waiting for you` : "Agents"} active={side === "agents"} dot={waiting > 0} onClick={() => toggleSide("agents")}><RackIcon icon={BotIcon} /></RackButton>
      <div className="flex-1" />
      <NotificationCenter />
      <RackButton label="You" active={side === "profile"} onClick={() => (side === "profile" ? toggleSide("profile") : openSettings())}>
        <Avatar className="size-7"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
      </RackButton>
    </nav>
  )
}
