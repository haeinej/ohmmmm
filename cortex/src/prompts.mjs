// Prompts are what a person picks to start, such as a slash command in Claude Code. They are the
// person's way in; an agent's way in is the server's instructions and cortex_start.
export const PROMPTS = [
  { name: 'start', title: 'Start with my cortex', description: 'Begin this session from your cortex: your profile, what agents learned working with you, and how your vault is laid out', arguments: [] },
];

export const PROMPT_TEXT = {
  start: [
    'Start this session from my cortex.',
    'Call cortex_start now, read the playbook it returns, and follow it for the rest of this session.',
    'Then tell me in one or two lines what you know about how I work, and anything waiting for me to accept or approve.',
  ].join(' '),
};

export function getPrompt(name) {
  if (!Object.hasOwn(PROMPT_TEXT, name)) return null;
  const { description } = PROMPTS.find(prompt => prompt.name === name);
  return { description, messages: [{ role: 'user', content: { type: 'text', text: PROMPT_TEXT[name] } }] };
}
