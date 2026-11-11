import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft } from '../shared/schema.ts';
import { api } from './api.ts';

export function useDraft() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState<unknown>(null);
  const latest = useRef<Draft | null>(null);
  const revision = useRef(0);
  const sequence = useRef(0);
  const savedSequence = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const replace = useCallback((value: Draft | null) => {
    latest.current = value;
    revision.current = value?.revision ?? 0;
    savedSequence.current = ++sequence.current;
    setDraft(value); setSaveState('saved'); setSaveError(null);
  }, []);
  const edit = useCallback((patch: Partial<Draft>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...patch, revision: revision.current };
    sequence.current++;
    setDraft(latest.current); setSaveState('saving');
  }, []);
  const flush = useCallback((): Promise<Draft | null> => {
    const work = queue.current.catch(() => {}).then(async () => {
      try {
        while (latest.current && sequence.current !== savedSequence.current) {
          const snapshot = { ...latest.current, revision: revision.current };
          const atSequence = sequence.current;
          setSaveState('saving');
          const { draft: saved } = await api<{ draft: Draft }>('/draft', { method: 'PUT', body: snapshot });
          revision.current = saved.revision;
          savedSequence.current = atSequence;
          latest.current = { ...latest.current, revision: saved.revision };
          setDraft(latest.current);
        }
        setSaveState('saved'); setSaveError(null);
        return latest.current;
      } catch (error) { setSaveState('error'); setSaveError(error); throw error; }
    });
    queue.current = work;
    return work;
  }, []);
  useEffect(() => {
    if (!draft || sequence.current === savedSequence.current) return;
    const timeout = setTimeout(() => { void flush().catch(() => {}); }, 650);
    return () => clearTimeout(timeout);
  }, [draft, flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (sequence.current !== savedSequence.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return { draft, edit, replace, flush, saveState, saveError };
}
