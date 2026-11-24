import { defineCollection } from 'astro:content';
import { ohm, pdsSource, serviceSource } from '@ohmmmm/astro';

const did = process.env.OHM_DID ?? 'did:web:alice.example.com';
const fallback = pdsSource({
  did, origin: process.env.OHM_PDS ?? 'https://pds.alice.example.com',
  channels: { essays: { label: 'essays' } },
});
const source = process.env.OHM_SERVICE
  ? serviceSource({ did, origin: process.env.OHM_SERVICE, site: process.env.OHM_SITE ?? '', fallback })
  : fallback;

export const collections = {
  essays: defineCollection({ loader: ohm({ source, channel: 'essays' }) }),
};
