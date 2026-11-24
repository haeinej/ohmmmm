import { defineCollection } from 'astro:content';
import { ohm, pdsSource } from '@ohmmmm/astro';

const source = pdsSource({
  did: process.env.OHM_DID ?? 'did:web:alice.example.com',
  origin: process.env.OHM_PDS ?? 'https://pds.alice.example.com',
  channels: { essays: { label: 'essays' } },
});

export const collections = {
  essays: defineCollection({ loader: ohm({ source, channel: 'essays' }) }),
};
