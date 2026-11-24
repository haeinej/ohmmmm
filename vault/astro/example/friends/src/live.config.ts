import { defineLiveCollection } from 'astro:content';
import { ohmLive } from '@ohmmmm/astro';
import { source } from './service';

export const collections = {
  friends: defineLiveCollection({ loader: ohmLive({ source, channel: 'essays' }) }),
};
