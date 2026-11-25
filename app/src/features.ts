// What the first release shows. Everything behind a switch that is off is built and tested (its
// store handlers, the vault service's requests and the MCP tools), but nothing on screen leads to it.
//
// connections: friends and connections. The rack's Connections panel, Settings › Friends, and friend
// requests in the bell. The backend stays open for them: `people.*`, `friendRequests.*`,
// `listShared`/`readShared`, the vault service's friendship requests and invite email, and the
// `vault_connections`, `vault_friends_ask` and `vault_mail_ask` tools (vault/docs/agents/connections.md).
// Turning it on is this one line.
//
// site: the main panel's default (flows/site.md), an editor view of the person's own website, with
// its content as tiles in the side panel. Development
// only for now: it is on when the dev server was started with VITE_OHM_SITE naming the site's folder,
// which is also what makes the dev server serve that folder (site-dev.ts). No build has it.
export const features = {
  connections: false,
  site: Boolean((import.meta as { env?: { DEV?: boolean; VITE_OHM_SITE?: string } }).env?.DEV && (import.meta as { env?: { VITE_OHM_SITE?: string } }).env?.VITE_OHM_SITE),
} as const
