import { useEffect, useRef, useState } from 'react';
import { api, apiBlob, ApiError } from '../api.ts';
import { errorText, t } from '../i18n.ts';

export type DateSettings = { enabled: boolean; paused: boolean; revision: number; photoStatus: 'pending' | 'approved' | 'rejected' | null; storageAvailable: boolean; romanceReady: boolean };

function CropPhoto({ file, busy, onCancel, onUpload }: { file: File; busy: boolean; onCancel: () => void; onUpload: (base64: string) => Promise<boolean> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => { setImage(next); setCenter({ x: next.naturalWidth / 2, y: next.naturalHeight / 2 }); setFailed(false); };
    next.onerror = () => setFailed(true);
    next.src = url;
    return () => { next.onload = null; next.onerror = null; URL.revokeObjectURL(url); };
  }, [file]);
  const width = image?.naturalWidth ?? 0, height = image?.naturalHeight ?? 0;
  const maxZoom = Math.max(1, Math.min(3, Math.min(width, height) / 320));
  const size = image ? Math.min(width, height) / zoom : 0;
  function clamp(x: number, y: number, side = size) {
    return { x: Math.max(side / 2, Math.min(width - side / 2, x)), y: Math.max(side / 2, Math.min(height - side / 2, y)) };
  }
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !image || !size) return;
    const point = clamp(center.x, center.y);
    context.clearRect(0, 0, 320, 320);
    context.drawImage(image, point.x - size / 2, point.y - size / 2, size, size, 0, 0, 320, 320);
  }, [image, zoom, center]);
  function move(dx: number, dy: number) { setCenter(current => clamp(current.x - dx * size / 320, current.y - dy * size / 320)); }
  function changeZoom(value: number) {
    const next = Math.max(1, Math.min(maxZoom, value));
    setZoom(next);
    setCenter(current => clamp(current.x, current.y, Math.min(width, height) / next));
  }
  async function submit() {
    if (!image || Math.min(width, height) < 320) return;
    const output = document.createElement('canvas');
    const side = Math.min(1200, Math.round(size));
    output.width = side; output.height = side;
    const context = output.getContext('2d');
    if (!context) return;
    const point = clamp(center.x, center.y);
    context.drawImage(image, point.x - size / 2, point.y - size / 2, size, size, 0, 0, side, side);
    await onUpload(output.toDataURL('image/jpeg', 0.88).split(',')[1] ?? '');
  }
  return <div className="date-crop-editor">
    <p>{t('dates.cropHint')}</p>
    <canvas ref={canvas} width={320} height={320} className="date-crop-canvas" role="img" aria-label={t('dates.cropPreview')} tabIndex={0}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY }; }}
      onPointerMove={event => { if (!drag.current) return; const scale = 320 / event.currentTarget.getBoundingClientRect().width; move((event.clientX - drag.current.x) * scale, (event.clientY - drag.current.y) * scale); drag.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => { const delta = 12; if (event.key === 'ArrowLeft') move(delta, 0); else if (event.key === 'ArrowRight') move(-delta, 0); else if (event.key === 'ArrowUp') move(0, delta); else if (event.key === 'ArrowDown') move(0, -delta); else return; event.preventDefault(); }} />
    {failed || image && Math.min(width, height) < 320 ? <p className="field-error" role="alert">{t('dates.cropInvalid')}</p> : null}
    <label>{t('dates.zoom')}<input type="range" min={1} max={maxZoom} step={0.01} value={zoom} disabled={!image || maxZoom <= 1 || busy} onChange={event => changeZoom(Number(event.target.value))} /></label>
    <div className="date-actions"><button type="button" className="pixel-button small" disabled={!image || Math.min(width, height) < 320 || busy} onClick={() => void submit()}>{t('dates.usePhoto')}</button><button type="button" className="text-button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button></div>
  </div>;
}

export function DatePreferences() {
  const [settings, setSettings] = useState<DateSettings | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { void api<{ settings: DateSettings }>('/dates/me/settings').then(result => setSettings(result.settings)).catch(setError); }, []);
  useEffect(() => {
    setPreview(null);
    if (!settings?.photoStatus) return;
    let active = true, url: string | null = null;
    void apiBlob('/dates/me/photo').then(blob => { if (!active) return; url = URL.createObjectURL(blob); setPreview(url); }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [settings?.photoStatus, previewVersion]);
  async function update(enabled: boolean, paused: boolean) {
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ settings: Pick<DateSettings, 'enabled' | 'paused' | 'revision'> }>('/dates/me/settings', { method: 'PUT', body: { enabled, paused, revision: settings.revision, consent: true } });
      setSettings({ ...settings, ...result.settings });
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  }
  async function upload(base64: string) {
    if (!settings) return false;
    setBusy(true); setError(null);
    try {
      const result = await api<{ photoStatus: DateSettings['photoStatus'] }>('/dates/me/photo', { method: 'PUT', body: { base64 } });
      setSettings({ ...settings, photoStatus: result.photoStatus });
      setPreviewVersion(value => value + 1);
      setFile(null);
      return true;
    } catch (reason) { setError(reason); return false; } finally { setBusy(false); }
  }
  async function remove() {
    if (!settings) return;
    setBusy(true); setError(null);
    try { await api('/dates/me/photo', { method: 'DELETE', body: {} }); setSettings({ ...settings, photoStatus: null }); setPreview(null); setFile(null); }
    catch (reason) { setError(reason); } finally { setBusy(false); }
  }
  return <div className="date-preferences" id="date-preferences">
    <h3>{t('dates.settings')}</h3>
    {!settings ? <p>{error ? errorText(error) : t('common.loading')}</p> : <>
      <p>{t('dates.consent')}</p>
      <div className="date-actions"><button type="button" className="outline-button small" disabled={busy || !settings.romanceReady} onClick={() => void update(!settings.enabled, false)}>{t(settings.enabled ? 'dates.disable' : 'dates.enable')}</button>{settings.enabled && <button type="button" className="text-button" disabled={busy} onClick={() => void update(true, !settings.paused)}>{t(settings.paused ? 'dates.resume' : 'dates.pause')}</button>}</div>
      {(settings.enabled || settings.photoStatus) && <div className="date-photo-settings"><h4>{t('dates.photo')}</h4><p>{t(settings.photoStatus ? `dates.photo.${settings.photoStatus}` : 'dates.photo.missing')}</p>
        {preview && <img className="date-own-photo" src={preview} alt={t('dates.ownPhoto')} />}
        {file && <CropPhoto file={file} busy={busy} onCancel={() => setFile(null)} onUpload={upload} />}
        {!file && (settings.storageAvailable ? <div className="date-actions"><label className="outline-button small date-file-button">{t(settings.photoStatus ? 'dates.replacePhoto' : 'dates.uploadPhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (!chosen) return; if (chosen.size > 4_000_000) { setError(new ApiError('PHOTO_INVALID')); return; } setError(null); setFile(chosen); }} /></label>
          {settings.photoStatus && <button type="button" className="text-button" disabled={busy} onClick={() => void remove()}>{t('dates.deletePhoto')}</button>}</div>
          : <p className="field-hint">{t('dates.storageUnavailable')}</p>)}
      </div>}
    </>}
    {!!error && !!settings && <p className="field-error" role="alert">{errorText(error)}</p>}
  </div>;
}
