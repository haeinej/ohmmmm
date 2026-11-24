import type { HomeSource } from "./source"

const refuse = () => { throw new DOMException("The local home bridge is unavailable.", "NotSupportedError") }
const unavailable = async () => refuse()

export const localSource: HomeSource = {
  account: unavailable,
  listBlocks: unavailable,
  readBlock: unavailable,
  saveBlock: unavailable,
  deleteBlock: unavailable,
  vault: unavailable,
  connections: unavailable,
  search: unavailable,
  history: unavailable,
  readVersion: unavailable,
  visibilityMove: refuse,
  moveVisibility: unavailable,
  listFriends: unavailable,
  removeFriend: unavailable,
  friendRequests: { list: unavailable, approve: unavailable, decline: unavailable, setChannels: unavailable },
  listShared: unavailable,
  readShared: unavailable,
  publishPlan: unavailable,
  channels: { list: unavailable, read: unavailable, save: unavailable, move: unavailable, remove: unavailable },
  cortex: {
    list: unavailable, read: unavailable, save: unavailable, saveMany: unavailable, remove: unavailable,
    history: unavailable, readVersion: unavailable, journal: unavailable,
  },
  media: { has: unavailable, put: unavailable, get: unavailable, rendition: unavailable },
  moves: { requests: unavailable, decline: unavailable, record: unavailable, publishPage: refuse },
  agenda: unavailable,
}
