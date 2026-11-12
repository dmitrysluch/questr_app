import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, LoaderCircle, LockKeyhole, MessageCircle, PenLine, Shuffle } from 'lucide-react';
import type { AppConfig, AppState, Draft, Profile } from '../shared/schema.ts';
import { avatars } from '../shared/catalog.ts';
import { api, ApiError } from './api.ts';
import { errorText, t, type TranslationKey } from './i18n.ts';
import { useDraft } from './useDraft.ts';
import { Character } from './components/Character.tsx';
import { TagPicker, TagPills } from './components/Tags.tsx';
import { Markdown } from './components/Markdown.tsx';
import { Modal } from './components/Modal.tsx';
import { Interview } from './components/Interview.tsx';
import { ContentWarning } from './components/ContentReview.tsx';
import type { BioReview, ContentSpan } from '../shared/content-policy.ts';

const BioEditor = lazy(() => import('./components/BioEditor.tsx'));
declare global {
  interface Window { Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void } } }
}
const steps: { id: Draft['currentStep']; label: TranslationKey }[] = [
  { id: 'avatar', label: 'steps.avatar' },
  { id: 'bio', label: 'steps.bio' },
  { id: 'review', label: 'steps.review' },
];

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checkingBio, setCheckingBio] = useState(false);
  const [bioReview, setBioReview] = useState<BioReview | null>(null);
  const [telegramNeeded, setTelegramNeeded] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nextName, setNextName] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const { draft, edit, replace, flush, saveState, saveError } = useDraft();
  const loadState = useCallback(async () => {
    const next = await api<AppState>('/me');
    setState(next); replace(next.draft);
    setBioReview(next.bioReview);
    setShowProfile(next.user.status === 'active');
    setInvite(next.demoInvite ?? '');
    return next;
  }, [replace]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await api<AppConfig>('/config');
        if (!active) return;
        setConfig(next);
        if (next.authMode === 'demo') await api('/auth/demo', { method: 'POST', body: {} });
        else {
          let telegram = window.Telegram?.WebApp;
          // The official SDK is loaded asynchronously; allow a short initial load.
          for (let i = 0; !telegram && i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            telegram = window.Telegram?.WebApp;
          }
          if (!telegram?.initData) { setTelegramNeeded(true); return; }
          telegram.ready(); telegram.expand();
          telegram.setHeaderColor?.('#f5f0e7'); telegram.setBackgroundColor?.('#f5f0e7');
          await api('/auth/telegram', { method: 'POST', body: { initData: telegram.initData } });
        }
        if (active) await loadState();
      } catch (e) { if (active) setError(e); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [loadState]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function register(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api<{ draft: Draft }>('/register', { method: 'POST', body: { displayName: name, invite, adult, terms, locale: 'en' } });
      replace(result.draft);
      setState(old => old ? { ...old, user: { ...old.user, status: 'onboarding' }, draft: result.draft } : old);
    });
  }
  async function go(step: Draft['currentStep']) {
    if (!draft || busy) return;
    if (step !== 'avatar' && !draft.avatarId) { setError(new ApiError('AVATAR_REQUIRED')); return; }
    await run(async () => {
      if (step === 'review') {
        setCheckingBio(true);
        try {
          const saved = await flush();
          const result = await api<{ bioReview: BioReview }>('/draft/validate', { method: 'POST', body: { revision: saved?.revision } });
          setBioReview(result.bioReview);
          if (result.bioReview.status === 'blocked') {
            edit({ currentStep: 'bio', mode: 'manual' }); await flush(); setShowProfile(false); return;
          }
        } finally { setCheckingBio(false); }
      }
      edit({ currentStep: step }); await flush(); setShowProfile(false); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  async function publish() {
    await run(async () => {
      const saved = await flush();
      setCheckingBio(true);
      let result: { profile: Profile };
      try { result = await api<{ profile: Profile }>('/profile/publish', { method: 'POST', body: { revision: saved?.revision } }); }
      catch (e) {
        if (e instanceof ApiError && e.code === 'CONTENT_REQUIRES_CHANGES') setBioReview((e.details as { bioReview: BioReview }).bioReview);
        throw e;
      } finally { setCheckingBio(false); }
      setState(old => old ? { ...old, profile: result.profile, user: { ...old.user, status: 'active' } } : old);
      setShowProfile(true); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  const currentStep = draft?.currentStep ?? 'welcome';
  const stepIndex = steps.findIndex(s => s.id === currentStep);
  const visibleError = error ?? saveError;
  const conflict = visibleError instanceof ApiError && visibleError.code === 'DRAFT_CONFLICT';
  const selectedAvatar = avatars.find(a => a.id === draft?.avatarId);
  const wordCount = draft?.introMarkdown.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const currentReview = bioReview?.introMarkdown === draft?.introMarkdown ? bioReview : null;

  return <div className="app-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="QUESTR"><span className="pixel-spark" />QUESTR<span className="wordmark-dot">.</span></a>
      <div className="header-right">{config?.authMode === 'demo' && <span className="preview-badge">{t('app.demo')}</span>}<button className="text-button" onClick={() => setTermsOpen(true)}>{t('welcome.readTerms')}</button></div>
    </header>
    <div className="workspace">
      {draft && !showProfile && <nav className="step-bar" aria-label={t('steps.eyebrow')}>
        {steps.map((step, index) => <button key={step.id} className={`step ${currentStep === step.id ? 'active' : ''} ${index < stepIndex ? 'done' : ''}`}
          disabled={busy || (step.id !== 'avatar' && !draft.avatarId)} aria-current={currentStep === step.id ? 'step' : undefined} onClick={() => void go(step.id)}>
          <span className="step-number">{index < stepIndex ? <Check size={13} /> : index + 1}</span><span>{t(step.label)}</span>
        </button>)}
      </nav>}
      <main className={`main-content ${currentStep === 'welcome' ? 'welcome-content' : ''}`}>
        {!!visibleError && <div className="error-banner" role="alert"><span>{errorText(visibleError)}</span>
          <button className="text-button" onClick={() => void run(async () => { if (conflict || !state) await loadState(); else await flush(); })}>{t(conflict ? 'common.reload' : 'common.retry')}</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /><p>{t('common.loading')}</p></div> : telegramNeeded ? <div className="interview-intro"><MessageCircle size={40} /><h1>{t('welcome.telegram')}</h1><a className="pixel-button" href="https://t.me/questr_game">{t('welcome.openBot')}<ArrowRight size={18} /></a></div> : !state ? null : !draft ? <section className="welcome-layout">
          <PageHeading title="welcome.title" />
          <form className="welcome-form paper-card" onSubmit={event => void register(event)}><span className="card-corner" />
            <label htmlFor="name">{t('welcome.name')}</label><input id="name" autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} placeholder={t('welcome.namePlaceholder')} minLength={2} maxLength={40} required />
            <label htmlFor="invite">{t('welcome.invite')}</label><input id="invite" value={invite} onChange={e => setInvite(e.target.value)} placeholder={t('welcome.invitePlaceholder')} autoCapitalize="none" autoComplete="off" spellCheck={false} required />
            <div className="consents"><label className="checkbox-label"><input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} required /><span>{t('welcome.adult')}</span></label>
              <label className="checkbox-label"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} required /><span>{t('welcome.terms')}</span></label><button type="button" className="text-button terms-link" onClick={() => setTermsOpen(true)}>{t('welcome.readTerms')}</button></div>
            <button type="submit" className="pixel-button full-width" disabled={busy}>{t('welcome.start')}{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}</button>
            <p className="form-privacy"><LockKeyhole size={13} />{t('footer.private')}</p>
          </form>
        </section> : showProfile && state.profile ? <section>
          <PageHeading title="profile.title" />
          <ProfileCard profile={state.profile} />

          <div className="page-actions"><span className="privacy-note"><LockKeyhole size={14} />{t('review.private')}</span><button className="pixel-button" onClick={() => void go('bio')} disabled={busy}><PenLine size={16} />{t('profile.edit')}</button></div>
        </section> : currentStep === 'avatar' ? <section>
          <PageHeading title="avatar.title" />
          <div className="avatar-layout">
            <div className="character-stage"><span className="stage-star star-one">✦</span><span className="stage-star star-two">✧</span><Character id={draft.avatarId} className="hero-character" /><span className="character-shadow" />
              <button className="character-name" onClick={() => { setNextName(draft.displayName); setEditingName(true); }} aria-label={t('avatar.changeName')}><h2>{draft.displayName}</h2><PenLine size={13} /></button><span className="stage-subtitle">{selectedAvatar?.name ?? avatars[0].name}</span>
              <button className="text-button" onClick={() => edit({ avatarId: avatars.filter(a => a.id !== draft.avatarId)[Math.floor(Math.random() * 11)].id })}><Shuffle size={14} />{t('avatar.random')}</button>
            </div>
            <div className="avatar-selection"><h2>{t('avatar.galleryTitle')}</h2><div className="avatar-grid" role="group" aria-label={t('avatar.galleryTitle')}>
              {avatars.map(avatar => <button key={avatar.id} className={`avatar-choice ${draft.avatarId === avatar.id ? 'selected' : ''}`} aria-label={t('avatar.choose', { name: avatar.name })} aria-pressed={draft.avatarId === avatar.id} onClick={() => edit({ avatarId: avatar.id })}>
                <Character id={avatar.id} /><span>{avatar.name}</span>{draft.avatarId === avatar.id && <span className="avatar-check"><Check size={12} strokeWidth={3} /></span>}
              </button>)}
            </div></div>
          </div>
          <div className="page-actions"><SaveStatus state={saveState} /><button className="pixel-button" disabled={!draft.avatarId || busy} onClick={() => void go('bio')}>{t('avatar.next')}<ArrowRight size={17} /></button></div>
        </section> : currentStep === 'bio' ? <section>
          <PageHeading title="bio.title" />
          <div className="bio-layout"><div className="bio-main">
            <div className="section-heading"><h2>{t('bio.tagsTitle')}</h2><span>{t('common.optional')}</span></div>
            <TagPicker value={draft.tags} onChange={tags => edit({ tags })} />
            <div className="story-heading"><h2>{t('bio.storyTitle')}</h2></div>
            {draft && <ContentWarning text={draft.introMarkdown} review={currentReview} />}
            <div className="editor-card"><div className="writing-tabs" role="tablist" aria-label={t('bio.storyTitle')}>
              <button role="tab" aria-selected={draft.mode === 'manual'} aria-controls="writing-panel" className={draft.mode === 'manual' ? 'active' : ''} onClick={() => edit({ mode: 'manual' })}><PenLine size={16} />{t('bio.write')}</button>
              <button role="tab" aria-selected={draft.mode === 'interview'} aria-controls="writing-panel" className={draft.mode === 'interview' ? 'active' : ''} onClick={() => edit({ mode: 'interview' })}><MessageCircle size={16} />{t('bio.ask')}<span className="tab-star">✦</span></button>
            </div><div id="writing-panel" role="tabpanel">
              {draft.mode === 'manual' ? <><Suspense fallback={<div className="editor-loading"><LoaderCircle size={20} className="spin" /></div>}><BioEditor value={draft.introMarkdown} flagged={currentReview?.spans} onChange={introMarkdown => edit({ introMarkdown })} /></Suspense><div className="editor-footer"><span>{t('bio.words', { count: wordCount })}</span></div></> : config && <Interview config={config} conversation={state.conversation} proposal={state.proposal} onBioReview={setBioReview}
                hasBio={Boolean(draft.introMarkdown.trim())} onConversation={conversation => setState(old => old ? { ...old, conversation } : old)} onProposal={proposal => setState(old => old ? { ...old, proposal } : old)} flush={flush}
                onApply={nextDraft => { replace(nextDraft); edit({ mode: 'manual' }); }} />}
            </div></div>
            <details className="bio-disclosure"><summary>{t('content.howUsed')}</summary><p>{t(config?.aiMode === 'openrouter' ? 'content.disclosure' : 'content.demoDisclosure')}</p></details>
          </div></div>
          <div className="page-actions"><button className="text-button" onClick={() => void go('avatar')} disabled={busy}><ArrowLeft size={16} />{t('common.back')}</button><div className="action-right"><SaveStatus state={saveState} /><button className="pixel-button" disabled={busy} onClick={() => void go('review')}>{t(checkingBio ? 'content.checking' : 'bio.preview')}<ArrowRight size={17} /></button></div></div>
        </section> : <section>
          <PageHeading title="review.title" />
          <ContentWarning text={draft.introMarkdown} review={currentReview} />
          <ProfileCard profile={{ ...draft, avatarId: draft.avatarId!, completedAt: '' }} flagged={currentReview?.spans} />
          <div className="page-actions"><button className="text-button" disabled={busy} onClick={() => void go('bio')}><ArrowLeft size={16} />{t('review.edit')}</button><button className="pixel-button" disabled={busy} onClick={() => void publish()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{t(checkingBio ? 'content.checking' : 'review.finish')}</button></div>
          <p className="review-privacy"><LockKeyhole size={13} />{t('review.private')}</p>
        </section>}
      </main>
    </div>

    {editingName && <Modal title={t('avatar.changeName')} onClose={() => setEditingName(false)}><form onSubmit={event => { event.preventDefault(); if (nextName.trim().length >= 2) { edit({ displayName: nextName.trim() }); setEditingName(false); } }}><label htmlFor="display-name">{t('welcome.name')}</label><input id="display-name" value={nextName} onChange={e => setNextName(e.target.value)} minLength={2} maxLength={40} required autoFocus /><div className="modal-actions"><button className="pixel-button small" type="submit">{t('avatar.saveName')}<Check size={15} /></button></div></form></Modal>}
    {termsOpen && <Modal title={t('terms.title')} onClose={() => setTermsOpen(false)}><div className="terms-body"><p>{t('terms.intro')}</p><ul><li>{t('terms.respect')}</li><li>{t('terms.identity')}</li><li>{t('terms.profile')}</li></ul><p>{t('terms.poc')}</p></div><div className="modal-actions"><button className="pixel-button small" onClick={() => setTermsOpen(false)}>{t('common.close')}</button></div></Modal>}
  </div>;
}
function PageHeading({ title }: { title: TranslationKey }) {
  return <div className="page-heading"><h1>{t(title)}</h1></div>;
}
function SaveStatus({ state }: { state: 'saved' | 'saving' | 'error' }) {
  return <span className={`save-status ${state}`} role="status">{state === 'saving' ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={15} />}{t(state === 'saving' ? 'common.saving' : state === 'error' ? 'common.unsaved' : 'common.saved')}</span>;
}
function ProfileCard({ profile, flagged }: { profile: Profile; flagged?: ContentSpan[] }) {
  return <article className="profile-card paper-card"><div className="profile-banner"><span className="pixel-spark" /><span>{t('profile.badge')}</span><span className="banner-stars">✧ · ✦</span></div>
    <div className="profile-identity"><Character id={profile.avatarId} /><div><h2 dir="auto">{profile.displayName}</h2>{!!profile.tags.length && <TagPills items={profile.tags} />}</div></div>
    <div className="profile-body">{profile.introMarkdown.trim() ? <Markdown content={profile.introMarkdown} flagged={flagged} /> : <div className="empty-bio"><PenLine size={22} /><p>{t('profile.noBio')}</p></div>}</div>

  </article>;
}
