# The home's bridge: `ohmmmm serve`

## For people

The app at app.ohmmmm.com runs in your browser, and a web page cannot open the folders on your computer. Your home folder is where your originals live, images included, and where your agents' memory (the cortex) is kept. `ohmmmm serve` is the bridge between the two: a small server on your computer that lets the app, and agents on the same computer, reach your home.

Start it inside your home:

```sh
cd ~/ohmmmm.alice.example.com
npx github:haeinej/ohmmmm serve
```

It prints a link. Open it once in the browser you use the app in, and the app is paired with your home. The link carries the bridge's key in the part of the address after `#`, which browsers never send to any server. The app keeps the key in that browser only and takes it out of the address bar straight away. Chrome may ask whether the app may reach devices on your local network; say yes.

What it does today:

- **Images:** when the app shows an image this browser does not have, it fetches the image from your home folder by its content address. Images you add go into your home folder as media blocks, each image file with its block beside it, recorded as yours.
- **Agents:** an agent on your computer can use your vault's tools at `/vault/mcp` and your cortex's at `/cortex/mcp`, with the key. Your grants still decide what an agent may change (`ohm vault grant`).

Why it is safe to leave running:

- It answers only your computer. It listens on 127.0.0.1, and it refuses requests that arrive under any other name, so a website cannot trick your browser into reaching it as another server.
- Every request needs the key. The key is kept in `.ohmmmm/serve-token` in your home, readable only by you. To change it, run `ohmmmm serve --new-token` and open the new link. The old one stops working.
- In a browser, only the app's own pages, and pages served from your computer, may use it.
- Nothing it writes is lost. Every change goes into the vault's journal, and the vault keeps its versions.

Options: `--port 8766` picks another port. `--app <origin>` names the app's address, and can be given more than once; give `http://localhost:5190` to pair a development copy of the app. `--agent <name>` names every agent session, instead of each agent naming itself.

## For agents (the contract)

Code: [home/serve.mjs](../home/serve.mjs). Tests: [test/serve.test.mjs](../test/serve.test.mjs) (bridge), [app/test/bridge.test.ts](../app/test/bridge.test.ts) (pairing and the media cache). Command: `ohmmmm serve [--port 8766] [--app <origin>]… [--agent <name>] [--new-token]`, routed by [bin/ohmmmm.mjs](../bin/ohmmmm.mjs). It needs a home (`findHome`, or `OHMMMM_HOME`) and `node:sqlite` (it re-runs itself with `--experimental-sqlite` when that is missing).

**Every request,** in this order:
1. The `Host` header's hostname must be `127.0.0.1`, `localhost` or `[::1]`, or the answer is 403. The server binds `127.0.0.1` only. There is no option to bind elsewhere.
2. An `Origin` header must be one of `--app` (default `https://app.ohmmmm.com`), or have a loopback hostname, or the answer is 403. An allowed origin gets `Access-Control-Allow-Origin: <origin>`, `Vary: Origin` and `Access-Control-Expose-Headers: Mcp-Session-Id`.
3. `OPTIONS` is the preflight. It is answered 204 without the token, with `Allow-Methods: GET, POST, PUT, DELETE`, `Allow-Headers: Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version`, `Max-Age: 600`, and `Access-Control-Allow-Private-Network: true` when the request asks for it (Private Network Access).
4. `Authorization: Bearer <token>` is compared in constant time. Without it, or with any other value, the answer is 401 `WWW-Authenticate: Bearer`.

**The token:** `homeToken(home, { replace })` reads `<home>/.ohmmmm/serve-token`, or writes a new 32-byte base64url token with mode 0600 (folder 0700) through a temporary file and a rename. `pairingLink(app, url, token)` is `<app>/#bridge=<url>&token=<token>`, URI-encoded.

**Routes:**

| Route | What |
| --- | --- |
| `POST`, `DELETE /vault/mcp` | The vault's local tools (`LOCAL_TOOLS`, `createLocalTools`), over the cortex's Streamable HTTP transport (`httpTransport` in [cortex/src/http.mjs](../cortex/src/http.mjs)). Each session is the agent its `initialize` names (`clientInfo.name`, made safe: letters, digits, `.`, `_`, `-`), or `--agent`, and is journaled `by: agent:<name>`. Grants apply as over stdio |
| `POST`, `DELETE /cortex/mcp` | The cortex's tools (`cortexSessions`), as `cortex serve` serves them. 404 when the home has no cortex (`cortex/agents/AGENTS.md`) |
| `GET /media/<cid>` | The bytes whose CID is `<cid>`: a file of the vault's own root with that hash in the index, else `.vault/cache/<cid>`. Symlinks are never served. The bytes are hashed again first, and a file that changed is not served (the index is rescanned once, then 404). `Content-Type` comes from the file's ending; `Cache-Control: private, max-age=31536000, immutable`; `X-Content-Type-Options: nosniff` |
| `PUT /media/<cid>?channel=<path>[&name&title&alt&id&slug&width&height]` | The person adds an image. The body is the bytes, at most 20 MB, with `Content-Type` an image type (`avif`, `gif`, `jpeg`, `png`, `webp`; otherwise 415). The bytes must hash to `<cid>` (otherwise 400). Under the collect lock, `addMedia` writes `<channel>/<slug>.<ending>` and `<channel>/<slug>.md` (`kind: media`, `title`, `alt`, `hash`, `mime`, `width`, `height`, `id`; body `![[<slug>.<ending>]]`) and journals both as `added`, `by: me`, `via: editor`. It answers 201 `{ created: true, id, slug, path, file }`. Bytes the vault already holds answer 200 `{ created: false, … }` with the media block beside that file, which is made when there is none |
| `GET /` | `{ home, vault: { scanned }, cortex, endpoints }` |

Anything else is 404. A `VaultProblem` (such as a collection already running) is 409, and anything unexpected is 500 with no detail.

**The app** ([app/src/data/bridge.ts](../app/src/data/bridge.ts)): `pairFromLocation()` reads `#bridge=&token=` once at start, keeps `{ url, token }` in `localStorage['ohm-bridge']` only for an `http:` loopback origin and a token of 20–200 base64url characters, and clears the fragment with `history.replaceState` whatever it held. `bridgeFetch` signs requests. `setMediaRemote(bridgeMedia)` makes the home folder the media cache's last source for an original (`src/media/cache.ts`), and bytes are kept only when they hash to the CID asked for.

**Not built yet:** the app's local home source (`app/src/data/local-source.ts`, a `HomeSource` over the bridge), which the app needs before it reads and writes the home's blocks. Images added while no bridge is paired wait in the browser (vault/plans/media.md, step 3). Sizes are not served; the app makes them.
