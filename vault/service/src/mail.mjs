// The one email ohm sends: a friend invite. It comes from ohm's own address with the asker's name,
// and replies go to the asker's own email, so any conversation carries on in their own mailbox.
// The link only opens ohm: signing in there shows the request, and the link grants nothing.
//
// `mail` is a Cloudflare Email Service binding (`send({ to, from, replyTo, subject, text })`).
// Without one, nothing is sent and asking works as before.

export const DAILY = 20;

export function inviteMail({ to, from, asker, askerEmail, message, link }) {
  const name = asker || askerEmail || 'Someone';
  return {
    to, from: { email: from, name: `${name} via ohm` },
    ...(askerEmail ? { replyTo: askerEmail } : {}),
    subject: `${name} wants to share with you on ohm`,
    text: [
      `${name} would like to be friends on ohm, so you can see what they share with friends.`,
      ...(message ? ['', `“${message}”`] : []),
      '', `Sign in to ohm with this email to answer: ${link}`,
      '', 'Nothing happens unless you answer. Reply to this email to write to them directly.',
    ].join('\n'),
  };
}

// Sends an invite if mail is set up. Returns whether it went.
export async function sendInvite(env, invite) {
  if (!env.MAIL?.send || !env.MAIL_FROM) return false;
  await env.MAIL.send(inviteMail({ ...invite, from: env.MAIL_FROM }));
  return true;
}
