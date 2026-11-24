import type { LiveLoader, Loader } from 'astro/loaders';

export interface OhmMedia {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
  alt: string;
  caption: string;
  poster: string | null;
}

export interface OhmData extends Record<string, unknown> {
  channel: string;
  uri: string;
  title: string;
  subtitle: string;
  slug: string;
  label: string;
  sublabel?: string;
  publishedAt: string;
  updatedAt?: string;
  canonicalUrl: string;
  permalink: string;
  media: OhmMedia[];
}

export interface OhmEntry {
  id: string;
  data: OhmData;
  body: string;
  rendered: { html: string };
}

export interface PublicSource {
  read(options: { channel: string }): Promise<OhmEntry[]>;
}

export function pdsSource(options: {
  did: string;
  origin: string;
  channels: Record<string, { label: string; sublabel?: string }>;
  get?: typeof fetch;
  maxPages?: number;
}): PublicSource;

export function ohm(options: { source: PublicSource; channel: string }): Loader;

export interface FriendsData extends Record<string, unknown> {
  layer: 'friends';
  kind: string;
  slug: string;
  channel: string;
  channels: string[];
  title?: string;
  subtitle?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  media?: {
    name: string;
    type?: string;
    alt?: string;
    width?: number;
    height?: number;
    url?: string;
  };
}

export interface FriendsEntry {
  id: string;
  data: FriendsData;
  body: string;
  rendered: { html: string };
}

export interface ViewerFilter {
  viewerToken?: string;
}

export interface FriendsSource {
  listFriends(options: ViewerFilter & { channel: string }): Promise<FriendsEntry[]>;
  getFriend(options: ViewerFilter & { channel: string; id: string }): Promise<FriendsEntry | undefined>;
}

export interface ServiceSource extends PublicSource, FriendsSource {
  readMedia(options: { name: string; width?: 160 | 480 | 960 | 1600; viewerToken: string }): Promise<Response>;
}

export function serviceSource(options: {
  did: string;
  origin: string;
  site: string;
  fallback?: PublicSource;
  mediaPath?: (name: string) => string;
  get?: typeof fetch;
  maxPages?: number;
}): ServiceSource;

export function ohmLive(options: { source: FriendsSource; channel: string }): LiveLoader<
  FriendsData, ViewerFilter & { id: string }, ViewerFilter, Error & { status: number }
>;
