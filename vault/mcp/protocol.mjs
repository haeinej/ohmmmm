// The Model Context Protocol, as much of it as serving tools needs: one JSON message in, at most
// one out. https://modelcontextprotocol.io/specification
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const INSTRUCTIONS = [
  "These tools reach the public and friends layers of one person's vault service. Private blocks stay on the person's device.",
  'When a tool returns a preview and a confirm value, the action waits for the person in ohm, in the Agents panel: tell them so, and call again with the confirm value. A yes in this chat approves nothing.',
  'Saving never publishes. A friends-only block is shared as soon as it is saved. The signed-in member manages who can become a friend.',
  "You may ask someone to be the person's friend by email (vault_friends_ask), never approve one. Before sending mail with your own mail tools, from the person's own address, have the draft approved with vault_mail_ask and send exactly what was approved.",
].join(' ');

// `tools` is ready-made, or a function that makes them the first time a tool is used, so that
// starting up and listing the tools never depends on the person's configuration being in place.
export function createServer({ tools, list, name = 'ohm-vault', version = '0.1.0', instructions = INSTRUCTIONS }) {
  let ready;
  const made = () => (ready ??= Promise.resolve(typeof tools === 'function' ? tools() : tools).catch(problem => { ready = undefined; throw problem; }));
  const answer = (id, result) => ({ jsonrpc: '2.0', id, result });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  return async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return failure(message?.id ?? null, -32600, 'Not a JSON-RPC 2.0 request');
    }
    const { id, method, params = {} } = message;
    // A notification has no ID and gets no answer.
    if (id === undefined) return undefined;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return failure(id, -32602, 'Params must be an object');
    if (method === 'initialize') {
      return answer(id, {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name, version },
        instructions,
      });
    }
    if (method === 'ping') return answer(id, {});
    if (method === 'tools/list') return answer(id, { tools: list });
    if (method === 'tools/call') {
      if (typeof params.name !== 'string' || (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)))) return failure(id, -32602, 'A tool call needs a name and an arguments object');
      // A tool that cannot do what was asked says why in its result, so the agent can read it.
      try {
        const result = await (await made()).call(params.name, params.arguments ?? {});
        return answer(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (problem) {
        return answer(id, { content: [{ type: 'text', text: problem.message }], isError: true });
      }
    }
    return failure(id, -32601, `Method not found: ${method}`);
  };
}

// Serve over standard input and output: one JSON message a line, each way.
export async function serve(handle, input, output) {
  let buffered = '';
  let last = Promise.resolve();
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  for await (const chunk of input) {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (!line) continue;
      // Requests are answered in the order they came, so two changes to one note cannot cross.
      last = last.then(async () => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON' } });
        }
        let response;
        try {
          response = await handle(message);
        } catch {
          if (message?.id !== undefined) response = { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } };
        }
        if (response) send(response);
      });
    }
  }
  await last;
}
