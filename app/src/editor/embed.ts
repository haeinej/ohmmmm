// An embed, `![[target]]`, on a line of its own: a media block's image, or a card for any other
// block. In Markdown it stays exactly as written. The image is loaded by its CID from the media
// cache; the object URL that shows it lives only in this tab and is never written into the block.
import { Node } from "@tiptap/react"
import type { Node as PMNode } from "@tiptap/pm/model"
import { titleOf, type Doc } from "@/data/workspace-data"
import { urlFor } from "@/media/cache"
import { embedTarget, resolveEmbed } from "@/media/embeds"

const LINE = /^ {0,3}!\[\[([^\]\n]+)\]\][ \t]*(?:\n|$)/

/** The width an image is shown at in the editor, in device pixels. */
const shownWidth = () => Math.round(720 * (typeof devicePixelRatio === "number" ? devicePixelRatio : 1))

function draw(dom: HTMLElement, node: PMNode, channel: string | undefined, onOpen: (id: string) => void) {
  const src = String(node.attrs.src ?? "")
  const found: Doc | undefined = resolveEmbed(embedTarget(src), channel)
  dom.replaceChildren()
  dom.className = "ohm-embed"
  dom.dataset.embed = src
  if (!found) {
    dom.classList.add("is-missing")
    dom.textContent = `Nothing in your vault is called “${embedTarget(src)}”`
    return
  }
  if (!found.media) {
    // Another block: a card that opens it.
    const card = document.createElement("button")
    card.type = "button"
    card.className = "ohm-embed-card"
    card.textContent = titleOf(found)
    card.addEventListener("click", () => onOpen(found.id))
    dom.append(card)
    return
  }
  const { hash, mime, width, height, alt } = found.media
  const img = document.createElement("img")
  img.alt = alt ?? titleOf(found)
  img.draggable = false
  if (width && height) { img.width = width; img.height = height }
  img.dataset.cid = hash
  dom.append(img)
  void urlFor(hash, mime, shownWidth()).then(url => {
    if (dom.firstChild !== img) return // drawn again since
    if (url) img.src = url
    else {
      dom.classList.add("is-missing")
      img.replaceWith(Object.assign(document.createElement("span"), { textContent: `“${titleOf(found)}” is not on this device yet` }))
    }
  })
}

export const Embed = Node.create<{ onOpen: (id: string) => void; channel: () => string | undefined }>({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onOpen: () => {}, channel: () => undefined }
  },

  addAttributes() {
    return { src: { default: "" } }
  },

  parseHTML() {
    return [{ tag: "figure[data-embed]", getAttrs: el => ({ src: (el as HTMLElement).dataset.embed ?? "" }) }]
  },

  renderHTML({ node }) {
    return ["figure", { class: "ohm-embed", "data-embed": node.attrs.src }]
  },

  markdownTokenizer: {
    name: "embed",
    level: "block",
    start: (src: string) => src.search(/^ {0,3}!\[\[/m),
    tokenize(src) {
      const match = LINE.exec(src)
      if (match) return { type: "embed", raw: match[0], src: match[1] }
    },
  },

  parseMarkdown: (token, helpers) => helpers.createNode("embed", { src: token.src })!,

  renderMarkdown: node => `![[${node.attrs?.src ?? ""}]]`,

  addNodeView() {
    const { onOpen, channel } = this.options
    return ({ node }) => {
      const dom = document.createElement("figure")
      dom.contentEditable = "false"
      let current = node
      draw(dom, current, channel(), onOpen)
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          if (next.attrs.src !== current.attrs.src) draw(dom, next, channel(), onOpen)
          current = next
          return true
        },
      }
    }
  },
})
