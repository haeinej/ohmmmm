import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { installWebMcpShim } from "./webmcp-shim"
import { App } from "./App"
import { applyDensity, open, report, setSource, sourceChanged } from "./workspace/store"
import { bridgeMedia, currentBridge, pairFromLocation } from "./data/bridge"
import { startSite } from "./site/connect"
import { nameThisBrowser } from "./data/browsers"
import { createLocalSource, UNPAIRED } from "./data/local-source"
import { getSource } from "./data/workspace-data"
import { serviceNameOf, setMediaRemote } from "./media/cache"
import { notify } from "./components/ui/notice"

// Development only: a stand-in for document.modelContext when the browser has no WebMCP.
if (import.meta.env.DEV) installWebMcpShim()

applyDensity()
// "Open in › New tab" arrives as ?open=<id>, opened once the home has loaded.
const opening = new URLSearchParams(location.search).get("open")
const opened = () => { if (opening) { try { open(opening) } catch { /* not in this home */ } } }

// The link `ohm serve` prints pairs this browser with the home on this computer. A pairing link
// opened in a tab already on the app changes only the fragment, which loads nothing: pair from it,
// and open again on the home it names.
pairFromLocation()
// The person's site, when their ohm has one: the Site view and its files through the bridge (src/site/connect.ts).
void startSite()
addEventListener("hashchange", () => { if (pairFromLocation()) location.reload() })

// Images this browser lacks are read from where the home keeps them: the home folder when paired,
// otherwise the vault service's media store.
setMediaRemote(async cid => {
  if (currentBridge()) return bridgeMedia(cid)
  const source = getSource()
  if (!source) return undefined
  const blob = await source.media.get(serviceNameOf(cid)).catch(() => undefined)
  return blob && { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
})

// The home is the folder on this computer, through its bridge (`ohm serve`, docs/serve.md), paired
// once from the link it prints. Nothing else is a home: unpaired, or with the bridge not answering, the
// app says how to open it (MainPanel's OpenHome).
const bridge = currentBridge()
if (bridge) {
  createLocalSource(bridge, { onProblem: message => notify({ message }), onChange: sourceChanged })
    .then(async home => {
      // A change still on its way to disk would be lost by leaving: the browser asks first.
      addEventListener("beforeunload", event => { if (home.unsent()) event.preventDefault() })
      await setSource(home)
      opened()
      // In the home's list of paired browsers, this one is shown by the name it gives itself, once.
      nameThisBrowser(bridge).catch(() => {})
    })
    .catch(problem => {
      notify({
        message: problem instanceof DOMException && problem.name === "NotAllowedError" ? UNPAIRED : "Your home on this computer did not answer. Run ohm serve in your home, then reload.",
        tone: "info",
      })
      void report(setSource(null))
    })
} else void report(setSource(null))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
