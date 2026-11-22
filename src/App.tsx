import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, LoaderCircle, LockKeyhole, MessageCircle, PenLine, Shuffle } from 'lucide-react';
import type { AppConfig, AppState, Draft, Profile } from '../shared/schema.ts';
import { avatars } from '../shared/catalog.ts';
import { appearanceForPreset, isPresetAppearance } from '../shared/avatar.ts';
import { preferredLocale, type Locale } from '../shared/locale.ts';
import { api, ApiError, setTelegramSession } from './api.ts';
import { errorText, getLocale, setLocale, t, type TranslationKey } from './i18n.ts';
import { useDraft } from './useDraft.ts';
import { Character } from './components/Character.tsx';
import { AvatarBuilder } from './components/AvatarBuilder.tsx';
import { TagPicker } from './components/Tags.tsx';
import { ProfileCard } from './components/ProfileCard.tsx';
import { Adventures } from './components/Adventures.tsx';
import { EventListings } from './components/EventListings.tsx';
import { AdminEventListings } from './components/AdminEventListings.tsx';
import { Dates } from './components/Dates.tsx';
import { Modal } from './components/Modal.tsx';
import { Interview } from './components/Interview.tsx';
import { AskMeTopics } from './components/AskMeTopics.tsx';
import { Invites } from './components/Invites.tsx';
import { AdminCommunities } from './components/AdminCommunities.tsx';
import { InviteRedeemer } from './components/InviteRedeemer.tsx';
import { EmailInvite } from './components/EmailInvite.tsx';
import { ContentWarning } from './components/ContentReview.tsx';
import { RomanceSettings } from './components/RomanceSettings.tsx';
import { AdminProfile } from './components/AdminProfile.tsx';
import { LanguagePicker, DiscoverySettings } from './components/Discovery.tsx';
import type { BioReview } from '../shared/content-policy.ts';
import type { DiscoveryPreferences } from '../shared/discovery.ts';
import { parseCommunities, type Community } from '../shared/communities.ts';
import { CommunityCatalog } from './community-catalog.tsx';
import { initAnalytics, syncAnalyticsIdentity, track } from './analytics.ts';

const BioEditor = lazy(() => import('./components/BioEditor.tsx'));
const sharedInviteCode = (() => {
  const value = new URLSearchParams(location.search).get('tgWebAppStartParam');
  return value && /^QUEST-[A-Za-z0-9_-]{24}$/.test(value) ? value : null;
})();
declare global {
  interface Window { Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void; openTelegramLink?: (url: string) => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void } } }
}
const steps: { id: Draft['currentStep']; label: TranslationKey }[] = [
  { id: 'avatar', label: 'steps.avatar' },
  { id: 'bio', label: 'steps.bio' },
  { id: 'discovery', label: 'steps.discovery' },
  { id: 'review', label: 'steps.review' },
];

