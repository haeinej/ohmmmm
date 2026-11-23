---
name: host-pds
description: Set up a person's own AT Protocol PDS on their Cloudflare account with Cirrus, check that it resolves, and connect it to ohm. Use when someone wants to host their own PDS or server, run Cirrus, use their own domain as their AT Protocol identity, or picked "Connect my own server" and has no server yet.
---

# Host a PDS

You help the person run their own Personal Data Server on Cloudflare with Cirrus and connect it to ohm. You run the commands. The person does everything that is theirs: accounts, payment, DNS, the signing key backup and every password. You never type, read aloud, store or paste a password, an app password or a key, and you never open `cirrus/.dev.vars`.

The human guide is [docs/host-your-pds.md](../../docs/host-your-pds.md); read it first. It has the same steps, with the reasons. Identity terms are in [docs/identity.md](../../docs/identity.md).

The project's files are in `${CLAUDE_PLUGIN_ROOT}`; in a clone of the repository, that is the repository root. Run every command below from its `vault/` folder.

## The boundary

The PDS is the **PDS boundary**. It holds only public `com.ohmmmm.post` records and their blobs, written only by the person when they press Publish. Friends blocks, sealed private blocks, the sealed cortex, the inbox and the media cache stay in ohm's vault service. Do not write any record to the PDS in this skill, and do not suggest putting anything personal there.

## What you may not change

- [vendor/cirrus/](../../vendor/cirrus/) is upstream Cirrus, pinned in [vendor/IMPORTS.json](../../vendor/IMPORTS.json). Never edit it. An ohm override goes only in `cirrus/src/index.ts`.
- `cirrus/package.json` stays on the pinned version, and `cirrus/pnpm-lock.yaml` on the pinned tarball. The vendored copy is the source of that npm release; `cirrus/` deploys the package itself. Moving to another version is a maintainer change, not part of this skill: the tag, commit and npm integrity in `SOURCES` in `scripts/import-vendor.mjs`, the version in `cirrus/package.json` and the lockfile change together, then `node scripts/import-vendor.mjs --from <clone>` and `--check`.
- Names that stay `ohm-vault` (the vault service Worker, its D1 database, the MCP server, the crypto context strings) are never renamed.

## Steps

Mark every **Hand over** as a stop: say what the person does, wait for them to say it is done, then check it yourself where you can.

### 1. Prerequisites

Check `node --version` (22 or newer) and `pnpm --version`. Install what is missing only with the person's yes.

**Hand over: the Cloudflare account and R2.** They sign up or sign in at dash.cloudflare.com, turn on R2 (it asks for a payment method), and make sure the domain they will use is an active zone on that account.

### 2. Install and sign in

```sh
pnpm --dir cirrus install --frozen-lockfile
pnpm --dir cirrus exec wrangler login
```

**Hand over:** `wrangler login` opens a browser; the person signs in and approves. Then check with `pnpm --dir cirrus exec wrangler whoami`.

### 3. Decide the names

Ask, one question at a time, and offer the plain default:

1. The hostname: default `pds.<their domain>`. It must be in their Cloudflare zone.
2. The handle: default their domain itself, or the hostname if they prefer no DNS record.

