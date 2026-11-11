import { avatars } from '../../shared/catalog.ts';

export function Character({ id, className = '', alt = '' }: { id: string | null; className?: string; alt?: string }) {
  const avatar = avatars.find(a => a.id === id) ?? avatars[0];
  return <div className={`character ${className}`} style={{ '--avatar-bg': avatar.background } as React.CSSProperties}>
    <img src={avatar.asset} alt={alt} draggable={false} />
  </div>;
}
