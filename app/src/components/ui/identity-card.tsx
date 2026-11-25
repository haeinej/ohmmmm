import { useEffect, useRef, type CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

const material = {
  '--foreground': 'var(--ohm-paper-light)',
  '--muted-foreground': 'var(--ohm-identity-muted)',
  // Pointer state, written by useCardMotion: -1..1 on each axis.
  '--tx': '0', '--ty': '0',
} as CSSProperties;

/** Soft, shapeless light under the glass. Each drifts at its own depth as the card turns. */
const blobs: { at: string; size: string; tone: string; depth: number }[] = [
  { at: 'left-[-30%] top-[-50%]', size: 'size-[95%]', tone: 'var(--ohm-identity-glow)', depth: 10 },
  { at: 'right-[-35%] top-[-5%]', size: 'size-[90%]', tone: 'var(--ohm-identity-glow-soft)', depth: -12 },
  { at: 'left-[5%] bottom-[-70%]', size: 'size-[110%]', tone: 'var(--ohm-identity-deep)', depth: 8 },
];

/** Bounded pointer response: the card leans gently toward the pointer. */
function useCardMotion() {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const allowed = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    const target = { x: 0, y: 0 }, now = { x: 0, y: 0 };
    let frame = 0;
    const write = () => {
      const s = el.style;
      s.setProperty('--tx', now.x.toFixed(4));
      s.setProperty('--ty', now.y.toFixed(4));
    };
    const step = () => {
      // Critically-damped ease toward the pointer; stops scheduling once it has settled.
      now.x += (target.x - now.x) * 0.14;
      now.y += (target.y - now.y) * 0.14;
      write();
      const moving = Math.abs(target.x - now.x) + Math.abs(target.y - now.y) > 0.001;
      frame = moving ? requestAnimationFrame(step) : 0;
    };
    const kick = () => { if (!frame) frame = requestAnimationFrame(step); };
    const move = (event: PointerEvent) => {
      if (!allowed.matches || event.pointerType === 'touch') return;
      const box = el.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width * 2 - 1;
      const y = (event.clientY - box.top) / box.height * 2 - 1;
      const inside = Math.abs(x) <= 1 && Math.abs(y) <= 1;
      // Inside the card it follows fully; across the page it only leans, so it feels aware, not twitchy.
      const reach = inside ? 1 : 0.35;
      target.x = Math.max(-1, Math.min(1, x)) * reach;
      target.y = Math.max(-1, Math.min(1, y)) * reach;
      kick();
    };
    const rest = () => { target.x = 0; target.y = 0; kick(); };
    const leaveWindow = (event: PointerEvent) => { if (!event.relatedTarget) rest(); };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leaveWindow);
    window.addEventListener('blur', rest);
    allowed.addEventListener('change', rest);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', leaveWindow);
      window.removeEventListener('blur', rest);
      allowed.removeEventListener('change', rest);
    };
  }, []);
  return card;
}

/** `did:plc:xrcmfy47…` → method and the key in fours, read like a card number. A wallet's `0x…` reads the same way. */
function didParts(did: string) {
  const at = did.startsWith('0x') ? 2 : did.lastIndexOf(':') + 1;
  return { method: did.slice(0, at), groups: did.slice(at).match(/.{1,4}/g) ?? [] };
}

function CardNumber({ label, value }: { label: string; value: string }) {
  const { method, groups } = didParts(value);
  return <p className="flex min-w-0 items-baseline gap-2 font-mono text-small text-muted-foreground" title={value}>
    <span className="shrink-0 opacity-70">{method || label}</span>
    <span className="flex min-w-0 gap-1.5 overflow-hidden tracking-wider">{groups.map((g, i) => <span key={i}>{g}</span>)}</span>
  </p>;
}

/**
 * The person's identity as a card that leans toward the pointer: picture, name, the address of their home, their DID
 * and, when they have one, their wallet. `onOpenWorkspace` makes the address a link once a workspace exists, and
 * `onOpen` makes the card itself open their profile.
 *
 * Two finishes. `glass` is the cloudy forest glass. `matt` is flat colour with only a faint light where the pointer
 * is: `color` is the person's own (a mark, `var(--ohm-mark-navy)`), and without one the card is paper.
 */
export type IdentityCardProps = {
  /** Their DID. A card can be shown before they have one. */
  did?: string | null;
  wallet?: string | null;
  name: string;
  address?: string | null;
  avatarSrc?: string | null;
  bannerSrc?: string | null;
  onOpenWorkspace?: () => void;
  /** Open the person's profile. The whole card takes the click; the address stays its own. */
  onOpen?: () => void;
  finish?: 'glass' | 'matt';
  /** With the matt finish: the card's colour. Any mark carries the card's paper-light text. */
  color?: string | null;
  className?: string;
};

