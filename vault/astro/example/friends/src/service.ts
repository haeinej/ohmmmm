import { serviceSource } from '@ohmmmm/astro';

export const source = serviceSource({
  did: process.env.OHM_DID ?? 'did:web:alice.example.com',
  origin: process.env.OHM_SERVICE ?? 'https://ohm.example.com',
  site: 'https://alice.example.com',
  mediaPath: name => `/media/${name}`,
});
