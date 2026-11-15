import { useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { avatars } from '../../shared/catalog.ts';
import { appearanceForPreset, hairColors, hairStyles, headwear, isPresetAppearance, silhouettes, skinTones, tops, type AvatarAppearance } from '../../shared/avatar.ts';
import { t, type TranslationKey } from '../i18n.ts';
import { Character } from './Character.tsx';

type Part = 'face' | 'hair' | 'outfit' | 'accessories';
type Props = { id: string | null; appearance: AvatarAppearance | null; onChange: (appearance: AvatarAppearance, id?: string) => void };
const labels = (part: string, value: string) => t(`avatar.${part}.${value}` as TranslationKey);

export function AvatarBuilder({ id, appearance, onChange }: Props) {
  const [mode, setMode] = useState<'presets' | 'customize'>('presets');
  const [part, setPart] = useState<Part>('face');
  const current = appearance ?? appearanceForPreset(id);
  const presetSelected = isPresetAppearance(id, appearance);
  const update = (patch: Partial<AvatarAppearance>) => onChange({ ...current, ...patch });
  const option = (key: string, label: string, selected: boolean, preview: AvatarAppearance, choose: () => void) =>
    <button key={key} type="button" className={`avatar-part-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={choose}>
      <Character id={id} appearance={preview} /><span>{label}</span>{selected && <Check size={13} className="avatar-part-check" />}
    </button>;
  return <div className="avatar-selection avatar-builder">
    {mode === 'presets' ? <div className="avatar-builder-panel">
      <div className="avatar-gallery-header"><button type="button" className="outline-button" onClick={() => setMode('customize')}>{t('avatar.customize')}</button></div>
      <div className="avatar-grid" role="group" aria-label={t('avatar.galleryTitle')}>
        {avatars.map(avatar => <button type="button" key={avatar.id} className={`avatar-choice ${id === avatar.id && presetSelected ? 'selected' : ''}`} aria-label={t('avatar.choose', { name: avatar.name })} aria-pressed={id === avatar.id && presetSelected} onClick={() => onChange(appearanceForPreset(avatar.id), avatar.id)}>
          <Character id={avatar.id} appearance={appearanceForPreset(avatar.id)} /><span>{avatar.name}</span>{id === avatar.id && presetSelected && <span className="avatar-check"><Check size={12} strokeWidth={3} /></span>}
        </button>)}
      </div>
    </div> : <>
    <button type="button" className="text-button avatar-back-to-presets" onClick={() => setMode('presets')}><ArrowLeft size={15} />{t('avatar.backToCharacters')}</button>
    <div className="avatar-builder-tabs" role="tablist" aria-label={t('avatar.customize')}>
      {(['face', 'hair', 'outfit', 'accessories'] as const).map(value => <button type="button" key={value} role="tab" aria-selected={part === value} onClick={() => setPart(value)}>{t(`avatar.tab.${value}`)}</button>)}
    </div>
    <div role="tabpanel" className="avatar-builder-panel">
      {part === 'face' && <><h2>{t('avatar.faceTitle')}</h2><div className="avatar-option-grid avatar-face-grid">
        {silhouettes.flatMap(silhouette => skinTones.map(skinTone => option(`${silhouette}-${skinTone}`, `${labels('silhouette', silhouette)} · ${labels('skin', skinTone)}`, current.silhouette === silhouette && current.skinTone === skinTone, { ...current, silhouette, skinTone }, () => update({ silhouette, skinTone }))))}
      </div></>}
      {part === 'hair' && <><h2>{t('avatar.hairStyleTitle')}</h2><div className="avatar-option-grid">
        {hairStyles.map(hairStyle => option(hairStyle, labels('hairStyle', hairStyle), current.hairStyle === hairStyle, { ...current, hairStyle }, () => update({ hairStyle })))}
      </div><h2 className="avatar-subheading">{t('avatar.hairColorTitle')}</h2><div className="avatar-color-grid" role="group" aria-label={t('avatar.hairColorTitle')}>
        {hairColors.map(hairColor => <button type="button" key={hairColor} className={`avatar-color-choice ${current.hairColor === hairColor ? 'selected' : ''}`} aria-label={labels('hairColor', hairColor)} aria-pressed={current.hairColor === hairColor} onClick={() => update({ hairColor })}><span className={`hair-swatch hair-${hairColor}`} /><span>{labels('hairColor', hairColor)}</span></button>)}
      </div></>}
      {part === 'outfit' && <><h2>{t('avatar.outfitTitle')}</h2><div className="avatar-option-grid">
        {tops.map(top => option(top, labels('top', top), current.top === top, { ...current, top }, () => update({ top })))}
      </div></>}
      {part === 'accessories' && <><h2>{t('avatar.headwearTitle')}</h2><div className="avatar-option-grid">
        {headwear.map(value => option(value, labels('headwear', value), current.headwear === value, { ...current, headwear: value }, () => update({ headwear: value })))}
      </div><label className="avatar-earrings"><input type="checkbox" checked={current.earrings} onChange={event => update({ earrings: event.target.checked })} />{t('avatar.earrings')}</label></>}
    </div>
    </>}
  </div>;
}
