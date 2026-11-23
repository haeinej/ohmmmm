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
- `cirrus/package.json` stays on the pinned version. To move to another version, re-import with `node scripts/import-vendor.mjs --from <clone>` after the person agrees.
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

Tell them what to answer: the hostname and handle from step 3; the default `did:web`; "Auto" for data location unless they have a reason (it cannot change later); a password of their own; yes to deploying to Cloudflare.

**Hand over: the signing key backup.** When the wizard offers backup choices, they save the key to their password manager. Say plainly that without the backup and this machine's `cirrus/.dev.vars`, the key cannot be recovered. Do not continue until they confirm the backup exists.

Afterwards, check without reading secrets: `cirrus/wrangler.jsonc` now has `PDS_HOSTNAME`, `DID`, `HANDLE` and `SIGNING_KEY_PUBLIC`, and `git status` does not show `.dev.vars`.

### 5. Deploy and DNS

If the wizard did not deploy:

```sh
pnpm --dir cirrus run deploy
```

**Hand over: DNS.** If the hostname is not served yet, the person adds it as a Custom Domain on the Worker in the dashboard. If the handle is on a different domain than the hostname, they add:

```text
_atproto.<handle>  TXT  "did=did:web:<hostname>"
```

Check with `dig TXT _atproto.<handle>`.

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

Done when: `describeServer` names the DID; `did.json` has the handle in `alsoKnownAs` and `https://<hostname>` as its PDS service; `resolveHandle` returns the DID; the OAuth metadata answers; and `identity` shows the handle verified both ways. If one fails, use the table at the end of the human guide, fix that one thing, and check again.

### 8. Connect to ohm

**Hand over:** in the account app they choose **Connect my own server**, type the handle, DID or `https://<hostname>`, press **Check my server**, see three green rows, press **Continue to my server**, and say yes at their own server's consent screen.

Then the vault service admits the DID as a member (today its `MEMBERS` list) and runs `com.ohmmmm.vault.importPublished` once. On a new server there is nothing to bring in. Publishing later writes only the post to the PDS.

### 9. Hand off

Their home has a server. Continue with the curator skill, [design-home](../design-home/SKILL.md), to decide their sections with them. Labels are the person's own words.
