# Host your own PDS

Your posts live in a repository on a Personal Data Server (PDS), rooted in your DID. ohm can host that server for you, but you can also run your own on your Cloudflare account with [Cirrus](https://github.com/ascorbic/cirrus). Then the server, its domain and its signing key are yours, and you can move it whenever you like. This guide sets one up and connects it to ohm.

A coding agent can walk you through the same steps with the [host-pds skill](../skills/host-pds/SKILL.md). It runs the commands and stops for you at every account, payment, DNS, key and password step.

## What goes on your PDS, and what never does

A repository on a PDS is public the moment a record is written. So your PDS is the **PDS boundary**: it holds only your public posts (`com.ohmmmm.post` records) and their blobs (images and other media in a post), and only you write them, when you press Publish.

Everything else stays inside the **personal boundary**, in ohm's vault service, never on your PDS:

- Friends blocks, readable by the vault service and shared only with the DIDs you choose.
- Private blocks and your cortex, which the service stores only as ciphertext sealed with the account app's keys.
- Your inbox, and the media cache: the bytes of your media records, sealed when private.

Running your own PDS changes where your public posts are hosted. It does not move anything personal out of ohm, and nothing crosses to the PDS except through Publish.

## What you need

- A Cloudflare account with R2 turned on (R2 asks for a payment method even on the free tier). [R2 overview](https://dash.cloudflare.com/?to=/:account/r2/overview)
- A domain in an active Cloudflare zone, for the server's hostname, such as `pds.example.com`.
- Node.js 22 or newer, pnpm, and a clone of [haeinej/ohmmmm](https://github.com/haeinej/ohmmmm).
- A password manager, for the signing key backup and your password.

The PDS code is Cirrus `@getcirrus/pds` 0.18.0. The Worker you deploy is [cirrus/](../cirrus/): it installs the published npm package, locked to one exact tarball in `cirrus/pnpm-lock.yaml`, and only re-exports it. That release's source is kept, unchanged, in [vendor/cirrus/](../vendor/cirrus/) so you can read what you run; [vendor/IMPORTS.json](../vendor/IMPORTS.json) records its upstream commit and the tarball's integrity, and `npm test` checks that the lockfile still names that tarball.

## 1. Install and sign in to Cloudflare

From the `vault/` folder of the clone:

```sh
pnpm --dir cirrus install --frozen-lockfile
pnpm --dir cirrus exec wrangler login
```

`wrangler login` opens a browser for you to sign in to Cloudflare. If you have more than one Cloudflare account, the setup asks which one to use.

## 2. Choose the hostname, the DID and the handle

Three names, decided once:

| Name | Example | What it is |
| --- | --- | --- |
| Hostname | `pds.example.com` | Where the server answers. It must be in a Cloudflare zone you control. |
| DID | `did:web:pds.example.com` | Your permanent identifier. Cirrus makes a `did:web` from the hostname and serves its document at `https://pds.example.com/.well-known/did.json`. |
| Handle | `example.com` or `pds.example.com` | The name people see. You can change it later; the DID stays. |

A `did:web` is tied to the hostname: if the hostname goes away, so does the identity. Pick one you will keep. [How identity works here](identity.md)

If you already have a Bluesky account with a `did:plc`, you can move it to your own server instead of starting fresh. Cirrus asks about this during setup and has its own [migration guide](../vendor/cirrus/packages/pds/README.md#migration-guide).

## 3. Run the setup

```sh
pnpm --dir cirrus pds init
```

It asks, in order:

1. **The Worker's name** and, if you have more than one, **which Cloudflare account**.
2. **Are you migrating an existing account?** Answer no for a fresh start. (To move a Bluesky `did:plc`, see step 2.)
3. **The hostname** (`pds.example.com`), **the handle** and **the DID**. Accept the default `did:web:` + your hostname.
4. **Where your data is stored.** "Auto" is right for most people. This cannot change after the first deploy.
5. **How to back up your signing key**, then whether you saved it. See step 4. Do not skip it.
6. **Your account password.** It signs you in at your own server. Only its hash is stored.
7. **An email address**, optional. Some apps expect one; press Enter to skip.
8. **Push secrets to Cloudflare now?** Answer yes. A Worker deployed without its secrets has no signing key or password and cannot work.
9. **Deploy to Cloudflare now?** Answer yes. It is only asked once the secrets are pushed.

It writes the secrets (`SIGNING_KEY`, `JWT_SECRET`, `PASSWORD_HASH`, `AUTH_TOKEN`) to `cirrus/.dev.vars`, which is git-ignored, and pushes them to Cloudflare when you say yes. (`pds init --production` would push them without keeping the local copy; this guide does not use it, so this machine keeps one.) It writes your settings into `cirrus/wrangler.jsonc`: the Worker's name, `PDS_HOSTNAME`, `DID`, `HANDLE`, `SIGNING_KEY_PUBLIC`, `INITIAL_ACTIVE`, `DATA_LOCATION`, your email if you gave one, and the hostname as a route. That file is tracked by git: keep these changes out of any commit you push to a shared or public copy, since they include your email.

## 4. Back up the signing key

The signing key proves that what your repository holds was written by you. Once it is pushed to Cloudflare as a secret it cannot be read back out, and the only other copy is `cirrus/.dev.vars` on this machine. If you lose both, a `did:web` identity can only take a new key, and what was signed with the old one can no longer be checked.

When the setup asks how to back it up, choose your password manager or copy it to the clipboard and paste it into your password manager. Keep it somewhere that survives losing this computer.

If you choose **Save to file**, it writes `cirrus/signing-key-backup-<handle>.txt` beside the Worker. That name is git-ignored, but the file is still a plain copy of your key: move its contents into your password manager and delete it.

## 5. Deploy

If the setup did not deploy, first make sure the secrets are in Cloudflare. If you answered no to pushing them, run `pnpm --dir cirrus pds init` again, keep the values it finds in `.dev.vars` (it reuses the signing key on its own), and answer yes to pushing. Check with `pnpm --dir cirrus exec wrangler secret list`, which lists names only: `AUTH_TOKEN`, `SIGNING_KEY`, `JWT_SECRET` and `PASSWORD_HASH` should all be there. Then:

```sh
pnpm --dir cirrus run deploy
```

Then point the hostname at the Worker. The setup normally adds it as a Custom Domain; if not, add `pds.example.com` under the Worker's **Settings → Domains & Routes → Custom Domain** in the Cloudflare dashboard. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

**A handle on a different domain.** If your handle is `example.com` and the server is `pds.example.com`, add this DNS record to `example.com`:

```text
_atproto.example.com  TXT  "did=did:web:pds.example.com"
```

When the handle and the hostname are the same, the server answers for itself and no record is needed.

## 6. A way to sign in from apps

ohm signs in at your server's own screen, so it never sees your password. Make one of these:

- **A passkey**, which needs no password: `pnpm --dir cirrus pds passkey add`, then follow the QR code or link on the device you will sign in from.
- **An app password**, for an app that asks for one: `pnpm --dir cirrus pds app-password create`. It is shown once; put it in your password manager. You can revoke it later with `pds app-password revoke` without changing your account password.

## 7. Check it

Each of these should answer, with your own names in place of the examples:

```sh
curl -s https://pds.example.com/xrpc/com.atproto.server.describeServer
curl -s https://pds.example.com/.well-known/did.json
curl -s "https://pds.example.com/xrpc/com.atproto.identity.resolveHandle?handle=example.com"
```

- `describeServer` returns JSON naming your server's DID.
- `did.json` lists your handle under `alsoKnownAs` and `https://pds.example.com` as the service.
- `resolveHandle` returns `{"did":"did:web:pds.example.com"}`. Your server answers this from its own settings, so it shows the setup worked, not that your DNS is right.

Then check the handle the way the rest of the network does, both ways:

```sh
npm run --silent identity -- example.com
```

It resolves the handle through DNS or `https://example.com/.well-known/atproto-did`, reads the DID document, and shows the handle only when the document claims it back. A handle on a different domain can take a few minutes after the DNS record is added.

## 8. Connect it to ohm

In the account app, choose **Connect my own server**. On **Your server's address**, type your handle, your DID or `https://pds.example.com` and press **Check my server**. Three rows should turn green: your identity is found, your server is reachable, and it supports signing in to apps. Press **Continue to my server** and say yes at your server's own consent screen with your passkey or password.

After that:

- The vault service has to admit your DID as a member. Today that is its `MEMBERS` setting, which whoever runs the vault service sets; if your vault says you are not a member yet, send them your DID.
- It runs `com.ohmmmm.vault.importPublished` once, bringing the posts already on your PDS into your vault. On a new server there are none yet.
- From then on, Publish in ohm writes the post, and only the post, to your PDS.

Next, your agent can help you decide your sections with the curator skill, [design-home](../skills/design-home/SKILL.md). Labels are always your own words.

## If something goes wrong

| What you see | What to try |
| --- | --- |
| `describeServer` does not answer | The hostname is not on the Worker yet. Check **Domains & Routes**, and wait a minute for the certificate. |
| `npm run identity` does not verify a different-domain handle | Check the `_atproto` TXT record with `dig TXT _atproto.example.com`, and give DNS a few minutes. |
| The Worker deploys but signing in fails | The secrets were not pushed. Run `pnpm --dir cirrus pds init` again, keep the values from `.dev.vars`, answer yes to pushing, and deploy. |
| "Your server supports signing in to apps" is red | Deploy again with the current `cirrus/`; Cirrus 0.18.0 serves OAuth. |
| The setup says the signing key is in Cloudflare but not in `.dev.vars` | Put the key from your backup into `cirrus/.dev.vars` as `SIGNING_KEY=…`, then run the setup again. |
| `git status` shows `cirrus/wrangler.jsonc` changed | Those are your settings. Keep them out of commits you push anywhere shared. |
