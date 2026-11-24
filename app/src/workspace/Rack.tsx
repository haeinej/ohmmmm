import type { LucideIcon } from "lucide-react"
import { FolderGitIcon, UsersIcon } from "lucide-react"
import { NotificationCenter } from "./NotificationCenter"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { icons } from "@/lib/icons"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"
import { createDraft, me, openSettings, report, setSearchOpen, toggleSide, useWorkspace } from "./store"

const rackButton = cn(
  "inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none",
  "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
  "aria-pressed:bg-muted aria-pressed:text-foreground",
)

function RackButton({ label, shortcut, active, onClick, children }: {
  label: string; shortcut?: string; active?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={rackButton} />}>
        {children}
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
      <RackButton label="Connections" active={side === "connections"} onClick={() => toggleSide("connections")}><RackIcon icon={UsersIcon} /></RackButton>
      <div className="flex-1" />
      <NotificationCenter />
      <RackButton label="You" active={side === "profile"} onClick={() => (side === "profile" ? toggleSide("profile") : openSettings())}>
        <Avatar className="size-7"><AvatarFallback className="bg-primary text-small text-primary-foreground">{me.name.slice(0, 1)}</AvatarFallback></Avatar>
      </RackButton>
    </nav>
  )
}