export function App() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const change = () => setRoute(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [locale, setInterfaceLocale] = useState<Locale>(getLocale());
  const [state, setState] = useState<AppState | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checkingBio, setCheckingBio] = useState(false);
  const [bioReview, setBioReview] = useState<BioReview | null>(null);
  const [discoveryDirty, setDiscoveryDirty] = useState(false);
  const [discoveryPending, setDiscoveryPending] = useState<DiscoveryPreferences | null>(null);
  const [exitTarget, setExitTarget] = useState<'character' | 'adventures' | 'dates' | 'invites' | 'communities' | 'admin-listings' | null>(null);
  const [telegramNeeded, setTelegramNeeded] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  useEffect(() => {
    if (route !== '#character/dates' || !showProfile) return;
    const frame = requestAnimationFrame(() => (document.getElementById('date-preferences')
      ?? document.getElementById('romance-title'))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [route, showProfile]);
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
    const savedLocale = preferredLocale(next.user.locale);
    setLocale(savedLocale); setInterfaceLocale(savedLocale);
    setState(next); replace(next.draft);
    syncAnalyticsIdentity(next.user.status === 'pending_invite' ? null : next.user.id);
    setBioReview(next.bioReview);
    setShowProfile(next.user.status === 'active');
    setInvite(sharedInviteCode ?? next.demoInvite ?? '');
    return next;
  }, [replace]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await api<AppConfig>('/config');
        if (!active) return;
        setConfig(next);
        await initAnalytics(next.posthogProjectKey);
        if (!active) return;
        const browserLanguage = navigator.languages?.[0] ?? navigator.language;
        setTelegramSession(null);
        if (next.authMode === 'demo') await api('/auth/demo', { method: 'POST', body: { browserLanguage } });
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
          const auth = await api<{ sessionToken?: string }>('/auth/telegram', { method: 'POST', body: { initData: telegram.initData, browserLanguage } });
          if (auth.sessionToken) setTelegramSession(auth.sessionToken);
        }
        if (active) {
          const target = new URLSearchParams(location.search).get('route');
          if (target && (/^adventures\/[0-9a-f-]{36}(?:\/character\/[0-9a-f-]{36})?$/i.test(target) || /^listings\/[0-9a-f-]{36}$/i.test(target) || /^dates\/[0-9a-f-]{36}(?:\/rounds\/[0-9a-f-]{36})?$/i.test(target))) location.hash = target;
          const [catalog, loadedState] = await Promise.all([api<{ communities: Community[] }>('/communities'), loadState()]);
          if (sharedInviteCode && loadedState.user.status === 'active' && !target) location.hash = 'character';
          if (active) setCommunities(parseCommunities(catalog));
        }
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
      const result = await api<{ draft: Draft }>('/register', { method: 'POST', body: { displayName: name, invite: invite.trim() || undefined, adult, terms, locale } });
      track('registration_completed');
      syncAnalyticsIdentity(state?.user.id ?? null);
      replace(result.draft);
      setState(old => old ? { ...old, user: { ...old.user, status: 'onboarding' }, draft: result.draft } : old);
    });
  }
  async function changeLocale(next: Locale) {
    if (next === locale) return;
    await run(async () => {
      await api('/locale', { method: 'PUT', body: { locale: next } });
      setLocale(next); setInterfaceLocale(next);
      setState(old => old ? { ...old, user: { ...old.user, locale: next } } : old);
    });
  }
  function navigate(target: 'character' | 'adventures' | 'dates' | 'invites' | 'communities' | 'admin-listings') {
    if (busy) return;
    if (state?.user.status === 'active' && !showProfile && discoveryDirty && discoveryPending) { setExitTarget(target); return; }
    void finishExit(target, false);
  }
  async function finishExit(target: 'character' | 'adventures' | 'dates' | 'invites' | 'communities' | 'admin-listings', saveFilters: boolean) {
    await run(async () => {
      await flush();
      if (saveFilters && discoveryPending) {
        const result = await api<{ discovery: DiscoveryPreferences }>('/discovery', { method: 'PUT', body: discoveryPending });
        setState(old => old ? { ...old, discovery: result.discovery } : old);
      }
      setExitTarget(null); setDiscoveryDirty(false); setDiscoveryPending(null); setShowProfile(true);
      location.hash = target;
    });
  }
  async function go(step: Draft['currentStep']) {
    if (!draft || busy) return;
    if (step !== 'avatar' && !draft.avatarId) { setError(new ApiError('AVATAR_REQUIRED')); return; }
    const leavingUnsavedFilters = discoveryDirty && discoveryPending !== null && step !== 'bio' && step !== 'discovery';
    const missingRequiredFilters = step === 'review' && !state?.profile && (!state?.discovery.locationIds.length || !state?.discovery.languageCodes.length);
    if (leavingUnsavedFilters || missingRequiredFilters) {
      edit({ currentStep: 'discovery' });
      setError(new ApiError(leavingUnsavedFilters ? 'DISCOVERY_UNSAVED' : 'DISCOVERY_REQUIRED'));
      requestAnimationFrame(() => document.getElementById('onboarding-discovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    await run(async () => {
      if (step === 'review') {
        setCheckingBio(true);
        try {
          const saved = await flush();
          const result = await api<{ bioReview: BioReview }>('/draft/validate', { method: 'POST', body: { revision: saved?.revision } });
          setBioReview(result.bioReview);
          if (result.bioReview.status === 'blocked' || result.bioReview.topicReviews?.some(review => review.status === 'blocked')) {
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
      track('profile_published', { first_publish: !state?.profile, has_intro: Boolean(result.profile.introMarkdown.trim()), tag_count: result.profile.tags.length, ask_me_count: result.profile.askMeTopics.length, language_count: result.profile.spokenLanguages.length });
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
  const currentTopicReviews = currentReview && JSON.stringify(currentReview.askMeTopics) === JSON.stringify(draft?.askMeTopics) ? currentReview.topicReviews : undefined;
  const invitesOpen = state?.user.status === 'active' && state.permissions.inviteCreate && route.startsWith('#invites');
  const adminProfileId = state?.permissions.admin ? /^#invites\/profile\/([0-9a-f-]{36})$/i.exec(route)?.[1] : undefined;
  const communitiesOpen = state?.user.status === 'active' && state.permissions.admin && route.startsWith('#communities');
  const adminListingsOpen = state?.user.status === 'active' && state.permissions.admin && route.startsWith('#admin-listings');
  const listingsOpen = state?.user.status === 'active' && route.startsWith('#listings');
  const datesOpen = state?.user.status === 'active' && route.startsWith('#dates');
  const adventuresOpen = state?.user.status === 'active' && !route.startsWith('#character') && !invitesOpen && !communitiesOpen && !adminListingsOpen && !listingsOpen && !datesOpen;
  const analyticsScreen = !state || state.user.status === 'pending_invite' ? null
    : state.user.status !== 'active' ? `onboarding_${currentStep}`
    : invitesOpen ? 'invites' : communitiesOpen ? 'communities' : adminListingsOpen ? 'admin_listings' : listingsOpen ? route.startsWith('#listings/') ? 'listing_detail' : 'listing_list'
    : datesOpen ? route.startsWith('#dates/') ? 'date_detail' : 'date_list'
    : adventuresOpen ? route.includes('/character/') ? 'adventure_character' : route.startsWith('#adventures/') ? 'adventure_detail' : 'adventure_list'
    : showProfile ? 'character_profile' : `character_editor_${currentStep}`;
  useEffect(() => { if (analyticsScreen) track('screen_viewed', { screen: analyticsScreen }); }, [analyticsScreen]);

  return <CommunityCatalog.Provider value={communities}><div className="app-shell">
    <header className="site-header"><a className="wordmark" href="/" aria-label="QUESTR" onClick={event => { if (state?.user.status === 'active') { event.preventDefault(); navigate('adventures'); } }}><span className="pixel-spark" />QUESTR<span className="wordmark-dot">.</span></a>
      <div className="header-right">{config?.authMode === 'demo' && <span className="preview-badge">{t('app.demo')}</span>}<select className="locale-switch" aria-label={t('ui.language')} value={locale} disabled={!state || busy} onChange={event => void changeLocale(event.target.value as Locale)}><option value="en">EN</option><option value="ru">RU</option></select><button className="text-button" onClick={() => setTermsOpen(true)}>{t('welcome.readTerms')}</button></div>
    </header>
    <div className="workspace">
      {state?.user.status === 'active' && <nav className="workspace-tabs" aria-label={t('nav.label')}><button className={!adventuresOpen && !datesOpen && !listingsOpen && !invitesOpen && !communitiesOpen && !adminListingsOpen ? 'active' : ''} aria-current={!adventuresOpen && !datesOpen && !listingsOpen && !invitesOpen && !communitiesOpen && !adminListingsOpen ? 'page' : undefined} onClick={() => navigate('character')}>{t('nav.character')}</button><button className={adventuresOpen || listingsOpen ? 'active' : ''} aria-current={adventuresOpen || listingsOpen ? 'page' : undefined} onClick={() => navigate('adventures')}>{t('nav.adventures')}</button><button className={datesOpen ? 'active' : ''} aria-current={datesOpen ? 'page' : undefined} onClick={() => navigate('dates')}>{t('nav.dates')}</button>{state.permissions.inviteCreate && <button className={invitesOpen ? 'active' : ''} aria-current={invitesOpen ? 'page' : undefined} onClick={() => navigate('invites')}>{t(state.permissions.admin ? 'nav.admin' : 'nav.invites')}</button>}{state.permissions.admin && <><button className={communitiesOpen ? 'active' : ''} aria-current={communitiesOpen ? 'page' : undefined} onClick={() => navigate('communities')}>{t('nav.communities')}</button><button className={adminListingsOpen ? 'active' : ''} aria-current={adminListingsOpen ? 'page' : undefined} onClick={() => navigate('admin-listings')}>{t('nav.listingsAdmin')}</button></>}</nav>}
      {draft && !showProfile && !adventuresOpen && !datesOpen && !listingsOpen && !invitesOpen && !communitiesOpen && !adminListingsOpen && <nav className="step-bar" aria-label={t('steps.eyebrow')}>
        {steps.map((step, index) => <button key={step.id} className={`step ${currentStep === step.id ? 'active' : ''} ${index < stepIndex ? 'done' : ''}`}
          disabled={busy || (step.id !== 'avatar' && !draft.avatarId)} aria-current={currentStep === step.id ? 'step' : undefined} onClick={() => void go(step.id)}>
          <span className="step-number">{index < stepIndex ? <Check size={13} /> : index + 1}</span><span className="step-label">{t(step.label)}</span>
        </button>)}
      </nav>}
      <main className={`main-content ${currentStep === 'welcome' ? 'welcome-content' : ''}`}>
        {!!visibleError && <div className="error-banner" role="alert"><span>{errorText(visibleError)}</span>
          <button className="text-button" onClick={() => void run(async () => { if (conflict || !state) await loadState(); else await flush(); })}>{t(conflict ? 'common.reload' : 'common.retry')}</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /><p>{t('common.loading')}</p></div> : telegramNeeded ? <div className="interview-intro"><MessageCircle size={40} /><h1>{t('welcome.telegram')}</h1><a className="pixel-button" href="https://t.me/questr_game">{t('welcome.openBot')}<ArrowRight size={18} /></a></div> : !state ? null : !draft ? <section className="welcome-layout">
          <PageHeading title="welcome.title" />
          <EmailInvite registration onVerified={loadState} />
          <form className="welcome-form paper-card" onSubmit={event => void register(event)}><span className="card-corner" />
            <label htmlFor="name">{t('welcome.name')}</label><input id="name" autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} placeholder={t('welcome.namePlaceholder')} minLength={2} maxLength={40} required />
            <label htmlFor="invite">{t('welcome.invite')}</label><input id="invite" value={invite} onChange={e => setInvite(e.target.value)} placeholder={t('welcome.invitePlaceholder')} autoCapitalize="none" autoComplete="off" spellCheck={false} required={!state.emailRegistrationAllowed} />
            {state.emailRegistrationAllowed && <p className="hint">{t('emailInvite.registrationReady')}</p>}
            <div className="consents"><label className="checkbox-label"><input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} required /><span>{t('welcome.adult')}</span></label>
              <label className="checkbox-label"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} required /><span>{t('welcome.terms')}</span></label><button type="button" className="text-button terms-link" onClick={() => setTermsOpen(true)}>{t('welcome.readTerms')}</button></div>
            <button type="submit" className="pixel-button full-width" disabled={busy}>{t('welcome.start')}{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}</button>
            <p className="form-privacy"><LockKeyhole size={13} />{t('footer.private')}</p>
          </form>
        </section> : invitesOpen ? adminProfileId ? <AdminProfile userId={adminProfileId} /> : <Invites admin={state.permissions.admin} selfId={state.user.id} botUsername={config?.botUsername ?? 'questr_game'} /> : communitiesOpen ? <AdminCommunities /> : adminListingsOpen && config ? <AdminEventListings config={config} /> : listingsOpen && config ? <EventListings config={config} spokenLanguages={state.profile?.spokenLanguages ?? []} communityIds={state.profile?.communities ?? []} /> : datesOpen ? <Dates selfId={state.user.id} admin={state.permissions.admin} discovery={state.discovery} spokenLanguages={state.profile?.spokenLanguages ?? []} communityIds={state.profile?.communities ?? []} detailId={route.startsWith('#dates/') ? route.slice('#dates/'.length) : null} /> : adventuresOpen && state.user.status === 'active' && config ? <Adventures config={config} discovery={state.discovery} spokenLanguages={state.profile?.spokenLanguages ?? []} communityIds={state.profile?.communities ?? []} onDiscovery={discovery => setState(old => old ? { ...old, discovery } : old)} /> : showProfile && state.profile ? <section>
          <PageHeading title="profile.title" />
          <ProfileCard profile={state.profile} />
          <InviteRedeemer initialCode={sharedInviteCode ?? ''} onRedeemed={loadState} />
          <EmailInvite onVerified={loadState} />
          <RomanceSettings />
          <DiscoverySettings initial={state.discovery} spokenLanguages={state.profile.spokenLanguages} onSaved={discovery => setState(old => old ? { ...old, discovery } : old)} />

          <div className="page-actions"><button className="outline-button" onClick={() => void go('avatar')} disabled={busy}>{t('avatar.customize')}</button><button className="pixel-button" onClick={() => void go('bio')} disabled={busy}><PenLine size={16} />{t('profile.edit')}</button></div>
        </section> : currentStep === 'avatar' ? <section>
          <PageHeading title="avatar.title" />
          <div className="avatar-layout">
            <div className="character-stage"><span className="stage-star star-one">✦</span><span className="stage-star star-two">✧</span><Character id={draft.avatarId} appearance={draft.avatarAppearance} className="hero-character" /><span className="character-shadow" />
              <button className="character-name" onClick={() => { setNextName(draft.displayName); setEditingName(true); }} aria-label={t('avatar.changeName')}><h2>{draft.displayName}</h2><PenLine size={13} /></button><span className="stage-subtitle">{isPresetAppearance(draft.avatarId, draft.avatarAppearance) ? selectedAvatar?.name ?? avatars[0].name : t('avatar.customLook')}</span>
              <button className="text-button" onClick={() => { const other = avatars.filter(a => a.id !== draft.avatarId); const next = other[Math.floor(Math.random() * other.length)]; edit({ avatarId: next.id, avatarAppearance: appearanceForPreset(next.id) }); }}><Shuffle size={14} />{t('avatar.random')}</button>
            </div>
            <AvatarBuilder id={draft.avatarId} appearance={draft.avatarAppearance} onChange={(avatarAppearance, avatarId) => edit({ avatarAppearance, avatarId: avatarId ?? draft.avatarId ?? avatars[0].id })} />
          </div>
          <div className="page-actions"><SaveStatus state={saveState} /><button className="pixel-button" disabled={!draft.avatarId || busy} onClick={() => void go('bio')}>{t('avatar.next')}<ArrowRight size={17} /></button></div>
        </section> : currentStep === 'bio' || currentStep === 'discovery' ? <>
        <section hidden={currentStep !== 'bio'}>
          <PageHeading title="bio.title" />
          <div className="bio-layout"><div className="bio-main">
            <div className="section-heading"><h2>{t('bio.tagsTitle')}</h2><span>{t('common.optional')}</span></div>
            <TagPicker value={draft.tags} onChange={tags => edit({ tags })} />
            <AskMeTopics value={draft.askMeTopics} onChange={askMeTopics => edit({ askMeTopics })} reviews={currentTopicReviews} />
            <div className="story-heading"><h2>{t('bio.storyTitle')}</h2></div>
            {draft && <ContentWarning text={draft.introMarkdown} review={currentReview} />}
            <div className="editor-card"><div className="writing-tabs" role="tablist" aria-label={t('bio.storyTitle')}>
              <button role="tab" aria-selected={draft.mode === 'manual'} aria-controls="writing-panel" className={draft.mode === 'manual' ? 'active' : ''} onClick={() => edit({ mode: 'manual' })}><PenLine size={16} />{t('bio.write')}</button>
              <button role="tab" aria-selected={draft.mode === 'interview'} aria-controls="writing-panel" className={draft.mode === 'interview' ? 'active' : ''} onClick={() => edit({ mode: 'interview' })}><MessageCircle size={16} />{t('bio.ask')}<span className="tab-star">✦</span></button>
            </div><div id="writing-panel" role="tabpanel">
              {draft.mode === 'manual' ? <><Suspense fallback={<div className="editor-loading"><LoaderCircle size={20} className="spin" /></div>}><BioEditor key={locale} value={draft.introMarkdown} flagged={currentReview?.spans} onChange={introMarkdown => edit({ introMarkdown })} /></Suspense><div className="editor-footer"><span>{t('bio.words', { count: wordCount })}</span></div></> : config && <Interview config={config} conversation={state.conversation} proposal={state.proposal} askMeTopics={draft.askMeTopics} onBioReview={setBioReview}
                hasBio={Boolean(draft.introMarkdown.trim())} onConversation={conversation => setState(old => old ? { ...old, conversation } : old)} onProposal={proposal => setState(old => old ? { ...old, proposal } : old)} flush={flush}
                onApply={nextDraft => { replace(nextDraft); edit({ mode: 'manual' }); }} />}
            </div></div>
            <details className="bio-disclosure"><summary>{t('content.howUsed')}</summary><p>{t(config?.aiMode === 'openrouter' ? 'content.disclosure' : 'content.demoDisclosure')}</p></details>
          </div></div>
          <div className="page-actions"><button className="text-button" onClick={() => void go('avatar')} disabled={busy}><ArrowLeft size={16} />{t('common.back')}</button><div className="action-right">{currentStep === 'bio' && <SaveStatus state={saveState} />}<button className="pixel-button" disabled={busy} onClick={() => void go('discovery')}>{t('steps.discovery')}<ArrowRight size={17} /></button></div></div>
        </section>
        <section hidden={currentStep !== 'discovery'}>
          <PageHeading title="steps.discovery" />
          <div className="bio-settings-panel">
            <div className="profile-languages"><LanguagePicker label={t('languages.spoken')} value={draft.spokenLanguages} onChange={spokenLanguages => edit({ spokenLanguages })} /></div>
            <DiscoverySettings initial={state.discovery} spokenLanguages={draft.spokenLanguages} inline required={!state.profile} onDirtyChange={setDiscoveryDirty} onValueChange={setDiscoveryPending} onSaved={discovery => { setDiscoveryDirty(false); setDiscoveryPending(null); setState(old => old ? { ...old, discovery } : old); }} />
          </div>
          <div className="page-actions"><button className="text-button" onClick={() => void go('bio')} disabled={busy}><ArrowLeft size={16} />{t('common.back')}</button><div className="action-right">{currentStep === 'discovery' && <SaveStatus state={saveState} />}<button className="pixel-button" disabled={busy} onClick={() => void go('review')}>{t(checkingBio ? 'content.checking' : 'bio.preview')}<ArrowRight size={17} /></button></div></div>
        </section>
        </> : <section>
          <PageHeading title="review.title" />
          <ContentWarning text={draft.introMarkdown} review={currentReview} />
          {draft.askMeTopics.map((topic, index) => <ContentWarning key={`${topic}:${index}`} text={topic} review={currentTopicReviews?.[index]} />)}
          <ProfileCard profile={{ ...draft, avatarId: draft.avatarId!, completedAt: '', communities: state.profile?.communities ?? [] }} flagged={currentReview?.spans} />
          <div className="page-actions"><button className="text-button" disabled={busy} onClick={() => void go('bio')}><ArrowLeft size={16} />{t('review.edit')}</button><button className="pixel-button" disabled={busy} onClick={() => void publish()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{t(checkingBio ? 'content.checking' : 'review.finish')}</button></div>
          <p className="review-privacy"><LockKeyhole size={13} />{t('review.private')}</p>
        </section>}
      </main>
    </div>

    {exitTarget && <Modal title={t('discovery.leaveTitle')} onClose={() => { if (!busy) setExitTarget(null); }}><p>{t('discovery.leaveHint')}</p>{!!error && <p className="field-error" role="alert">{errorText(error)}</p>}<div className="modal-actions"><button className="text-button" disabled={busy} onClick={() => setExitTarget(null)}>{t('common.cancel')}</button><button className="outline-button small" disabled={busy} onClick={() => void finishExit(exitTarget, false)}>{t('discovery.discardAndLeave')}</button><button className="pixel-button small" disabled={busy} onClick={() => void finishExit(exitTarget, true)}>{t('discovery.saveAndLeave')}</button></div></Modal>}
    {editingName && <Modal title={t('avatar.changeName')} onClose={() => setEditingName(false)}><form onSubmit={event => { event.preventDefault(); if (nextName.trim().length >= 2) { edit({ displayName: nextName.trim() }); setEditingName(false); } }}><label htmlFor="display-name">{t('welcome.name')}</label><input id="display-name" value={nextName} onChange={e => setNextName(e.target.value)} minLength={2} maxLength={40} required autoFocus /><div className="modal-actions"><button className="pixel-button small" type="submit">{t('avatar.saveName')}<Check size={15} /></button></div></form></Modal>}
    {termsOpen && <Modal title={t('terms.title')} onClose={() => setTermsOpen(false)}><div className="terms-body"><p>{t('terms.intro')}</p><ul><li>{t('terms.respect')}</li><li>{t('terms.identity')}</li><li>{t('terms.profile')}</li></ul><p>{t('terms.poc')}</p><p>{t('terms.romance')}</p></div><div className="modal-actions"><button className="pixel-button small" onClick={() => setTermsOpen(false)}>{t('common.close')}</button></div></Modal>}
  </div></CommunityCatalog.Provider>;
}
function PageHeading({ title }: { title: TranslationKey }) {
  return <div className="page-heading"><h1>{t(title)}</h1></div>;
}
function SaveStatus({ state }: { state: 'saved' | 'saving' | 'error' }) {
  return <span className={`save-status ${state}`} role="status">{state === 'saving' ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={15} />}{t(state === 'saving' ? 'common.saving' : state === 'error' ? 'common.unsaved' : 'common.saved')}</span>;
}
