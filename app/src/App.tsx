import { useEffect } from "react"
import { notify, Notices } from "@/components/ui/notice"
import { DeleteDialog } from "@/workspace/PageActions"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MainPanel } from "@/workspace/MainPanel"
import { Rack } from "@/workspace/Rack"
import { SearchOverlay } from "@/workspace/SearchOverlay"
import { SidePanel } from "@/workspace/SidePanel"
import { createDraft, go, onFailure, report, setSearchOpen, showGraph, togglePanel, useWorkspace } from "@/workspace/store"
import { useWorkspaceTools } from "@/workspace/tools"

export function App() {
  useWorkspaceTools()
  const { searchOpen } = useWorkspace()
  // A write that failed after the UI moved on, such as an autosave: the source's own words.
  useEffect(() => onFailure(problem => notify({ message: problem.message })), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.isComposing) return
      const k = e.key.toLowerCase()
      const run = {
        k: () => setSearchOpen(!searchOpen), n: () => void report(createDraft()), g: () => showGraph(),
        "[": () => go(-1), "]": () => go(1), "\\": () => togglePanel(),
      }[k]
      if (run) { e.preventDefault(); run() }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [searchOpen])

  return (
    <TooltipProvider>
      {/* The rack sits on the page; the side panel and main panel are cards of their own beside it. */}
      <div className="relative flex h-full gap-3 overflow-hidden bg-sidebar py-3 pe-3 text-foreground dark:bg-background">
        <Rack />
        <SidePanel />
        <MainPanel />
      </div>
      <SearchOverlay />
      <DeleteDialog />
      <Notices />
    </TooltipProvider>
  )
}
