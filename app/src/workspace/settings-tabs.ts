import type { LucideIcon } from "lucide-react"
import { features } from "@/features"
import { BotIcon, BrainIcon, FingerprintIcon, LibraryIcon, SunMoonIcon, UserIcon, UsersIcon } from "lucide-react"

export type SettingsTab = "profile" | "identity" | "friends" | "agents" | "vault" | "cortex" | "appearance"

/** The settings tabs, in navigation order. `keywords` are what search also finds each tab by. Friends is shown with connections (features.ts). */
type Tab = { id: SettingsTab; label: string; icon: LucideIcon; description: string; keywords: string }
export const SETTINGS_TABS: Tab[] = ([
  { id: "profile", label: "Your profile", icon: UserIcon, description: "Your name, picture and bio, as other applications show them.", keywords: "settings profile name display handle bio description avatar picture bluesky" },
  { id: "identity", label: "Identity", icon: FingerprintIcon, description: "The DID everything starts from, its handle and the server that holds your repository.", keywords: "settings identity did handle pds server repository domain" },
  { id: "friends", label: "Friends", icon: UsersIcon, description: "Who sees what you share with friends, and which channels each of them sees. Their agents read with the same access.", keywords: "settings friends people sharing channels access remove stop sharing email" },
  { id: "agents", label: "Agents", icon: BotIcon, description: "What an agent in your browser can do in the workspace, through WebMCP.", keywords: "settings agents webmcp tools ai assistant permissions model context" },
  { id: "vault", label: "Collections", icon: LibraryIcon, description: "Your channels and how new blocks start.", keywords: "settings vault channels blocks posts private public publish" },
  { id: "cortex", label: "Agents", icon: BrainIcon, description: "Your profile, what your agents observed working with you, and their skills and tools.", keywords: "settings cortex profile preferences goals observations memory skills tools" },
  { id: "appearance", label: "Appearance", icon: SunMoonIcon, description: "Light or dark, and how tight corners and menus are, on this device.", keywords: "settings appearance theme dark mode light mode system display density compact corners radius menus rounded" },
] as Tab[]).filter(tab => tab.id !== "friends" || features.connections)
