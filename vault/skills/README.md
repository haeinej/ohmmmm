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

[design-home](design-home/SKILL.md) is the [curator](../agents/curator.md)'s first job:
screen every source read-only, report with the fixed
[home report template](../docs/agents/home-report.md), discuss item by item with the
owner, and apply only what they decided. A dry run on a real site:
[home-report-haeinjung.md](../examples/home-report-haeinjung.md).

The curator is the plugin's one agent (`agents/curator.md`). It alone settles labels,
channels, moves and merges; working agents flag those questions as cortex
observations with `needs: curator`.

The [repository README](../README.md) lists the other bundled skills.
