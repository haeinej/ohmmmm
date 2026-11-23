// What a client may read without calling a tool: the playbook, the profile, the observations (all,
// and each one), approved skills, and the tools switched on. Secrets, proposals and history are
// never served.
import { NAME, Refused } from './core.mjs';
import { OBSERVATION_ID } from './folder.mjs';

const markdown = (uri, text) => ({ uri, mimeType: 'text/markdown', text });
const json = (uri, value) => ({ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) });

export function createResources(cortex) {
  return {
    async list() {
      const listed = [
        { uri: 'cortex://agents/AGENTS.md', name: 'Playbook', description: 'How to keep this cortex and file into the vault. Read before anything else', mimeType: 'text/markdown' },
        { uri: 'cortex://profile', name: 'Profile', description: 'Who this cortex belongs to: the account, and their preferences, goals and notes', mimeType: 'application/json' },
        { uri: 'cortex://observations', name: 'Observations', description: 'What agents learned working with them, newest first', mimeType: 'application/json' },
        { uri: 'cortex://tools', name: 'Tools', description: 'What the person has switched on', mimeType: 'application/json' },
      ];
      for (const skill of await cortex.listSkills()) listed.push({ uri: `cortex://skills/${skill.name}`, name: skill.name, description: skill.description, mimeType: 'text/markdown' });
      return listed;
    },

    async read(uri) {
      if (uri === 'cortex://agents/AGENTS.md') return markdown(uri, await cortex.rules());
      if (uri === 'cortex://profile') {
        const { account, text, sections } = await cortex.profile();
        return json(uri, { account, text, sections });
      }
      if (uri === 'cortex://observations') return json(uri, (await cortex.observations({ limit: 500 })).observations.map(({ version, ...item }) => item));
      if (uri === 'cortex://tools') return json(uri, (await cortex.listTools()).filter(tool => tool.on).map(({ name, description }) => ({ name, description })));
      const observation = /^cortex:\/\/observations\/([^/]+)$/.exec(uri);
      if (observation && OBSERVATION_ID.test(observation[1])) return json(uri, (await cortex.readObservation(observation[1])).observation);
      const skill = /^cortex:\/\/skills\/([^/]+)$/.exec(uri);
      if (skill && NAME.test(skill[1])) return markdown(uri, (await cortex.getSkill(skill[1])).skill.text);
      throw new Refused('NotFound', `There is no resource ${uri}`);
    },
  };
}