The DID is `did:web:<hostname>`. Tell them it cannot change, and that it lasts only as long as they keep the hostname. If they already have a Bluesky `did:plc` and want to move it, follow the Cirrus migration guide in [vendor/cirrus/packages/pds/README.md](../../vendor/cirrus/packages/pds/README.md#migration-guide) instead of starting fresh, and still hand over every password and email-code step.

### 4. Setup wizard

`pds init` prompts for the account password and shows the signing key, so the person runs it, not you.

**Hand over:** ask them to run, in their own terminal:

```sh
pnpm --dir cirrus pds init
```

Do not add `--production`: it pushes the secrets without keeping the local copy in `cirrus/.dev.vars`. Tell them what it asks, in order, and what to answer: the Worker's name and Cloudflare account; no to migrating (unless step 3 chose to migrate); the hostname, handle and default `did:web` from step 3; "Auto" for data location unless they have a reason (it cannot change later); the signing key backup; a password of their own; an email only if they want one; yes to **Push secrets to Cloudflare now?**; yes to **Deploy to Cloudflare now?** (asked only after the push).

**Hand over: the signing key backup.** They choose their password manager, or copy to the clipboard and paste into it. If they choose **Save to file**, it writes `cirrus/signing-key-backup-<handle>.txt` (git-ignored); they move its contents into their password manager and delete the file. Say plainly that without the backup and this machine's `cirrus/.dev.vars`, the key cannot be recovered. Do not continue until they confirm the backup exists.

Afterwards, check without reading any secret or its value:

- `ls cirrus/signing-key-backup-*.txt` finds nothing. If a file is there, ask them to move it into their password manager and delete it; do not open it.
- `git status --short` shows neither `.dev.vars` nor a key backup file.
- `cirrus/wrangler.jsonc` has `PDS_HOSTNAME`, `DID`, `HANDLE` and `SIGNING_KEY_PUBLIC` (it also has their email if they gave one). Tell them this file is now their settings: do not commit it to a shared or public copy, and do not commit it yourself.
- `pnpm --dir cirrus exec wrangler secret list` lists `AUTH_TOKEN`, `SIGNING_KEY`, `JWT_SECRET` and `PASSWORD_HASH` (names only).

### 5. Deploy and DNS

Deploy only once `wrangler secret list` shows all four secrets; a Worker without them cannot sign or sign in. If any is missing, hand over again for `pnpm --dir cirrus pds init`: they keep the values it finds in `.dev.vars` (it reuses the signing key on its own) and answer yes to pushing. If the wizard did not deploy:

```sh
pnpm --dir cirrus run deploy
```

**Hand over: DNS.** If the hostname is not served yet, the person adds it as a Custom Domain on the Worker in the dashboard. If the handle is on a different domain than the hostname, they add:

```text
_atproto.<handle>  TXT  "did=did:web:<hostname>"
```

Check with `dig TXT _atproto.<handle>`. Only DNS (or `https://<handle>/.well-known/atproto-did`) proves the handle; the server's own `resolveHandle` answers from its settings either way.

### 6. A way to sign in

**Hand over:** they make a passkey or an app password, in their own terminal:

```sh
pnpm --dir cirrus pds passkey add
pnpm --dir cirrus pds app-password create
```

A passkey is enough for ohm. An app password is shown once; it goes straight into their password manager, never into this conversation.

### 7. Check that it resolves

Run each and confirm the answer yourself:

```sh
curl -s https://<hostname>/xrpc/com.atproto.server.describeServer
curl -s https://<hostname>/.well-known/did.json
curl -s "https://<hostname>/xrpc/com.atproto.identity.resolveHandle?handle=<handle>"
curl -s https://<hostname>/.well-known/oauth-authorization-server
npm run --silent identity -- <handle>
```

Done when: `describeServer` names the DID; `did.json` has the handle in `alsoKnownAs` and `https://<hostname>` as its PDS service; `resolveHandle` returns the DID (this only shows the server's settings); the OAuth metadata answers; and `identity` shows the handle verified both ways, which is the check that covers DNS. If one fails, use the table at the end of the human guide, fix that one thing, and check again.

### 8. Connect to ohm

**Hand over:** in the account app they choose **Connect my own server**, type the handle, DID or `https://<hostname>`, press **Check my server**, see three green rows, press **Continue to my server**, and say yes at their own server's consent screen.

The vault service must admit the DID as a member. Today that is its `MEMBERS` setting, which the service's operator sets, not you or the person: if the vault refuses them as not a member, tell them to send their DID to whoever runs the vault service. Once admitted, it runs `com.ohmmmm.vault.importPublished` once. On a new server there is nothing to bring in. Publishing later writes only the post to the PDS.

### 9. Hand off

Their home has a server. Continue with the curator skill, [design-home](../design-home/SKILL.md), to decide their sections with them. Labels are the person's own words.
