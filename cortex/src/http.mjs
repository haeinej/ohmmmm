// MCP over HTTP: the Streamable HTTP transport, around the same handler `cortex mcp` serves over
// standard input and output. It follows the transport of the initialize-based revisions
// (2025-06-18, the newest that src/protocol.mjs negotiates, and 2025-11-25), which is what clients
// that begin with `initialize` speak:
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http
//
// - One endpoint, /mcp. Each JSON-RPC message is its own POST, and a request is answered with one
//   JSON object. This server never sends a request of its own, so it offers no event stream: GET
//   is answered 405, which the specification allows.
// - `initialize` starts a session and its answer carries an Mcp-Session-Id header. Every later
//   message must carry it: without one the answer is 400, with an unknown one 404, which tells the
//   client to initialize again. DELETE ends a session.
// - Each session has its own tools, so a cortex_forget confirmation stays in the session it was
//   issued in, and its own agent name, from that session's `initialize`.
// - With a token, every request needs `Authorization: Bearer <token>`, or it is answered 401 and
//   nothing else. An Origin header that is not this machine is answered 403, against DNS rebinding.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { Refused } from './core.mjs';
import { agentName, openCortex } from './folder.mjs';
import { getPrompt, PROMPTS } from './prompts.mjs';
import { createServer } from './protocol.mjs';
import { createResources } from './resources.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from './tools.mjs';

export const ENDPOINT = '/mcp';
// The versions src/protocol.mjs negotiates. A request naming any other in MCP-Protocol-Version is refused.
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LIMIT = 4 * 1024 * 1024;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

// The token lives with the other secrets: git never takes agents/secrets/, and no tool reads it.
export const tokenPath = dir => join(dir, 'agents', 'secrets', 'mcp-token');

