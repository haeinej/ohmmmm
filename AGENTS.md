# Working in this repository

Three parts and a thin layer over them. Read [README.md](README.md) first, then the part you are changing: [vault](vault/AGENTS.md), [cortex](cortex/AGENTS.md) or [app](app/AGENTS.md). Their rules still hold inside each folder.

- **One home per person:** `ohmmmm.<handle>/vault` and `ohmmmm.<handle>/cortex` ([home/home.mjs](home/home.mjs)). Do not add a third place a vault or a cortex can default to.
- **One contract:** cortex reads a vault only through [contract/vault-reader.mjs](contract/vault-reader.mjs). Change it there, and in both the vault's reader (`vault/vault/cortex.mjs`) and cortex's checks (`cortex/src/vault.mjs`) in the same change; `test/home.test.mjs` holds them together.
- **One set of words:** [docs/words.md](docs/words.md). Use a word that already names a thing; if the two parts disagree, settle it there.
- The vault is canonical; the cortex never copies what a block says, and never writes to the vault.
- **The bridge answers only this machine.** `ohmmmm serve` ([home/serve.mjs](home/serve.mjs), [docs/serve.md](docs/serve.md)) binds 127.0.0.1, checks the Host header, and needs one of the home's keys on every request but a preflight. Do not add a way to bind elsewhere or to skip the keys. Agents' keys reach only `AGENT_ROUTES` (the MCP endpoints), and a session opened with an agent's own key is that agent. Keys are kept only as hashes, and each MCP session answers only the key that opened it. Never write a key into the home, let a self-named session take a name an agent's own key holds, or widen what an agent's key reaches.
- **Only the person publishes.** The bridge's publish routes write to the person's PDS with `ATPROTO_APP_PASSWORD` from its own environment, only with the `confirm` of a plan the app showed. Never return the password, never send it to the browser, and never give an agent (MCP or WebMCP) a tool that publishes or takes a post down.
- Keys for the private layer live in the account app (ohm-onboarding `packages/keys`), not here. The vault service stores private blocks only as ciphertext.
- Run `npm test` at the root before handing work back.
- Install the app with `npm ci --prefix app`. Root tests run its typecheck and build. Keep its package and lockfile under `app/`.