/** Fixed-size identity object. Apps supply data; no account or storage access lives here. */
export function IdentityCard({ did, wallet, name, address, avatarSrc, bannerSrc, onOpenWorkspace, onOpen, finish = 'glass', color, className }: IdentityCardProps) {
  const card = useCardMotion();
  const initial = name.trim().charAt(0).toUpperCase();
  const matt = finish === 'matt';
  // Matt paper with no colour is the page's own paper, so its words are the page's ink.
  const onPaper = matt && !color;
  const addressContent = <>
    <span className="truncate">{address}</span>
    <ArrowUpRight aria-hidden className="size-icon-sm shrink-0 opacity-70" />
  </>;
  const pill = cn('relative -ml-3 inline-flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-body text-foreground transition-colors', !matt && 'backdrop-blur-md');
  // The pill is an edge, not a fill: its text keeps the name's leading edge, and a filled shape reaching past that edge reads as a mistake.
  const pillEdge = { boxShadow: `inset 0 0 0 1px ${onPaper ? 'var(--ohm-line)' : 'var(--ohm-identity-pill-hover)'}` };

  return <div className={cn("w-(--ohm-identity-width) max-w-full flex-none [perspective:var(--ohm-identity-perspective)]", className)} style={onPaper ? { '--tx': '0', '--ty': '0' } as CSSProperties : material}>
    <section
      ref={card}
      data-identity-card={finish}
      aria-label={`Identity card for ${name}`}
      className="@container relative isolate aspect-(--ohm-identity-ratio) w-full overflow-hidden rounded-3xl text-left text-foreground will-change-transform"
      style={{
        transform: 'rotateX(calc(var(--ty) * var(--ohm-identity-tilt-x))) rotateY(calc(var(--tx) * var(--ohm-identity-tilt-y)))',
        boxShadow: `calc(var(--tx) * var(--ohm-identity-shadow-x)) calc(var(--ohm-identity-shadow-y) + var(--ty) * var(--ohm-identity-shadow-drift)) var(--ohm-identity-shadow-blur) var(--ohm-identity-shadow-spread) ${matt ? 'var(--ohm-identity-matt-shadow-color)' : 'var(--ohm-identity-shadow-color)'}, var(--ohm-identity-shadow-contact)`,
      }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-3xl" style={{ background: matt ? color ?? 'var(--ohm-paper)' : 'var(--ohm-identity-base)', clipPath: 'inset(0 round var(--ohm-radius-sheet))' }}>
        {matt
          // Matt: no glass and no sheen, only a faint light that sits where the pointer is.
          ? <span aria-hidden className="absolute inset-0" style={{
              background: 'radial-gradient(120% 90% at calc(50% + var(--tx) * 45%) calc(35% + var(--ty) * 45%), var(--ohm-identity-matt-light), transparent 60%)',
            }} />
          : <>
            {/* Under the glass: their banner if they have one, otherwise soft forest light */}
            {bannerSrc
              ? <img className="absolute inset-0 size-full scale-110 object-cover blur-2xl" src={bannerSrc} alt="" referrerPolicy="no-referrer" />
              : blobs.map((b, i) => <span key={i} aria-hidden className={`absolute ${b.at} ${b.size} rounded-full blur-(--ohm-identity-blur) opacity-90`}
                  style={{ background: b.tone, transform: `translate(calc(var(--tx) * ${b.depth}px), calc(var(--ty) * ${b.depth}px))` }} />)}

            {/* The glass itself */}
            <span aria-hidden className="absolute inset-0" style={{
              background: 'var(--ohm-identity-glass)',
              backdropFilter: 'var(--ohm-frost-blur)',
            }} />
          </>}

        {/* The card itself opens the profile; what is written on it lies above that. */}
        {onOpen && <button type="button" aria-label={`Open ${name}'s profile`} onClick={onOpen}
          className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />}

        {/* Identity. The leading edge sits a pill's inset further in, so the pill's own edge lands on the card's padding. */}
        <div className={cn("relative flex size-full flex-col justify-between p-3 ps-6 @min-[16rem]:p-4 @min-[16rem]:ps-7 @min-[23rem]:p-6 @min-[23rem]:ps-9", onOpen && "pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto")}>
          {/* A little lower than the padding, and a hair in: a circle set flush with the name's first letter looks further out than it is. */}
          <Avatar className="ms-0.5 mt-2 size-8 @min-[16rem]:size-16 @min-[23rem]:size-24 after:hidden" style={{
            transform: 'translate(calc(var(--tx) * 4px), calc(var(--ty) * 3px))',
          }}>
            <AvatarImage src={avatarSrc ?? undefined} alt="" referrerPolicy="no-referrer" />
            <AvatarFallback className="bg-transparent">
              <span className="flex size-full items-center justify-center rounded-full text-h1"
                style={{ fontFamily: 'var(--ohm-font-serif)', background: onPaper ? 'var(--ohm-wash)' : 'var(--ohm-identity-initial-fill)', color: onPaper ? 'var(--ohm-ink)' : 'var(--ohm-identity-initial)' }}>
                {initial}
              </span>
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col gap-1 @min-[16rem]:gap-2 @min-[23rem]:gap-3">
            <h2 className="truncate text-h2">{name}</h2>
            {address && (onOpenWorkspace
              ? <button type="button" onClick={onOpenWorkspace} className={`${pill} hover:bg-(--ohm-identity-pill-hover)`}
                  style={pillEdge} aria-label={`Open the workspace at ${address}`}>
                  {addressContent}
                </button>
              : <span className={pill} style={pillEdge} title={address}>{addressContent}</span>)}
            {did && <CardNumber label="did" value={did} />}
            {wallet && <CardNumber label="wallet" value={wallet} />}
          </div>
        </div>
      </div>

    </section>
  </div>;
}
