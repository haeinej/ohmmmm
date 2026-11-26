import { BLOCK_KINDS } from "../../../vault/vault/node.mjs"

export type BlockKind = "text" | "excerpt" | "link" | "media" | "file" | "code" | "post" | "wallet" | "artifact" | "short"
export const isBlockKind = (kind: string): kind is BlockKind => BLOCK_KINDS.includes(kind)
