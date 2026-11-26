// Posts from the network, through the bridge (home/network.mjs): who you follow on Bluesky, live from
// Jetstream, and Discover from a feed generator. They are other people's words: shown as theirs, never
// handed to an agent.
import { bridgeFetch, currentBridge } from "./bridge"

export type NetAuthor = { did: string; handle?: string; name?: string; avatar?: string | null }
export type NetPost = {
  uri: string; cid?: string | null; author: NetAuthor; text: string; createdAt: string; replyTo?: string; quote?: string
  images?: { thumb: string; alt: string; ratio?: number }[]
  link?: { uri: string; title: string; description: string; thumb: string | null }
  replies?: number; likes?: number; reposts?: number
}
export type Live = { connected: boolean; following: number; problem: string | null; posts: NetPost[] }

/** Following: posts from the accounts you follow, newest first. Empty with no bridge. */
export async function readLive(limit = 200): Promise<Live> {
  if (!currentBridge()) return { connected: false, following: 0, problem: null, posts: [] }
  const answer = await bridgeFetch(`/feed/live?limit=${limit}`)
  if (!answer.ok) throw new DOMException("Who you follow could not be read.", "OperationError")
  return (await answer.json()) as Live
}

/** Discover: posts from a feed generator. */
export async function readDiscover(fresh = false): Promise<NetPost[]> {
  if (!currentBridge()) return []
  const answer = await bridgeFetch(`/feed/discover${fresh ? "?fresh" : ""}`)
  if (!answer.ok) throw new DOMException("Discover did not answer.", "OperationError")
  return ((await answer.json()) as { posts: NetPost[] }).posts
}

/** The post's page on Bluesky. */
export const blueskyUrl = (post: NetPost) => {
  const [, did, , rkey] = post.uri.replace("at://", "").match(/^([^/]+)\/([^/]+)\/(.+)$/) ?? []
  return did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : "https://bsky.app"
}