// Makes a new token and writes it. An existing one is replaced only when asked, and is not kept:
// an old secret has no use, and a copy of it anywhere is one more place to leak from.
export async function makeToken(dir, { replace = false } = {}) {
  const secrets = join(dir, 'agents', 'secrets');
  if (!(await stat(secrets).catch(() => null))?.isDirectory()) throw new Refused('NotFound', `${dir} is not a cortex: it has no agents/secrets/. Start one with cortex init.`);
  const token = randomBytes(32).toString('base64url');
  const path = tokenPath(dir);
  if (!replace && await stat(path).catch(() => null)) throw new Refused('NameTaken', 'This cortex already has a token. To make a new one, and stop the old one working, run cortex token --replace.');
  // Written whole to a new file only the person can read, then moved over the old one, so a
  // replaced token never keeps the old file's permissions and is never half written.
  const fresh = join(secrets, `.mcp-token-${randomUUID()}.tmp`);
  try {
    await writeFile(fresh, `${token}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(fresh, 0o600);
    if (replace) await rename(fresh, path);
    else await link(fresh, path).finally(() => rm(fresh, { force: true }));
  } catch (problem) {
    await rm(fresh, { force: true });
    if (problem.code === 'EEXIST') throw new Refused('NameTaken', 'This cortex already has a token. To make a new one, and stop the old one working, run cortex token --replace.');
    throw problem;
  }
  return token;
}

// The token, or null when there is none.
export async function readToken(dir) {
  let content;
  try {
    content = await readFile(tokenPath(dir), 'utf8');
  } catch (problem) {
    if (problem.code === 'ENOENT') return null;
    throw problem;
  }
  const token = content.trim();
  if (!token) throw new Refused('InvalidRequest', `${tokenPath(dir)} is empty. Make a token with cortex token --replace.`);
  return token;
}

// What each new session is served: the same tools, resources and prompts as `cortex mcp`, made
// for the agent this session's initialize names. `agent`, when given, names every session.
export function cortexSessions(dir, { agent: fixed } = {}) {
  return () => {
    let agent = agentName(fixed);
    const cortex = () => openCortex(dir, { actor: agent });
    return createServer({
      tools: () => createTools(cortex()),
      list: TOOLS,
      resources: { list: () => createResources(cortex()).list(), read: uri => createResources(cortex()).read(uri) },
      prompts: { list: PROMPTS, get: getPrompt },
      instructions: INSTRUCTIONS,
      onClient: name => { agent = agentName(fixed ?? name); },
    });
  };
}

const digest = value => createHash('sha256').update(value).digest();
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// The request handler for node:http. `open(req)` makes the handler of a new session, given the
// request that initializes it. `token`, when given, is required of every request. `origins` are
// browser origins allowed besides this machine. `owner(req)`, when given, says who is asking (such as
// which key signed the request): a session answers only who opened it, and is not found by anyone else.
export function httpTransport({ open, token, origins = [], endpoint = ENDPOINT, maxSessions = 100, owner }) {
  const expected = token ? digest(`Bearer ${token}`) : null;
  // Oldest first, so the session used least recently is the one let go when there are too many.
  const sessions = new Map();

  const send = (res, status, body, headers = {}) => {
    if (body === undefined) {
      res.writeHead(status, headers).end();
    } else {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers }).end(text);
    }
  };
  const allowedOrigin = origin => {
    if (origins.includes(origin)) return true;
    try {
      return LOOPBACK.includes(new URL(origin).hostname);
    } catch {
      return false;
    }
  };
  const signedIn = header => {
    if (!expected) return true;
    return typeof header === 'string' && timingSafeEqual(digest(header), expected);
  };
  // Stops keeping the body once it passes the limit, and still reads it to the end, so the client
  // is answered 413 rather than finding its connection cut.
  const read = req => new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= LIMIT) chunks.push(chunk);
      else if (size > 16 * LIMIT) req.destroy();
    });
    req.on('end', () => (size > LIMIT ? fail(Object.assign(new Error('Too large'), { tooLarge: true })) : done(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
    req.on('close', () => fail(new Error('Closed before the end')));
  });
  // Answered 413 and the rest of the body read and dropped, so the client, which may still be
  // sending, gets the answer rather than a cut connection. Past sixteen times the limit the
  // connection is closed, so nobody can keep one busy by sending forever.
  const tooLarge = (req, res) => {
    let dropped = 0;
    req.on('data', chunk => {
      dropped += chunk.length;
      if (dropped > 16 * LIMIT) req.destroy();
    });
    req.resume();
    send(res, 413, failure(null, -32600, `The message is too large: at most ${LIMIT} bytes`));
  };
  const session = req => {
    const id = req.headers['mcp-session-id'];
    if (typeof id !== 'string' || !id) return { status: 400, message: 'Send initialize first, then the Mcp-Session-Id header its answer gave, with every request' };
    const held = sessions.get(id);
    if (!held || (owner && held.owner !== owner(req))) return { status: 404, message: 'There is no such session. Send initialize again to start a new one' };
    sessions.delete(id);
    sessions.set(id, held);
    return { id, held };
  };
  // Messages in one session are handled in the order they came, so two changes cannot cross.
  const inTurn = (held, message) => {
    const result = held.last.then(() => held.handle(message)).catch(() => (message.id === undefined ? undefined : failure(message.id, -32603, 'Internal error')));
    held.last = result.catch(() => {});
    return result;
  };

  async function post(req, res) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, failure(null, -32600, 'Send the message as Content-Type: application/json'));
    const accept = req.headers.accept;
    if (accept && !/application\/json|application\/\*|\*\/\*/i.test(accept)) return send(res, 406, failure(null, -32600, 'Accept application/json: answers are sent as JSON'));
    if (Number(req.headers['content-length']) > LIMIT) return tooLarge(req, res);
    let message;
    try {
      message = JSON.parse(await read(req));
    } catch (problem) {
      if (problem.tooLarge) return tooLarge(req, res);
      return send(res, 400, failure(null, -32700, 'Not JSON'));
    }
    if (Array.isArray(message)) return send(res, 400, failure(null, -32600, 'Send one JSON-RPC message in each request'));
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return send(res, 400, failure(null, -32600, 'Not a JSON-RPC 2.0 message'));
    const isRequest = typeof message.method === 'string' && message.id !== undefined;

    if (isRequest && message.method === 'initialize') {
      const handle = open(req);
      const answer = await Promise.resolve().then(() => handle(message)).catch(() => failure(message.id, -32603, 'Internal error'));
      if (!answer?.result) return send(res, 200, answer);
      const id = randomUUID();
      sessions.set(id, { handle, last: Promise.resolve(), ...(owner ? { owner: owner(req) } : {}) });
      while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
      return send(res, 200, answer, { 'Mcp-Session-Id': id });
    }

    const found = session(req);
    if (found.message) return send(res, found.status, failure(isRequest ? message.id : null, -32000, found.message));
    const version = req.headers['mcp-protocol-version'];
    if (version !== undefined && !VERSIONS.includes(version)) return send(res, 400, failure(isRequest ? message.id : null, -32000, `Unsupported MCP-Protocol-Version ${version}. Supported: ${VERSIONS.join(', ')}`));
    // A notification, or the client answering something: accepted, with nothing to say back.
    if (!isRequest) {
      if (typeof message.method === 'string') await inTurn(found.held, message);
      return send(res, 202);
    }
    return send(res, 200, await inTurn(found.held, message));
  }

  return async function handle(req, res) {
    try {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigin(origin)) return send(res, 403, failure(null, -32000, 'Forbidden origin'));
      // Before anything else, so a request without the token learns nothing, not even which paths exist.
      if (!signedIn(req.headers.authorization)) return send(res, 401, undefined, { 'WWW-Authenticate': 'Bearer' });
      if (new URL(req.url, 'http://cortex').pathname !== endpoint) return send(res, 404, failure(null, -32000, `The MCP endpoint is ${endpoint}`));
      if (req.method === 'POST') return await post(req, res);
      if (req.method === 'DELETE') {
        const found = session(req);
        if (found.message) return send(res, found.status, failure(null, -32000, found.message));
        sessions.delete(found.id);
        return send(res, 204);
      }
      // GET would open a stream for messages the server starts. This server never starts one.
      return send(res, 405, undefined, { Allow: 'POST, DELETE' });
    } catch {
      if (!res.headersSent) send(res, 500, failure(null, -32603, 'Internal error'));
      else res.destroy();
    }
  };
}

// Starts listening, and resolves to the node:http server once it is. Port 0 picks a free one.
export function listen(handler, { port = 8765, host = '127.0.0.1' } = {}) {
  const server = createHttpServer(handler);
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done(server);
    });
  });
}
