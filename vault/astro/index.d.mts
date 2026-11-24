import type { Loader } from 'astro/loaders';

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
