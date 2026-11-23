# Skills

Each skill has its own folder. `SKILL.md` is the instruction entry point; supporting
files stay beside it so the agent can read the complete method in one place.

[document-work](document-work/) turns each finished outcome into distinct human
and agent documentation. Its folder contains:

- [SKILL.md](document-work/SKILL.md): when and how to apply the skill.
- [Human writing guide](document-work/human-guide.md): purpose, dependency reasons and end-to-end use.
- [Agent writing guide](document-work/agent-guide.md): contracts, boundaries and verification.
- [Usage guide](document-work/README.md): what to expect and how to invoke it.
- [Agent contract](document-work/contract.md): integration and maintenance of the skill itself.

[lint](lint/SKILL.md) checks a vault for meaning: candidates from `vault_lint`, judged
by the agent, recorded as cortex observations and fixed only within the person's grant.

[host-pds](host-pds/SKILL.md) sets up the person's own PDS on Cloudflare with Cirrus,
stopping for them at every account, payment, DNS, key and password step, checks that
the DID resolves, connects it to ohm, and hands off to [design-home](design-home/SKILL.md).
The human guide is [docs/host-your-pds.md](../docs/host-your-pds.md).

The [repository README](../README.md) lists the other bundled skills.
