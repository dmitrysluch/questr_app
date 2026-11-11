import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, Globe2, Heart, Leaf, LoaderCircle, LockKeyhole, MessageCircle, PenLine, ShieldCheck, Shuffle } from 'lucide-react';
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
const steps: { id: 'welcome' | Draft['currentStep']; label: TranslationKey; sub: TranslationKey }[] = [
  { id: 'welcome', label: 'steps.welcome', sub: 'steps.welcomeSub' },
  { id: 'avatar', label: 'steps.avatar', sub: 'steps.avatarSub' },
  { id: 'bio', label: 'steps.bio', sub: 'steps.bioSub' },
  { id: 'review', label: 'steps.review', sub: 'steps.reviewSub' },
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
      <span className="header-tagline">{t('brand.tagline')}</span><div className="header-right">{config?.authMode === 'demo' && <span className="preview-badge">{t('app.demo')}</span>}<span className="language"><Globe2 size={15} />{t('nav.language')}</span></div>
    </header>
    <div className="workspace">
      <aside className="sidebar"><div><p className="eyebrow">{t('steps.eyebrow')}</p><nav aria-label={t('steps.eyebrow')}>
        {steps.map((step, index) => {
          const done = showProfile || index < stepIndex;
          const active = !showProfile && currentStep === step.id;
          return <button key={step.id} className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`} disabled={step.id === 'welcome' || !draft || busy || (step.id !== 'avatar' && !draft.avatarId)}
            aria-label={t(step.label)} aria-current={active ? 'step' : undefined} onClick={() => { if (step.id !== 'welcome') void go(step.id); }}>
            <span className="step-number">{done ? <Check size={15} strokeWidth={2.5} /> : `0${index + 1}`}</span><span className="step-copy"><strong>{t(step.label)}</strong><small>{t(step.sub)}</small></span>{active && <ChevronRight className="step-chevron" size={16} />}
          </button>;
        })}
      </nav></div>
      <div className="sidebar-note"><img src="/art/coffee-break.svg" alt="" /><h3>{t('side.title')}</h3><p>{t('side.body')}</p><div className="note-divider" /><p className="sidebar-whisper">{t('side.note')}</p></div>
      <div className="sidebar-bottom"><span className="tiny-flower">✳</span>{t('brand.pilot')}<span>001</span></div>
      </aside>
      <main className={`main-content ${currentStep === 'welcome' ? 'welcome-content' : ''}`}>
        {!!visibleError && <div className="error-banner" role="alert"><span>{errorText(visibleError)}</span>
          <button className="text-button" onClick={() => void run(async () => { if (conflict || !state) await loadState(); else await flush(); })}>{t(conflict ? 'common.reload' : 'common.retry')}</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /><p>{t('common.loading')}</p></div> : telegramNeeded ? <div className="interview-intro"><MessageCircle size={40} /><h1>{t('welcome.telegram')}</h1><a className="pixel-button" href="https://t.me/questr_game">{t('welcome.openBot')}<ArrowRight size={18} /></a></div> : !state ? null : !draft ? <section className="welcome-layout">
          <div className="welcome-copy"><p className="eyebrow"><span className="tiny-flower">✳</span>{t('welcome.eyebrow')}</p><h1>{t('welcome.title')}</h1><p className="lead">{t('welcome.description')}</p>
            <div className="welcome-characters"><Character id="moss" /><Character id="maple" /><Character id="dusk" /><span className="welcome-star">✦</span></div>
            <p className="welcome-footnote"><Leaf size={16} />{t('welcome.footnote')}</p>
          </div>
          <form className="welcome-form paper-card" onSubmit={event => void register(event)}><span className="card-corner" /><h2>{t('welcome.formTitle')}</h2>
            <label htmlFor="name">{t('welcome.name')}</label><input id="name" autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} placeholder={t('welcome.namePlaceholder')} minLength={2} maxLength={40} required />
            <p className="hint">{t('welcome.nameHint')}</p>
            <label htmlFor="invite">{t('welcome.invite')}</label><input id="invite" value={invite} onChange={e => setInvite(e.target.value)} placeholder={t('welcome.invitePlaceholder')} autoCapitalize="none" autoComplete="off" spellCheck={false} required />
            {config?.authMode === 'demo' && <p className="hint">{t('welcome.demoInvite')}</p>}
            <div className="consents"><label className="checkbox-label"><input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} required /><span>{t('welcome.adult')}</span></label>
              <label className="checkbox-label"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} required /><span>{t('welcome.terms')}</span></label><button type="button" className="text-button terms-link" onClick={() => setTermsOpen(true)}>{t('welcome.readTerms')}</button></div>
            <button type="submit" className="pixel-button full-width" disabled={busy}>{t('welcome.start')}{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}</button>
            <p className="form-privacy"><LockKeyhole size={13} />{t('footer.private')}</p>
          </form>
        </section> : showProfile && state.profile ? <section>
          <PageHeading eyebrow="profile.badge" title="profile.title" description="profile.description" />
          <ProfileCard profile={state.profile} />
          <div className="profile-next"><span className="pixel-spark" /><div><h3>{t('profile.nextTitle')}</h3><p>{t('profile.nextBody')}</p></div></div>
          <div className="page-actions"><span className="privacy-note"><LockKeyhole size={14} />{t('review.private')}</span><button className="pixel-button" onClick={() => void go('bio')} disabled={busy}><PenLine size={16} />{t('profile.edit')}</button></div>
        </section> : currentStep === 'avatar' ? <section>
          <PageHeading eyebrow="avatar.eyebrow" title="avatar.title" description="avatar.description" />
          <div className="avatar-layout">
            <div className="character-stage"><div className="stage-label">{t('avatar.selected')}</div><span className="stage-star star-one">✦</span><span className="stage-star star-two">✧</span><Character id={draft.avatarId} className="hero-character" /><span className="character-shadow" />
              <button className="character-name" onClick={() => { setNextName(draft.displayName); setEditingName(true); }} aria-label={t('avatar.changeName')}><h2>{draft.displayName}</h2><PenLine size={13} /></button><span className="stage-subtitle">{selectedAvatar?.name ?? avatars[0].name}</span>
              <button className="text-button" onClick={() => edit({ avatarId: avatars.filter(a => a.id !== draft.avatarId)[Math.floor(Math.random() * 11)].id })}><Shuffle size={14} />{t('avatar.random')}</button>
            </div>
            <div className="avatar-selection"><h2>{t('avatar.galleryTitle')}</h2><p className="hint">{t('avatar.galleryHint')}</p><div className="avatar-grid" role="group" aria-label={t('avatar.galleryTitle')}>
              {avatars.map(avatar => <button key={avatar.id} className={`avatar-choice ${draft.avatarId === avatar.id ? 'selected' : ''}`} aria-label={t('avatar.choose', { name: avatar.name })} aria-pressed={draft.avatarId === avatar.id} onClick={() => edit({ avatarId: avatar.id })}>
                <Character id={avatar.id} /><span>{avatar.name}</span>{draft.avatarId === avatar.id && <span className="avatar-check"><Check size={12} strokeWidth={3} /></span>}
              </button>)}
            </div><p className="avatar-note"><ShieldCheck size={15} />{t('avatar.note')}</p></div>
          </div>
          <div className="page-actions"><SaveStatus state={saveState} /><button className="pixel-button" disabled={!draft.avatarId || busy} onClick={() => void go('bio')}>{t('avatar.next')}<ArrowRight size={17} /></button></div>
        </section> : currentStep === 'bio' ? <section>
          <PageHeading eyebrow="bio.eyebrow" title="bio.title" description="bio.description" />
          <div className="bio-layout"><div className="bio-main">
            <div className="section-heading"><h2>{t('bio.tagsTitle')}</h2><span>{t('common.optional')}</span></div><p className="hint section-hint">{t('bio.tagsHint')}</p>
            <TagPicker value={draft.tags} onChange={tags => edit({ tags })} />
            <div className="story-heading"><h2>{t('bio.storyTitle')}</h2><p className="hint">{t('bio.storyHint')}</p></div>
            <p className="hint content-disclosure">{t(config?.aiMode === 'openrouter' ? 'content.disclosure' : 'content.demoDisclosure')}</p>
            {draft && <ContentWarning text={draft.introMarkdown} review={currentReview} />}
            <div className="editor-card"><div className="writing-tabs" role="tablist" aria-label={t('bio.storyTitle')}>
              <button role="tab" aria-selected={draft.mode === 'manual'} aria-controls="writing-panel" className={draft.mode === 'manual' ? 'active' : ''} onClick={() => edit({ mode: 'manual' })}><PenLine size={16} />{t('bio.write')}</button>
              <button role="tab" aria-selected={draft.mode === 'interview'} aria-controls="writing-panel" className={draft.mode === 'interview' ? 'active' : ''} onClick={() => edit({ mode: 'interview' })}><MessageCircle size={16} />{t('bio.ask')}<span className="tab-star">✦</span></button>
            </div><div id="writing-panel" role="tabpanel">
              {draft.mode === 'manual' ? <><Suspense fallback={<div className="editor-loading"><LoaderCircle size={20} className="spin" /></div>}><BioEditor value={draft.introMarkdown} flagged={currentReview?.spans} onChange={introMarkdown => edit({ introMarkdown })} /></Suspense><div className="editor-footer"><span>{t('bio.editorHint')}</span><span>{t('bio.words', { count: wordCount })}</span></div></> : config && <Interview config={config} conversation={state.conversation} proposal={state.proposal} onBioReview={setBioReview}
                hasBio={Boolean(draft.introMarkdown.trim())} onConversation={conversation => setState(old => old ? { ...old, conversation } : old)} onProposal={proposal => setState(old => old ? { ...old, proposal } : old)} flush={flush}
                onApply={nextDraft => { replace(nextDraft); edit({ mode: 'manual' }); }} />}
            </div></div>
            <div className="story-footnote"><Leaf size={15} /><span>{t(draft.mode === 'manual' ? 'bio.emptyOkay' : 'assistant.private')}</span></div>
          </div><aside className="mini-profile"><p className="eyebrow">{t('preview.label')}</p><Character id={draft.avatarId} /><h3>{draft.displayName}</h3>{draft.tags.length ? <TagPills items={draft.tags.slice(0, 5)} /> : <p>{t('preview.empty')}</p>}<div className="mini-profile-divider" /><p className="mini-note">{t('side.note')}</p><span className="mini-spark">✳</span></aside></div>
          <div className="page-actions"><button className="text-button" onClick={() => void go('avatar')} disabled={busy}><ArrowLeft size={16} />{t('common.back')}</button><div className="action-right"><SaveStatus state={saveState} /><button className="pixel-button" disabled={busy} onClick={() => void go('review')}>{t(checkingBio ? 'content.checking' : 'bio.preview')}<ArrowRight size={17} /></button></div></div>
        </section> : <section>
          <PageHeading eyebrow="review.eyebrow" title="review.title" description="review.description" />
          <ContentWarning text={draft.introMarkdown} review={currentReview} />
          <ProfileCard profile={{ ...draft, avatarId: draft.avatarId!, completedAt: '' }} flagged={currentReview?.spans} />
          <div className="page-actions"><button className="text-button" disabled={busy} onClick={() => void go('bio')}><ArrowLeft size={16} />{t('review.edit')}</button><button className="pixel-button" disabled={busy} onClick={() => void publish()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{t(checkingBio ? 'content.checking' : 'review.finish')}</button></div>
          <p className="review-privacy"><LockKeyhole size={13} />{t('review.private')}</p>
        </section>}
      </main>
    </div>
    <footer className="site-footer"><span>QUESTR © {new Date().getFullYear()}</span><span><Heart size={12} />{t('footer.copy')}</span></footer>
    {editingName && <Modal title={t('avatar.changeName')} onClose={() => setEditingName(false)}><form onSubmit={event => { event.preventDefault(); if (nextName.trim().length >= 2) { edit({ displayName: nextName.trim() }); setEditingName(false); } }}><label htmlFor="display-name">{t('welcome.name')}</label><input id="display-name" value={nextName} onChange={e => setNextName(e.target.value)} minLength={2} maxLength={40} required autoFocus /><div className="modal-actions"><button className="pixel-button small" type="submit">{t('avatar.saveName')}<Check size={15} /></button></div></form></Modal>}
    {termsOpen && <Modal title={t('terms.title')} onClose={() => setTermsOpen(false)}><div className="terms-body"><p>{t('terms.intro')}</p><ul><li>{t('terms.respect')}</li><li>{t('terms.identity')}</li><li>{t('terms.profile')}</li></ul><p>{t('terms.poc')}</p></div><div className="modal-actions"><button className="pixel-button small" onClick={() => setTermsOpen(false)}>{t('common.close')}</button></div></Modal>}
  </div>;
}
function PageHeading({ eyebrow, title, description }: { eyebrow: TranslationKey; title: TranslationKey; description: TranslationKey }) {
  return <div className="page-heading"><p className="eyebrow"><span className="tiny-flower">✳</span>{t(eyebrow)}</p><h1>{t(title)}</h1><p className="lead">{t(description)}</p></div>;
}
function SaveStatus({ state }: { state: 'saved' | 'saving' | 'error' }) {
  return <span className={`save-status ${state}`} role="status">{state === 'saving' ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={15} />}{t(state === 'saving' ? 'common.saving' : state === 'error' ? 'common.unsaved' : 'common.saved')}</span>;
}
function ProfileCard({ profile, flagged }: { profile: Profile; flagged?: ContentSpan[] }) {
  return <article className="profile-card paper-card"><div className="profile-banner"><span className="pixel-spark" /><span>{t('profile.badge')}</span><span className="banner-stars">✧ · ✦</span></div>
    <div className="profile-identity"><Character id={profile.avatarId} /><div><span className="profile-hello">{t('nav.profile')}</span><h2 dir="auto">{profile.displayName}</h2>{profile.tags.length ? <TagPills items={profile.tags} /> : <p className="hint">{t('profile.noTags')}</p>}</div></div>
    <div className="profile-body">{profile.introMarkdown.trim() ? <Markdown content={profile.introMarkdown} flagged={flagged} /> : <div className="empty-bio"><PenLine size={22} /><p>{t('profile.noBio')}</p></div>}</div>
    <div className="profile-card-footer"><span className="tiny-flower">✳</span><span>{t('brand.tagline')}</span><span className="profile-brand">QUESTR</span></div>
  </article>;
}
