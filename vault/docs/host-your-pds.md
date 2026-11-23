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

The PDS code is Cirrus `@getcirrus/pds` 0.18.0. Its source is kept, unchanged, in [vendor/cirrus/](../vendor/cirrus/), pinned to an exact upstream commit in [vendor/IMPORTS.json](../vendor/IMPORTS.json). The Worker you deploy is [cirrus/](../cirrus/), which only re-exports it.

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

1. **The hostname** (`pds.example.com`) and **the handle**.
2. **The DID.** Accept the default `did:web:` + your hostname.
3. **Where your data is stored.** "Auto" is right for most people. This cannot change after the first deploy.
4. **Your account password.** It signs you in at your own server. Only its hash is stored.
5. **Back up your signing key.** See step 4. Do not skip it.
6. **Deploy to Cloudflare?** Answer yes to push the secrets and deploy, or no to do that yourself in step 5.

It writes the public settings (`PDS_HOSTNAME`, `DID`, `HANDLE`, `SIGNING_KEY_PUBLIC`) into `cirrus/wrangler.jsonc` and the secrets into `cirrus/.dev.vars` and Cloudflare. `.dev.vars` is git-ignored; never commit it.

## 4. Back up the signing key

The signing key proves that what your repository holds was written by you. Once it is pushed to Cloudflare as a secret it cannot be read back out, and the only other copy is `cirrus/.dev.vars` on this machine. If you lose both, a `did:web` identity can only take a new key, and what was signed with the old one can no longer be checked.

When the setup offers to save it, put it in your password manager (or save the file it offers and move that into your password manager, then delete the file). Keep it somewhere that survives losing this computer.

## 5. Deploy

If the setup did not deploy:

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
- `resolveHandle` returns `{"did":"did:web:pds.example.com"}`. A handle on a different domain can take a few minutes after the DNS record is added.

`npm run --silent identity -- example.com` checks the handle both ways, as every tool here does.

## 8. Connect it to ohm

In the account app, choose **Connect my own server**. On **Your server's address**, type your handle, your DID or `https://pds.example.com` and press **Check my server**. Three rows should turn green: your identity is found, your server is reachable, and it supports signing in to apps. Press **Continue to my server** and say yes at your server's own consent screen with your passkey or password.

After that:

- The vault service admits your DID as a member (today, by its `MEMBERS` list).
- It runs `com.ohmmmm.vault.importPublished` once, bringing the posts already on your PDS into your vault. On a new server there are none yet.
- From then on, Publish in ohm writes the post, and only the post, to your PDS.

Next, your agent can help you decide your sections with the curator skill, [design-home](../skills/design-home/SKILL.md). Labels are always your own words.

## If something goes wrong

| What you see | What to try |
| --- | --- |
| `describeServer` does not answer | The hostname is not on the Worker yet. Check **Domains & Routes**, and wait a minute for the certificate. |
| `resolveHandle` fails for a different-domain handle | Check the `_atproto` TXT record with `dig TXT _atproto.example.com`. |
| "Your server supports signing in to apps" is red | Deploy again with the current `cirrus/`; Cirrus 0.18.0 serves OAuth. |
| The setup says the signing key is in Cloudflare but not in `.dev.vars` | Put the key from your backup into `cirrus/.dev.vars` as `SIGNING_KEY=…`, then run the setup again. |
