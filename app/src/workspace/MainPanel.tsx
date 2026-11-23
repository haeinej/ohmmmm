import { AgentStatus } from "@/components/agent-status"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { isBlock, byId, homeStatus, sees, titleOf } from "@/data/workspace-data"
import { PageEditor } from "@/editor/PageEditor"
import { cn } from "@/lib/cn"
import { SettingsView } from "./Settings"
import { surface } from "./Surface"
import { openDropped, opensOnDrop } from "./drop"
import { ProposalView } from "./Inbox"
import { closeSettings, createDraft, report, setAudience, setSearchOpen, useWorkspace } from "./store"

/** Signed out: the home lives on the vault service, so the way in is ohm's sign-in. */
export function SignIn() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Sign in to open your home</EmptyTitle>
        <EmptyDescription>Your vault and cortex are kept by your vault service. Sign in with your ohm account to see them here.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button nativeButton={false} render={<a href="/vault/" />}>Sign in</Button>
      </EmptyContent>
    </Empty>
  )
}

/** Where things open: a block in the editor, an inbox item, or settings. A card of its own, apart from the rack. */
export function MainPanel() {
  const { view, agent, audience, restored } = useWorkspace()
  const doc = view.kind === "doc" ? byId(view.id) : undefined
  const status = homeStatus()

  return (
    <main className={cn(surface, "relative flex min-w-0 flex-1 flex-col overflow-hidden shade-2")}>
      {audience !== "private" && (
        <div role="status" className="flex items-center justify-between gap-2 bg-muted px-5 py-2 text-small">
          <span>Viewing as {audience === "friends" ? "a friend" : "anyone"}. Only what they can see is shown.</span>
          <Button size="xs" variant="ghost" onClick={() => setAudience("private")}>Back to you</Button>
        </div>
      )}
      {agent && <AgentStatus state={agent.state} label={agent.label} className="absolute top-16 right-4 z-10 animate-in fade-in-0 slide-in-from-top-1" />}

      {status === "signed-out" ? (
        <SignIn />
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
      ) : view.kind === "settings" ? (
        <>
          <header className="flex h-14 shrink-0 items-center justify-end px-5">
            <Button size="sm" variant="ghost" onClick={closeSettings}>Done</Button>
          </header>
          <SettingsView tab={view.tab} />
        </>
      ) : view.kind === "inbox" ? (
        <ProposalView id={view.id} />
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

