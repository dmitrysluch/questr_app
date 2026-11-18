import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, MessageCircle, Send, ShieldCheck, Shuffle, WandSparkles } from 'lucide-react';
import type { AppConfig, Conversation, Draft, Proposal, InterviewInput } from '../../shared/schema.ts';
import { tags } from '../../shared/catalog.ts';
import { api, ApiError } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { Markdown } from './Markdown.tsx';
import { Modal } from './Modal.tsx';
import { PixelEmoji } from './PixelEmoji.tsx';
import { MarkedText } from './ContentReview.tsx';
import type { BioReview } from '../../shared/content-policy.ts';
import { track } from '../analytics.ts';

interface Props {
  config: AppConfig;
  conversation: Conversation | null;
  proposal: Proposal | null;
  hasBio: boolean;
  askMeTopics: string[];
  onBioReview: (value: BioReview) => void;
  onConversation: (value: Conversation) => void;
  onProposal: (value: Proposal | null) => void;
  flush: () => Promise<Draft | null>;
  onApply: (draft: Draft) => void;
}
export function Interview({ config, conversation, proposal, hasBio, askMeTopics, onBioReview, onConversation, onProposal, flush, onApply }: Props) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'start' | 'send' | 'change_topic' | 'compose' | 'apply' | 'review' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reviewing, setReviewing] = useState(Boolean(proposal));
  const [selectedCodes, setSelectedCodes] = useState<string[]>(proposal?.suggestedTags.map(t => t.code) ?? []);
  const [selectedTopicIndexes, setSelectedTopicIndexes] = useState<number[]>([]);
  const [reviewView, setReviewView] = useState<'proposed' | 'current'>('proposed');
  const pendingRequest = useRef<{ signature: string; input: InterviewInput } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!conversation?.id) return;
    let active = true;
    setBusy('review');
    void api<{ conversation: Conversation }>('/assistant/review', { method: 'POST', body: {} })
      .then(result => { if (active) onConversation(result.conversation); })
      .catch(e => { if (active) setError(e); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [conversation?.id]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [conversation?.messages.length, busy]);
  async function start() {
    setBusy('start'); setError(null);
    try {
      const draft = await flush();
      const review = await api<{ bioReview: BioReview }>('/draft/validate', { method: 'POST', body: { revision: draft?.revision } });
      onBioReview(review.bioReview);
      const result = await api<{ conversation: Conversation }>('/assistant/start', { method: 'POST', body: { consent: true } });
      track('interview_started', { has_existing_bio: hasBio });
      onConversation(result.conversation);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function send(changeTopic = false) {
    if ((!changeTopic && !answer.trim()) || busy) return;
    setBusy(changeTopic ? 'change_topic' : 'send'); setError(null);
    const payload = changeTopic ? { action: 'change_topic' as const } : { content: answer.trim() };
    const signature = JSON.stringify(payload);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, input: { requestId: crypto.randomUUID(), ...payload } };
    try {
      await flush();
      const result = await api<{ conversation: Conversation }>('/assistant/messages', { method: 'POST', body: pendingRequest.current.input });
      track(changeTopic ? 'interview_topic_changed' : 'interview_answered');
      onConversation(result.conversation); if (!changeTopic) setAnswer(''); pendingRequest.current = null;
    } catch (e) {
      setError(e);
      // A failed upstream request may already have saved the answer. Reload its receipt.
      try { const state = await api<{ conversation: Conversation }>('/me'); onConversation(state.conversation); } catch { /* Keep the local answer for retry. */ }
    } finally { setBusy(null); }
  }
  async function compose() {
    setBusy('compose'); setError(null);
    try {
      await flush();
      const result = await api<{ proposal: Proposal }>('/assistant/proposals', { method: 'POST', body: {} });
      track('interview_draft_created');
      onProposal(result.proposal); setSelectedCodes(result.proposal.suggestedTags.map(t => t.code)); setSelectedTopicIndexes([]); setReviewView('proposed'); setReviewing(true);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function apply() {
    if (!proposal) return;
    setBusy('apply'); setError(null);
    try {
      const current = await flush();
      const result = await api<{ draft: Draft }>(`/assistant/proposals/${proposal.id}/apply`, { method: 'POST', body: { revision: current?.revision, tagCodes: selectedCodes, askMeTopicIndexes: selectedTopicIndexes } });
      track('interview_draft_applied');
      onProposal(null); setReviewing(false); onApply(result.draft);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function discard() {
    if (!proposal || busy) return;
    setError(null);
    try { await api(`/assistant/proposals/${proposal.id}/reject`, { method: 'POST', body: {} }); onProposal(null); setReviewing(false); }
    catch (e) { setError(e); }
  }
  const stale = error instanceof ApiError && error.code === 'PROPOSAL_STALE';
  const errorBlock = error ? <div className="inline-warning" role="alert">{errorText(error)}{stale && <button className="text-button" onClick={() => void compose()} disabled={!!busy}>{t('proposal.new')}</button>}</div> : null;
  return <div className="interview">
    {!conversation ? <div className="interview-intro">
      <div className="interview-symbol"><MessageCircle size={28} strokeWidth={1.5} /><span className="pixel-spark small-spark" /></div>
      <p className="disclosure">{t(config.aiMode === 'demo' ? 'assistant.demoDisclosure' : 'assistant.disclosure')}</p>
      {errorBlock}
      <button className="pixel-button" onClick={() => void start()} disabled={!!busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <MessageCircle size={17} />}{t('assistant.start')}<ArrowRight size={16} /></button>
    </div> : <>
      <div className="chat-top"><span><span className="status-dot" />{t(config.aiMode === 'demo' ? 'assistant.demo' : 'assistant.connected')}</span><ShieldCheck size={16} /></div>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label={t('assistant.connected')}>
        {conversation.messages.map(message => message.kind === 'change_topic' ? <p className="chat-topic-change" key={message.id}><Shuffle size={13} />{t('assistant.topicChanged')}</p> : <div key={message.id} className={`chat-message ${message.role}`}>
          <span className="message-name">{t(message.role === 'assistant' ? 'assistant.name' : 'assistant.you')}</span>
          <p dir="auto"><MarkedText text={message.content} spans={message.contentReview?.spans} /></p>
          {message.contentReview?.status === 'blocked' && <span className="message-content-note">{t('content.messageNote')}</span>}
        </div>)}
        {busy === 'send' && <p className="chat-thinking"><LoaderCircle size={14} className="spin" />{t('assistant.thinking')}</p>}
        {busy === 'change_topic' && <p className="chat-thinking"><LoaderCircle size={14} className="spin" />{t('assistant.changingTopic')}</p>}
        {busy === 'review' && <p className="chat-thinking"><LoaderCircle size={14} className="spin" />{t('content.checkingMessages')}</p>}
      </div>
      {!reviewing && errorBlock}
      <form className="chat-input" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder={t('assistant.placeholder')} aria-label={t('assistant.placeholder')} rows={2} maxLength={12000} disabled={!!busy}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
        <button className="send-button" aria-label={t('assistant.send')} type="submit" disabled={!!busy || !answer.trim()}>{busy === 'send' ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}</button>
      </form>
      <div className="chat-actions">
        <button className="text-button subtle" disabled={!!busy} onClick={() => void send(true)}><Shuffle size={15} />{t('assistant.changeTopic')}</button>
        <button className="outline-button small" disabled={!!busy || (!hasBio && !conversation.messages.some(m => m.role === 'user' && m.kind !== 'change_topic'))} onClick={() => void compose()}>
          {busy === 'compose' ? <LoaderCircle size={16} className="spin" /> : <WandSparkles size={16} />}{t(busy === 'compose' ? 'assistant.structuring' : hasBio ? 'assistant.update' : 'assistant.compose')}
        </button>
      </div>
      {proposal && !reviewing && <button className="text-button" onClick={() => setReviewing(true)}>{t('proposal.title')}<ArrowRight size={14} /></button>}
    </>}
    {reviewing && proposal && <Modal title={t('proposal.title')} wide onClose={() => { if (!busy) setReviewing(false); }}>
      <p className="modal-description">{t('proposal.description')}</p>
      <p className="proposal-summary" dir="auto">{proposal.changeSummary}</p>
      <div className="proposal-views" role="tablist" aria-label={t('proposal.compare')}>
        <button role="tab" aria-selected={reviewView === 'proposed'} onClick={() => setReviewView('proposed')}>{t('proposal.proposed')}</button>
        <button role="tab" aria-selected={reviewView === 'current'} onClick={() => setReviewView('current')}>{t('proposal.current')}</button>
      </div>
      <div className="proposal-preview" role="tabpanel" aria-label={t(reviewView === 'proposed' ? 'proposal.proposed' : 'proposal.current')}>
        {reviewView === 'current' && !proposal.baseMarkdown ? <p className="hint">{t('proposal.empty')}</p> : <Markdown content={reviewView === 'proposed' ? proposal.introMarkdown : proposal.baseMarkdown} />}
      </div>
      {!!proposal.suggestedTags.length && <div className="proposal-tags"><h3>{t('proposal.tags')}</h3><p className="hint">{t('proposal.tagHint')}</p><div className="tag-list">
        {proposal.suggestedTags.map(suggestion => {
          const tag = tags.find(t => t.code === suggestion.code)!;
          const selected = selectedCodes.includes(tag.code);
          return <button key={tag.code} className={`tag-pill tag-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={!!busy}
            onClick={() => setSelectedCodes(codes => selected ? codes.filter(c => c !== tag.code) : [...codes, tag.code])}><PixelEmoji emoji={tag.emoji} />{tag.label}{selected && <Check size={13} />}</button>;
        })}
      </div></div>}
      {!!proposal.suggestedAskMeTopics.length && <div className="proposal-ask-me"><h3>{t('proposal.askMeTopics')}</h3><p className="hint">{t('proposal.askMeHint')}</p>
        {proposal.suggestedAskMeTopics.map((topic, index) => {
          const selected = selectedTopicIndexes.includes(index);
          const alreadyAdded = askMeTopics.some(value => value.normalize('NFKC').toLocaleLowerCase() === topic.text.normalize('NFKC').toLocaleLowerCase());
          return <label className="proposal-ask-me-choice" key={`${topic.text}:${index}`}><input type="checkbox" checked={selected} disabled={!!busy || alreadyAdded || (!selected && askMeTopics.length + selectedTopicIndexes.length >= 3)} onChange={event => setSelectedTopicIndexes(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))} /><span dir="auto">{topic.text}</span></label>;
        })}
      </div>}
      <details className="source-answers"><summary>{t('proposal.sources')}</summary>
        {proposal.sourceIds.filter(id => id !== 'bio').map(id => <blockquote key={id}>{conversation?.messages.find(m => m.id === id)?.content}</blockquote>)}
        {proposal.sourceIds.includes('bio') && <p>{t('proposal.bioSource')}</p>}
      </details>
      {errorBlock}
      <div className="modal-actions"><button className="text-button" disabled={!!busy} onClick={() => void discard()}>{t('proposal.discard')}</button>
        <button className="pixel-button small" disabled={!!busy || stale} onClick={() => void apply()}>{busy === 'apply' ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{t('proposal.apply')}</button>
      </div>
    </Modal>}
  </div>;
}
