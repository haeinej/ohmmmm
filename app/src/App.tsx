import { useEffect } from "react"
import { useSite } from "@/site/connect"
import { step } from "@/site/nav"
import { notify, Notices } from "@/components/ui/notice"
import { DeleteDialog } from "@/workspace/PageActions"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MainPanel } from "@/workspace/MainPanel"
import { Rack } from "@/workspace/Rack"
import { SearchOverlay } from "@/workspace/SearchOverlay"
import { SidePanel } from "@/workspace/SidePanel"
import { TopBar } from "@/workspace/TopBar"
import { createDraft, go, onFailure, report, setSearchOpen, showGraph, togglePanel, useWorkspace } from "@/workspace/store"
import { useWorkspaceTools } from "@/workspace/tools"

export function App() {
  useWorkspaceTools()
  const { searchOpen, view } = useWorkspace()
  const site = useSite().connected
  const walk = (by: -1 | 1) => (site && view.kind === "empty" ? step(by) : void go(by))
  // A write that failed after the UI moved on, such as an autosave: the source's own words.
  useEffect(() => onFailure(problem => notify({ message: problem.message })), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.isComposing) return
      const k = e.key.toLowerCase()
      const run = {
        k: () => setSearchOpen(!searchOpen), n: () => void report(createDraft()), g: () => showGraph(),
        "[": () => walk(-1), "]": () => walk(1), "\\": () => togglePanel(),
      }[k]
      if (run) { e.preventDefault(); run() }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [searchOpen, site, view.kind])

  return (
    <TooltipProvider>
      {/* The bar runs across the top; under it the rack sits on the page, and the side panel and main panel are cards of their own beside it. */}
      <div className="flex h-full flex-col overflow-hidden bg-sidebar text-foreground dark:bg-background">
        <TopBar />
        <div className="relative flex min-h-0 flex-1 gap-3 pe-3 pb-3">
          <Rack />
          <SidePanel />
          <MainPanel />
        </div>
      </div>
      <SearchOverlay />
      <DeleteDialog />
      <Notices />
    </TooltipProvider>
  )
}
