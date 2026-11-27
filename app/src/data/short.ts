// Short posts to Bluesky, through the bridge (home/serve.mjs, app/flows/short-post.md): the preview the
// person approves, then the publish. Only the person publishes: no agent tool calls these.
import { bridgeFetch } from "./bridge"

export type ShortFacet = { index: { byteStart: number; byteEnd: number }; features: { $type: string; uri?: string; tag?: string; did?: string }[] }
export type ShortPlan = {
  path: string; version: string; text: string; facets: ShortFacet[]; collection: string
  repository?: string; pds?: string; posted?: string
  /** What this computer still needs before it can post, in words for the person. */
  needs: string[]; ready: boolean; confirm: string
}

/** A unit's path in the home (`collections/posts/x.md`) as its file's path in the vault. */
export const vaultPath = (homePath: string) => homePath.split("/").slice(1).join("/")

async function said<T>(answer: Response): Promise<T> {
  const body = await answer.json().catch(() => ({})) as T & { error?: string }
  if (!answer.ok) throw new DOMException(body.error ?? "Your home did not answer.", answer.status === 400 ? "DataError" : "OperationError")
  return body
}

/** What publishing would post, and what is missing. Writes nothing. */
export async function planShort(path: string): Promise<ShortPlan> {
  return said(await bridgeFetch("/vault/short/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }))
}

/** Posts it, as the plan the person approved, over the version it was read at. */
export async function publishShort(plan: ShortPlan): Promise<{ uri: string; version: string }> {
  return said(await bridgeFetch("/vault/short/publish", {
    method: "POST", headers: { "Content-Type": "application/json", "If-Match": `"${plan.version}"` },
    body: JSON.stringify({ path: plan.path, confirm: plan.confirm }),
  }))
}

/** A post's page on Bluesky, from its AT URI. */
export const postPage = (uri: string) => {
  const [, did, , rkey] = uri.replace("at://", "").match(/^([^/]+)\/([^/]+)\/(.+)$/) ?? []
  return did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : "https://bsky.app"
}
