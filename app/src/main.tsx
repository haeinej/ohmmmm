import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { installWebMcpShim } from "./webmcp-shim"
import { App } from "./App"
import { applyDensity, open } from "./workspace/store"
import { bridgeMedia, pairFromLocation } from "./data/bridge"
import { setMediaRemote } from "./media/cache"

// Development only: a stand-in for document.modelContext when the browser has no WebMCP.
if (import.meta.env.DEV) installWebMcpShim()

applyDensity()
// The link `ohmmmm serve` prints pairs this browser with the home on this machine; images the
// browser lacks are then read from the home folder.
pairFromLocation()
setMediaRemote(cid => bridgeMedia(cid))
// "Open in › New tab" arrives as ?open=<id>.
const opening = new URLSearchParams(location.search).get("open")
if (opening) { try { open(opening) } catch { /* not in this tab's vault */ } }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
