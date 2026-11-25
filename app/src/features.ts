// What the first release shows. Everything behind a switch that is off is built and tested (its
// store handlers, the vault service's requests and the MCP tools), but nothing on screen leads to it.
//
// connections: friends and connections. The rack's Connections panel, Settings › Friends, and friend
// requests in the bell. The backend stays open for them: `people.*`, `friendRequests.*`,
// `listShared`/`readShared`, the vault service's friendship requests and invite email, and the
// `vault_connections`, `vault_friends_ask` and `vault_mail_ask` tools (vault/docs/agents/connections.md).
// Turning it on is this one line.
//
// The Site view is not a switch: it shows whenever the paired ohm has a site/ (src/site/connect.ts).
export const features = {
  connections: false,
} as const
