// The person's profile (flows/site.md): who they are, kept as one Markdown file in their folder.
// The card sits fixed at the top of the side panel; opening it shows the profile over the canvas,
// identity in fields on the right and what they say about themselves in the editor on the left.
import { cn } from "@/lib/cn"
import { useEffect, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import Highlight from "@tiptap/extension-highlight"
import { Markdown } from "@tiptap/markdown"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { IdentityCard } from "@/components/ui/identity-card"
import { Input } from "@/components/ui/input"
import { notify } from "@/components/ui/notice"
import { ActiveCell, SlashCommand } from "@/editor/extensions"
import { SlashMenu } from "@/editor/InsertMenu"
import { WebImage } from "@/editor/PageEditor"
import { SelectionToolbar } from "@/editor/SelectionToolbar"
import "@/editor/editor.css"
import { askToOpenProfile, pictureUrl, PROFILE_SAVED, readProfile, saveProfile, type SiteProfile } from "./source"

/** A long identifier, shortened in the middle so both ends can be checked. */
const short = (value: string) => value.length > 26 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value

function Picture({ profile, className }: { profile: SiteProfile; className: string }) {
  const src = pictureUrl(profile.image)
  return src
    ? <img src={src} alt="" className={`${className} shrink-0 rounded-full object-cover`} />
    : <span aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground`}>{(profile.name || profile.handle || "?").slice(0, 1)}</span>
}

/**
 * The profile, fixed at the top of the side panel: ohm-ui's identity card in its matt finish, in
 * the person's own colour. The card opens the profile; the address on it opens the home itself.
 * One size whatever the panel's width: the panel grows beside it, the card does not.
 */
/** `flat`: part of a larger surface in its own colour (the open home card), so no shadow and no tilt of its own. */
export function ProfileCard({ flat }: { flat?: boolean } = {}) {
  const [profile, setProfile] = useState<SiteProfile | null>(null)
  useEffect(() => {
    readProfile().then(setProfile, () => {})
    const onSaved = (e: Event) => setProfile((e as CustomEvent<SiteProfile>).detail)
    window.addEventListener(PROFILE_SAVED, onSaved)
    return () => window.removeEventListener(PROFILE_SAVED, onSaved)
  }, [])
  if (!profile) return <div className="aspect-[4/3] w-[17.25rem] max-w-full" aria-busy />
  return (
    <IdentityCard className={cn("w-full [--ohm-identity-ratio:16/9]",
      // Flat: the card's face runs on into the surface below, with no shadow, tilt or bottom corners of its own.
      flat && "[&>section]:!shadow-none [&>section]:![transform:none] [&>section]:!rounded-b-none [&>section>div:first-child]:![clip-path:none] [&>section>div:first-child]:!rounded-b-none")} finish="matt" color={profile.color || null}
      name={profile.name || "Your name"} address={profile.handle || null} did={profile.did || null} wallet={profile.wallet || null}
      avatarSrc={pictureUrl(profile.image) || null}
      onOpen={askToOpenProfile}
      onOpenWorkspace={profile.handle ? () => window.open(`https://${profile.handle}`, "_blank", "noopener,noreferrer") : undefined} />
  )
}

const FIELDS: { key: "name" | "handle" | "did" | "wallet" | "image" | "color"; label: string; placeholder: string }[] = [
  { key: "name", label: "Name", placeholder: "Alice Example" },
  { key: "handle", label: "Handle", placeholder: "alice.example.com" },
  { key: "did", label: "Identity (DID)", placeholder: "did:web:pds.alice.example.com" },
  { key: "wallet", label: "Wallet", placeholder: "0x…" },
  { key: "image", label: "Picture", placeholder: "portrait.jpg, or a web address" },
  { key: "color", label: "Card colour", placeholder: "var(--ohm-mark-navy), or #0409a6" },
]

export function ProfileView({ onClose }: { onClose(): void }) {
  const [profile, setProfile] = useState<SiteProfile | null>(null)
  useEffect(() => { readProfile().then(setProfile, e => notify({ message: (e as Error).message, tone: "error" })) }, [])
  if (!profile) return <div role="dialog" aria-label="Profile" className="absolute inset-0 z-10 bg-card" aria-busy />
  return <ProfileEditor first={profile} onClose={onClose} />
}

function ProfileEditor({ first, onClose }: { first: SiteProfile; onClose(): void }) {
  const [profile, setProfile] = useState(first)
  const [changed, setChanged] = useState(!first.saved)
  const [saving, setSaving] = useState(false)
  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Say who you are. Type / for commands"), includeChildren: false }),
      TaskList, TaskItem.configure({ nested: true }), TableKit, WebImage, Highlight, SlashCommand, ActiveCell, Markdown,
    ],
    content: first.body,
    contentType: "markdown",
    editorProps: { attributes: { class: "ohm-prose", "aria-label": "About you" } },
    onUpdate: () => setChanged(true),
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest?.("[contenteditable], input, textarea")) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  /** The whole profile is one Markdown file, so all of it is saved as written. */
  const save = async () => {
    setSaving(true)
    try {
      setProfile(await saveProfile({ ...profile, body: editor.getMarkdown() }))
      setChanged(false)
      notify({ message: "Saved your profile to profile.md in your folder.", tone: "info" })
    } catch (e) { notify({ message: (e as Error).message, tone: "error" }) }
    setSaving(false)
  }

  return (
    <div role="dialog" aria-label="Profile" className="absolute inset-0 z-10 flex min-h-0 bg-card">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-14 pt-12 pb-40 max-md:px-6">
          <Picture profile={profile} className="size-24 text-h2" />
          <h1 className="pt-6 text-h2 font-semibold tracking-tight break-words">{profile.name || "Your name"}</h1>
          <p className="pt-1 text-small text-muted-foreground">{profile.handle ? `@${profile.handle}` : "No handle yet"}</p>
          <div className="mt-6"><EditorContent editor={editor} /></div>
        </div>
      </div>

      <aside aria-label="Your identity" className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-small font-medium">Profile</h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><Icon icon={XIcon} /></Button>
        </div>
        {FIELDS.map(field => (
          <label key={field.key} className="flex flex-col gap-1.5 text-small">
            <span className="text-muted-foreground">{field.label}</span>
            <Input value={profile[field.key]} placeholder={field.placeholder} maxLength={300} spellCheck={false}
              onChange={e => { setProfile({ ...profile, [field.key]: e.target.value }); setChanged(true) }} />
          </label>
        ))}
        <p className="text-small text-muted-foreground">Kept as profile.md in your folder. It isn't part of your site until you commit it yourself.</p>
        <Button className="self-start" disabled={!changed || saving} onClick={() => void save()}>Save</Button>
      </aside>
      <SelectionToolbar editor={editor} docId="site:profile" />
      <SlashMenu />
    </div>
  )
}
