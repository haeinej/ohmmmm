#!/usr/bin/env node
// Claude Code's hooks, for ohm: tell `ohm serve` what this agent is doing (POST /site/activity), so the
// person sees it live: the agent's light green while its session is open, what it is doing beside its name,
// and the card of a file it edits marked with its name. Quiet by design: when ohm isn't running, or there is
// no key, it does nothing and never holds Claude Code up.
//
//   node ohm-activity.mjs <start|prompt|edit|stop|end>      (the hook's input arrives as JSON on stdin)
//
// The key is the plugin's `agent_key` option (or OHM_AGENT_KEY); the address its `ohm_url` (or OHM_URL), 127.0.0.1:8766 by default.
const event = process.argv[2] ?? '';
// From the plugin's own settings (`claude plugin configure ohm`), or the environment.
const key = process.env.CLAUDE_PLUGIN_OPTION_AGENT_KEY || process.env.OHM_AGENT_KEY;
const base = process.env.CLAUDE_PLUGIN_OPTION_OHM_URL || process.env.OHM_URL || 'http://127.0.0.1:8766';

const read = async () => {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text); } catch { return {}; }
};

try {
  const input = await read();
  if (key && event) {
    const tool = input.tool_name ?? '';
    const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
    await fetch(new URL('/site/activity', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ event, tool, path, session: input.session_id ?? '' }),
      signal: AbortSignal.timeout(1500),
    });
  }
} catch { /* ohm isn't running: nothing to tell */ }
process.exit(0);
