import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { installWebMcpShim } from "./webmcp-shim"
import { App } from "./App"
import { applyDensity, open, setSource } from "./workspace/store"
import { bridgeMedia, currentBridge, pairFromLocation } from "./data/bridge"
import { createLocalSource } from "./data/local-source"
import { setMediaRemote } from "./media/cache"
import { notify } from "./components/ui/notice"

// Development only: a stand-in for document.modelContext when the browser has no WebMCP.
if (import.meta.env.DEV) installWebMcpShim()

applyDensity()
// The link `ohmmmm serve` prints pairs this browser with the home on this machine; images the
// browser lacks are then read from the home folder.
pairFromLocation()
setMediaRemote(cid => bridgeMedia(cid))
// Paired, the workspace opens on the home itself (docs/serve.md); otherwise, and if it does not answer, on the sample.
const bridge = currentBridge()
if (bridge) {
  createLocalSource(bridge, { onProblem: message => notify({ message }) })
    .then(async home => {
      // A change still on its way to disk would be lost by leaving: the browser asks first.
      addEventListener("beforeunload", event => { if (home.unsent()) event.preventDefault() })
      await setSource(home)
      if (opening) { try { open(opening) } catch { /* not in this home */ } }
    })
    .catch(() => notify({ message: "Your home on this computer did not answer, so this is the sample. Run ohmmmm serve in your home, then reload.", tone: "info" }))
}
// "Open in › New tab" arrives as ?open=<id>.
const opening = new URLSearchParams(location.search).get("open")
if (opening) { try { open(opening) } catch { /* not in this tab's vault */ } }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
