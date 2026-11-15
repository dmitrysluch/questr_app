import { avatars } from '../../shared/catalog.ts';
import type { AvatarAppearance } from '../../shared/avatar.ts';

const skin = {
  porcelain: ['#f9dcca', '#d9a890', '#fff0dd'], light: ['#eec2a0', '#c58e74', '#f9d6b8'],
  warm: ['#dba47c', '#aa7056', '#edbe96'], olive: ['#c4946b', '#916849', '#daad7e'],
  brown: ['#a66c48', '#75472f', '#c2895e'], deep: ['#70442f', '#4a2b25', '#966046'],
} as const;
const hair = {
  black: ['#302b32', '#171b24', '#55505a'], brown: ['#71503e', '#422f2d', '#997058'],
  blonde: ['#d5a456', '#a2763c', '#f5ca78'], ginger: ['#b35a37', '#793822', '#d98851'],
  silver: ['#b7b9bc', '#858b94', '#e2dedd'], pink: ['#da75a1', '#a24777', '#f3a5bd'],
  blue: ['#5382b8', '#365589', '#79a7d3'], purple: ['#8566ae', '#583c82', '#b090cb'],
} as const;
const clothes = {
  rust_tee: ['#ad563e', '#763c35', '#d57d54'], sage_tee: ['#78946b', '#51684f', '#a4b88a'],
  cream_sweater: ['#e1cba5', '#ae9573', '#f5e5c7'], blue_sweater: ['#597d9e', '#37566f', '#81a7bb'],
  plum_hoodie: ['#795a7f', '#503955', '#a181a6'], dark_jacket: ['#4c5957', '#303b3b', '#75827a'],
} as const;

type Props = { id: string | null; appearance?: AvatarAppearance | null; className?: string; alt?: string };
export function Character({ id, appearance, className = '', alt = '' }: Props) {
  const avatar = avatars.find(a => a.id === id) ?? avatars[0];
  return <div className={`character ${className}`} style={{ '--avatar-bg': avatar.background } as React.CSSProperties}>
    {appearance ? <Sprite appearance={appearance} alt={alt} /> : <img src={avatar.asset} alt={alt} draggable={false} />}
  </div>;
}

