// Filing advice: one answer to "how should I file this?", built from what cortex already knows.
// The likely channels come from the vault's channels and what has been observed about each, the
// skill from the approved skills, and related blocks from the vault's own search. Matching is by words; nothing here calls a model.
//
// It reads and never writes: not the cortex, not the vault. Saving is the vault's job, done by
// the agent through the vault's own tools once the person says yes.
import { Refused } from './core.mjs';
import { matcherOf, wordsOf } from './vault.mjs';

const CHANNELS = 3;
const RELATED = 5;
// The words of the text that go to search, besides the title's: the ones it uses most.
const TEXT_WORDS = 8;
// The skill the template ships for any source. It is named only when no other approved skill fits.
const GENERAL_SKILL = 'file-a-source';

function checkSource({ kind, title, text } = {}) {
  if (typeof kind !== 'string' || !kind.trim() || kind.length > 200) throw new Refused('InvalidRequest', 'Say what the source is, in a few words, such as "meeting transcript" or "link"');
  if (title !== undefined && (typeof title !== 'string' || title.length > 500)) throw new Refused('InvalidRequest', 'title is text, at most 500 characters');
  if (text !== undefined && (typeof text !== 'string' || text.length > 1_000_000)) throw new Refused('InvalidRequest', 'text is the source as given, at most 1,000,000 characters');
  return { kind: kind.trim(), title: title?.trim() ?? '', text: text ?? '' };
}

function mostUsed(text, count) {
  const seen = new Map();
  for (const token of text.split(/\s+/)) for (const word of wordsOf(token)) seen.set(word, (seen.get(word) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([word]) => word);
}

// A channel scores for each of its words the source has: most for the kind, then the title, then
// the text. A word in the channel's name counts once more than one only in what was observed about it.
function channelsFor(source, shape, notes) {
  const weights = [[matcherOf(source.kind), 3], [matcherOf(source.title), 2], [matcherOf(source.text), 1]];
  const weight = word => Math.max(0, ...weights.filter(([holds]) => holds(word)).map(([, value]) => value));
  const scored = [];
  for (const { channel, blocks } of shape.channels) {
    const said = notes.get(channel) ?? '';
    const inName = wordsOf(channel.replace(/[/-]/g, ' '));
    const inMeaning = wordsOf(said);
    let score = 0;
    const shared = [];
    for (const word of new Set([...inName, ...inMeaning])) {
      const found = weight(word);
      if (!found) continue;
      score += found + (inName.has(word) ? 1 : 0);
      shared.push(word);
    }
    if (!score) continue;
    const named = shared.filter(word => inName.has(word));
    const meant = shared.filter(word => !inName.has(word));
    const why = [named.length ? `its name shares ${named.join(', ')} with the source` : '', meant.length ? `what was observed about it shares ${meant.join(', ')}` : ''].filter(Boolean).join(', and ');
    scored.push({ score, item: { channel, blocks, ...(said ? { observed: said } : {}), why: `${why[0].toUpperCase()}${why.slice(1)}` } });
  }
  scored.sort((a, b) => b.score - a.score || a.item.channel.localeCompare(b.item.channel));
  // A channel and its own sub-channel are not both offered: the sub-channel is the more exact place.
  const chosen = [];
  const within = (sub, parent) => sub.startsWith(`${parent}/`);
  for (const { item } of scored) {
    if (chosen.length === CHANNELS) break;
    if (chosen.some(other => within(other.channel, item.channel))) continue;
    const parent = chosen.findIndex(other => within(item.channel, other.channel));
    if (parent >= 0) chosen[parent] = item;
    else chosen.push(item);
  }
  return chosen;
}

// The approved skill whose name and description share the most words with the kind, if any does.
// Between two that share as many, the one with fewer other words is the more exact. The general
// filing skill fits most kinds, so it is named only when no other skill shares a word.
function skillFor(kind, skills) {
  const wanted = [...wordsOf(kind)];
  const rank = skill => {
    const text = `${skill.name.replace(/-/g, ' ')} ${skill.description}`;
    const holds = matcherOf(text);
    const score = wanted.filter(holds).length;
    return { score, share: score / Math.max(1, wordsOf(text).size), skill: { name: skill.name, description: skill.description } };
  };
  const best = list => list.map(rank).filter(item => item.score)
    .sort((a, b) => b.score - a.score || b.share - a.share || a.skill.name.localeCompare(b.skill.name))[0]?.skill ?? null;
  return best(skills.filter(skill => skill.name !== GENERAL_SKILL)) ?? best(skills.filter(skill => skill.name === GENERAL_SKILL));
}

function askFor(channels, related, shape) {
  if (!channels.length) {
    const names = shape.channels.map(item => item.channel);
    return names.length
      ? `None of the channels fits this by its words: which one should it go in (${names.join(', ')}), or should it start a new one?`
      : 'The vault has no channels yet: where would you like this to go?';
  }
  const [first] = channels;
  const titled = first.observed ? `titled the way blocks there are (${first.observed})` : 'with a title in your words';
  const linked = related.length ? `, linked to ${related.map(block => `"${block.title}"`).join(', ')}` : '';
  return `Shall I file this in ${first.channel}, ${titled}${linked}?`;
}

export async function adviseFiling(cortex, given) {
  const source = checkSource(given);
  const skill = skillFor(source.kind, await cortex.listSkills());
  const answer = (vault, rest) => ({ vault, channels: [], skill, related: [], ...rest });

  let vault;
  try { vault = await cortex.connectedVault(); } catch (problem) {
    if (!(problem instanceof Refused)) throw problem;
    return answer({ connected: true, reachable: false, problem: problem.message }, { ask: `The vault cannot be read (${problem.message}), so I cannot say where this goes yet. Shall I wait until it can?` });
  }
  if (!vault) return answer({ connected: false }, { ask: 'No vault is connected to this cortex, so there is nowhere to file this yet. Would you like to connect one first?' });

  let shape;
  try { shape = await vault.shape(); } catch (problem) {
    if (!(problem instanceof Refused)) throw problem;
    return answer({ connected: true, reachable: false, problem: problem.message }, { ask: `The vault cannot be read (${problem.message}), so I cannot say where this goes yet. Shall I wait until it can?` });
  }
  const channels = channelsFor(source, shape, await cortex.channelNotes());

  // A vault that cannot search gives no related blocks, and the rest of the answer stands.
  let related = [];
  if (typeof vault.search === 'function') {
    const words = [...new Set([...wordsOf(source.title), ...mostUsed(source.text, TEXT_WORDS)])];
    if (words.length) related = (await vault.search(words, RELATED)).slice(0, RELATED).map(({ id, title, channel }) => ({ id, title, channel }));
  }
  return answer({ connected: true }, { channels, related, ask: askFor(channels, related, shape) });
}
