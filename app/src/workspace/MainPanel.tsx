import { AgentStatus } from "@/components/agent-status"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { isBlock, byId, homeStatus, sees, titleOf } from "@/data/workspace-data"
import { PageEditor } from "@/editor/PageEditor"
import { cn } from "@/lib/cn"
import { SettingsView } from "./Settings"
import { SiteView } from "@/site/SiteView"
import { useSite } from "@/site/connect"
import { surface } from "./Surface"
import { openDropped, opensOnDrop } from "./drop"
import { closeSettings, createDraft, showMain, report, setAudience, setSearchOpen, useWorkspace } from "./store"
import { FileEditor } from "@/site/FileEditor"
import { ToolFrame } from "@/site/ToolFrame"
import { FeedView } from "./FeedView"
import { ProfileView } from "@/site/ProfileView"
import type { Unit } from "@/data/units"

/**
 * No home open: the home is the folder on this computer, opened through its bridge. Run `ohm serve` in
 * it, and open the pairing link it prints in this browser, once.
 */
export function OpenHome() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Open your home</EmptyTitle>
        <EmptyDescription>
          Your home is the folder <code>ohm.&lt;your handle&gt;</code> on this computer. In it, run <code>ohm serve</code>, then open the pairing link it prints in this browser. Already paired? Run <code>ohm serve</code>, then reload.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Where things open: a block in the editor, or settings. A card of its own, apart from the rack. */
export function MainPanel() {
  const { view, agent, audience, restored } = useWorkspace()
  const doc = view.kind === "doc" ? byId(view.id) : undefined
  const status = homeStatus()
  const site = useSite().connected

  return (
    <main className={cn(surface, "relative flex min-w-0 flex-1 flex-col overflow-hidden shade-2")}>
      {audience !== "private" && (
        <div role="status" className="flex items-center justify-between gap-2 bg-muted px-5 py-2 text-small">
          <span>Viewing as {audience === "friends" ? "a friend" : "anyone"}. Only what they can see is shown.</span>
          <Button size="xs" variant="ghost" onClick={() => setAudience("private")}>Back to you</Button>
        </div>
      )}
      {agent && <AgentStatus state={agent.state} label={agent.label} className="absolute top-16 right-4 z-10 animate-in fade-in-0 slide-in-from-top-1" />}

      {site && (view.kind === "empty" || view.kind === "doc") ? (
        // With a site, the main panel is always its canvas. A block of the home (a new writing from the +)
        // opens in the editor over it, in the window beside the card, as everything opened from it does.
        <>
          <SiteView />
          {doc && (
            <div className="absolute inset-0 z-30 flex items-start bg-black/15 py-3 ps-[356px] pe-3 animate-in fade-in-0"
              onPointerDown={e => { if (e.target === e.currentTarget) showMain() }}>
              <div className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl bg-card shade-5">
                <PageEditor key={`${doc.id}:${restored?.id === doc.id ? restored.n : 0}`} doc={doc} />
              </div>
            </div>
          )}
        </>
      ) : status === "signed-out" ? (
        <OpenHome />
      ) : status === "loading" ? (
        // A page loading is blank (AGENTS.md rule 14).
        <div className="flex-1" aria-busy />
      ) : doc && audience !== "private" && !sees(audience, doc) ? (
        // Viewing as someone else never shows what they couldn't see.
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>{audience === "friends" ? "Friends" : "Anyone"} can't see this item</EmptyTitle>
            <EmptyDescription>“{titleOf(doc)}” is for {isBlock(doc) && doc.visibility === "friends" ? "friends" : "you only"}.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="ghost" onClick={() => setAudience("private")}>Back to you</Button>
          </EmptyContent>
        </Empty>
      ) : doc ? (
        // A restore or revert of this block re-reads it; one of another block leaves this editor alone.
        <PageEditor key={`${doc.id}:${restored?.id === doc.id ? restored.n : 0}`} doc={doc} />
      ) : view.kind === "feed" ? (
        <FeedView />
      ) : view.kind === "unit" ? (
        <UnitView key={view.unit.key} unit={view.unit} />
      ) : view.kind === "settings" ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-end px-5">
            <Button size="sm" variant="ghost" onClick={closeSettings}>Done</Button>
          </header>
          <SettingsView tab={view.tab} />
        </>
      ) : (
        <Empty className="flex-1" onDragOver={e => { if (opensOnDrop(e.dataTransfer)) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); void openDropped(e.dataTransfer) }}>
          <EmptyHeader>
            <EmptyTitle>Nothing open</EmptyTitle>
            <EmptyDescription>Open something from your home, drop a block here, or start a block.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="ghost" onClick={() => setSearchOpen(true)}>Search</Button>
            <Button onClick={() => void report(createDraft())}>New block</Button>
          </EmptyContent>
        </Empty>
      )}
    </main>
  )
}


/**
 * A unit that is not a block or an agent's file (docs/plans/units.md): the profile and its wallet open
 * the profile, a file of the site opens in the site's file view. Every unit shows something: one with
 * no view of its own yet says what it is and where its file is.
 */
function UnitView({ unit }: { unit: Unit }) {
  if (unit.type === "profile" || unit.type === "wallet") return <ProfileView onClose={showMain} />
  // A tool built for you runs here; a kept website shows as the page itself, in a frame that can't reach ohm.
  if (unit.kind === "tool" && unit.id) return <ToolFrame name={unit.id} className="relative flex-1" />
  if (unit.kind === "link" && unit.origin) return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="min-w-0 flex-1 truncate text-body font-medium">{unit.title}</span>
        <Button size="sm" variant="ghost" onClick={() => window.open(unit.origin, "_blank", "noopener")}>Open</Button>
        <Button size="sm" variant="ghost" onClick={showMain}>Close</Button>
      </header>
      <iframe title={unit.title ?? unit.origin} src={unit.origin} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" className="min-h-0 flex-1 border-0 bg-white" />
    </div>
  )
  if (unit.type === "artifact" && unit.path.startsWith("site/")) return <FileEditor path={unit.path.slice(5)} onClose={showMain} />
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{unit.title ?? unit.path}</EmptyTitle>
        <EmptyDescription>It is in your home at {unit.path}.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