function Sprite({ appearance: a, alt }: { appearance: AvatarAppearance; alt: string }) {
  const [face, faceShade, faceLight] = skin[a.skinTone];
  const [hairBase, hairShade, hairLight] = hair[a.hairColor];
  const [shirt, shirtShade, shirtLight] = clothes[a.top];
  const isFeminine = a.silhouette === 'feminine';
  const isMasculine = a.silhouette === 'masculine';
  const left = isMasculine ? 5 : isFeminine ? 9 : 7;
  const right = 48 - left;
  const headLeft = isFeminine ? 14 : 13;
  const headRight = 48 - headLeft;
  const longHair = ['long', 'bob', 'ponytail'].includes(a.hairStyle);
  const sweater = a.top.includes('sweater');
  return <svg viewBox="0 0 48 48" role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} shapeRendering="crispEdges" focusable="false">
    {/* Hair behind face and shoulders. */}
    {longHair && <><path d={`M${headLeft - 2} 12h${headRight - headLeft + 4}v24h-5v-6h-${headRight - headLeft - 6}v6h-5z`} fill={hairShade} />
      <path d={`M${headLeft - 1} 12h${headRight - headLeft + 2}v20h-3v-12h-${headRight - headLeft - 4}v12h-3z`} fill={hairBase} /></>}
    {a.hairStyle === 'ponytail' && <><rect x="35" y="15" width="7" height="19" fill={hairShade} /><rect x="37" y="17" width="5" height="14" fill={hairBase} /><rect x="35" y="17" width="5" height="2" fill="#c97865" /></>}
    {/* Torso and arms. */}
    <path d={`M${left + 5} 31h${right - left - 10}v2h5v2h4v13H${left - 4}V35h4v-2h5z`} fill="#37343b" />
    <path d={`M${left + 5} 32h${right - left - 10}v2h5v2h3v12H${left - 3}V36h3v-2h5z`} fill={shirt} />
    <rect x={left - 3} y="41" width="5" height="6" fill={faceShade} /><rect x={right - 2} y="41" width="5" height="6" fill={faceShade} />
    <path d={`M${left + 5} 34h${right - left - 10}v2h5v2h-5v10H${left + 5}V38h-5v-2h5z`} fill={shirtLight} opacity=".45" />
    <path d={`M${left + 4} 45h${right - left - 8}v3H${left + 4}z`} fill={shirtShade} />
    {a.top === 'plum_hoodie' && <><path d="M14 32h4v5h12v-5h4v8h-5v-3H19v3h-5z" fill={shirtShade} /><rect x="20" y="38" width="2" height="5" fill="#e5c9ad" /><rect x="26" y="38" width="2" height="5" fill="#e5c9ad" /></>}
    {a.top === 'dark_jacket' && <><path d="M17 33h4l3 5-5 10h-3zM31 33h-4l-3 5 5 10h3z" fill={shirtShade} /><rect x="23" y="38" width="2" height="10" fill="#d5ad85" /></>}
    {sweater && <><rect x={left - 3} y="43" width="6" height="2" fill={shirtShade} /><rect x={right - 3} y="43" width="6" height="2" fill={shirtShade} /></>}
    {/* Neck, ears, face and its small features. */}
    <rect x="20" y="27" width="8" height="8" fill={faceShade} /><rect x="21" y="27" width="6" height="6" fill={face} />
    <rect x={headLeft - 3} y="19" width="4" height="7" fill={faceShade} /><rect x={headRight - 1} y="19" width="4" height="7" fill={faceShade} />
    <path d={`M${headLeft + 3} 10h${headRight - headLeft - 6}v2h3v3h3v12h-2v4h-4v2H${headLeft + 4}v-2h-4v-4h-2V15h3v-3h3z`} fill={faceShade} />
    <path d={`M${headLeft + 3} 11h${headRight - headLeft - 6}v2h3v3h2v11h-2v4h-4v1H${headLeft + 4}v-1h-4v-4h-2V16h2v-3h3z`} fill={face} />
    <rect x={headLeft + 1} y="17" width="3" height="10" fill={faceLight} opacity=".6" />
    <rect x="18" y="21" width="2" height="2" fill="#292930" /><rect x="28" y="21" width="2" height="2" fill="#292930" />
    <rect x="23" y="24" width="2" height="2" fill={faceShade} /><rect x="22" y="28" width="4" height="1" fill="#86534c" />
    {isMasculine && <><rect x="17" y="19" width="4" height="1" fill={hairShade} /><rect x="27" y="19" width="4" height="1" fill={hairShade} /></>}
    {isFeminine && <><rect x="17" y="21" width="1" height="1" fill="#292930" /><rect x="30" y="21" width="1" height="1" fill="#292930" /></>}
    {/* Hair on top and around the face. */}
    {a.hairStyle !== 'shaved' && <>
      <path d={`M${headLeft - 1} 14v-4h3V8h4V6h${headRight - headLeft - 8}v2h4v2h3v4h2v7h-3v-4h-2v-3h-${headRight - headLeft - 4}v3h-2v4h-3v-7z`} fill={hairShade} />
      <path d={`M${headLeft} 13v-3h4V8h${headRight - headLeft - 8}v2h4v3h2v3h-4v-3h-${headRight - headLeft - 4}v3h-2v3h-2v-6z`} fill={hairBase} />
      <rect x={headLeft + 4} y="8" width="8" height="2" fill={hairLight} />
    </>}
    {a.hairStyle === 'buzz' && <><rect x={headLeft} y="14" width="3" height="4" fill={hairBase} /><rect x={headRight - 3} y="14" width="3" height="4" fill={hairBase} /></>}
    {a.hairStyle === 'shaved' && <><path d="M15 14v-3h3V9h12v2h3v4h-3v-3H18v3z" fill={hairShade} /><rect x="18" y="10" width="12" height="2" fill={hairBase} /></>}
    {a.hairStyle === 'bob' && <><rect x={headLeft - 2} y="17" width="4" height="15" fill={hairBase} /><rect x={headRight - 2} y="17" width="4" height="15" fill={hairBase} /><rect x={headLeft - 2} y="30" width="5" height="2" fill={hairShade} /><rect x={headRight - 3} y="30" width="5" height="2" fill={hairShade} /></>}
    {a.hairStyle === 'long' && <><rect x={headLeft - 2} y="17" width="4" height="22" fill={hairBase} /><rect x={headRight - 2} y="17" width="4" height="22" fill={hairBase} /><rect x={headLeft - 2} y="37" width="6" height="2" fill={hairShade} /><rect x={headRight - 4} y="37" width="6" height="2" fill={hairShade} /></>}
    {a.hairStyle === 'bangs' && <><rect x="16" y="13" width="16" height="5" fill={hairBase} /><rect x="17" y="17" width="5" height="4" fill={hairShade} /><rect x="26" y="17" width="5" height="3" fill={hairShade} /></>}
    {a.hairStyle === 'curly' && <>{[[13,12],[17,8],[22,7],[27,8],[32,12],[12,17],[34,17],[15,16],[29,15]].map(([x,y]) => <g key={`${x}-${y}`}><rect x={x} y={y} width="5" height="5" fill={hairShade} /><rect x={x + 1} y={y} width="3" height="3" fill={hairBase} /><rect x={x + 1} y={y} width="1" height="1" fill={hairLight} /></g>)}</>}
    {/* Accessories. */}
    {a.headwear === 'beanie' && <><path d="M13 16v-5h3V8h3V6h10v2h3v3h3v5z" fill="#7d594e" /><path d="M16 12v-3h3V7h10v2h3v3z" fill="#a7755d" /><rect x="12" y="15" width="24" height="4" fill="#694b44" /><rect x="15" y="15" width="18" height="2" fill="#b68368" /></>}
    {a.headwear === 'headband' && <><rect x="13" y="14" width="22" height="3" fill="#c57974" /><rect x="13" y="17" width="3" height="4" fill="#c57974" /><rect x="32" y="17" width="3" height="4" fill="#c57974" /><rect x="17" y="14" width="5" height="1" fill="#ecaca0" /></>}
    {a.headwear === 'headphones' && <><path d="M12 22v-7h3V9h4V7h10v2h4v6h3v7h-2v-7h-3v-5H17v5h-3v7z" fill="#373742" /><rect x="11" y="19" width="5" height="10" fill="#3e4854" /><rect x="32" y="19" width="5" height="10" fill="#3e4854" /><rect x="12" y="21" width="2" height="6" fill="#8aa2af" /><rect x="34" y="21" width="2" height="6" fill="#8aa2af" /></>}
    {a.earrings && <><rect x={headLeft - 2} y="26" width="2" height="4" fill="#d8b25e" /><rect x={headRight} y="26" width="2" height="4" fill="#d8b25e" /><rect x={headLeft - 2} y="30" width="2" height="1" fill="#fff0b4" /><rect x={headRight} y="30" width="2" height="1" fill="#fff0b4" /></>}
  </svg>;
}
