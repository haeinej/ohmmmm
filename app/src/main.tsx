import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { installWebMcpShim } from "./webmcp-shim"
import { App } from "./App"
import { applyDensity, connectHome, open } from "./workspace/store"

// Development only: a stand-in for document.modelContext when the browser has no WebMCP.
if (import.meta.env.DEV) installWebMcpShim()

applyDensity()
// The home is the signed-in member's vault service; signed out, the workspace shows sign-in.
// "Open in › New tab" arrives as ?open=<id>, opened once the home has loaded.
const opening = new URLSearchParams(location.search).get("open")
void connectHome().then(() => { if (opening) { try { open(opening) } catch { /* not in this home */ } } })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
