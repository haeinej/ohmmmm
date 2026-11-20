// What every part of the cortex shares: names, versions, the Refused error, and the Markdown
// property format its files are written in.
export const NAME = /^[a-z]+(?:-[a-z]+)*$/;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
}

export async function cortexVersion(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ordered(value))));
  return `c${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

// A request cortex will not carry out, with a code a client can act on.
export class Refused extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

// The properties at the top of a Markdown file, between --- lines. Values written as JSON are
// read as JSON; anything else is kept as the text it is, which is how people write them by hand.
export function splitFront(text) {
  const found = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!found) return { properties: {}, body: text, found: false };
  const properties = {};
  for (const line of found[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const raw = field[2].trim();
    try { properties[field[1]] = JSON.parse(raw); } catch { properties[field[1]] = raw.replace(/^'(.*)'$/, '$1'); }
  }
  return { properties, body: text.slice(found[0].length), found: true };
}

export const writeFront = (properties, body = '') =>
  `---\n${Object.entries(properties).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`;
