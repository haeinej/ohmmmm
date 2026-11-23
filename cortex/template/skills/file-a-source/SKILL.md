---
name: file-a-source
description: How to file a source the person hands over, such as a transcript, a link or a note, into their vault
---
# Filing a source

Use this when the person hands you something to keep: they paste it, upload it, or say "save this". File only what they gave you. Never add a block or a fact of your own.

1. **Ask what it is,** if they have not said: a meeting transcript, a reading note, a link. Use their word for it.
2. **Call `cortex_file_advice`** with that kind, a title if it has one, and the text. It answers with the likely channels and what was observed about each, the skill for that kind of source if there is one, related blocks, and a question to ask. It writes nothing. If it names a skill, read it with `cortex_skill` and follow it too.
3. **Propose once.** Name one channel, a title in the style blocks there have, and the related blocks you would link. Ask in one question, and wait for their answer. If it says no vault is connected, or the vault cannot be read, tell them, and do not guess a place.
4. **Save through the vault's own tools** once they say yes, with their words as they gave them. Do not correct, shorten or summarise the source. Only the place, the title and the links are yours to suggest.
5. **Note what they changed.** If they picked another channel, renamed the title or dropped a link, write it down with `cortex_observe`, about that channel (`channel:<path>`), so the next session files it their way.

Publishing is a separate step, owned by the vault, and needs their approval again.
