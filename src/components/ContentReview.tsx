import { Fragment, useEffect, type RefObject } from 'react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import type { ContentReview, ContentSpan } from '../../shared/content-policy.ts';
import { t } from '../i18n.ts';

export function MarkedText({ text, spans = [] }: { text: string; spans?: ContentSpan[] }) {
  let end = 0;
  const pieces = spans.map(span => {
    const before = text.slice(end, span.start); end = span.end;
    return <Fragment key={`${span.start}:${span.end}`}>{before}<mark className="content-flag">{text.slice(span.start, span.end)}</mark></Fragment>;
  });
  return <>{pieces}{text.slice(end)}</>;
}
export function ContentWarning({ text, review }: { text: string; review?: ContentReview | null }) {
  if (review?.status !== 'blocked') return null;
  return <div className="content-warning" role="alert">
    <strong>{t('content.title')}</strong><p>{t('content.description')}</p>
    <details><summary>{t('content.passages')}</summary>
      {review.spans.map(span => <p key={`${span.start}:${span.end}`}><mark className="content-flag">{text.slice(span.start, span.end)}</mark></p>)}
    </details>
  </div>;
}

const groups = new Map<symbol, Range[]>();
function repaint() { CSS.highlights.set('questr-explicit', new Highlight(...[...groups.values()].flat())); }
const compact = (value: string) => value.replace(/\s/gu, '');
// Paint ranges without inserting DOM nodes into Lexical or CodeMirror. This keeps
// formatting, selection, Markdown source and undo history unchanged.
export function useContentHighlights(root: RefObject<HTMLElement | null>, source: string, spans: ContentSpan[], editor = false) {
  useEffect(() => {
    if (!spans.length || !root.current || !globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    const key = Symbol('content-review');
    function update() {
      const ranges: Range[] = [];
      const elements = editor ? root.current?.querySelectorAll<HTMLElement>('.editor-content, .cm-content') ?? [] : root.current ? [root.current] : [];
      for (const element of elements) {
        const positions: { node: Text; offset: number }[] = [];
        let text = '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const value = node.textContent ?? '';
          for (let offset = 0; offset < value.length; offset++) if (!/\s/u.test(value[offset])) {
            text += value[offset]; positions.push({ node: node as Text, offset });
          }
        }
        for (const span of spans) {
          const quote = source.slice(span.start, span.end);
          const needle = compact(element.classList.contains('cm-content') ? quote : toString(fromMarkdown(quote)));
          if (!needle) continue;
          for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) {
            const first = positions[start], last = positions[start + needle.length - 1];
            const range = new Range();
            range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1); ranges.push(range);
          }
        }
      }
      groups.set(key, ranges); repaint();
    }
    update();
    const observer = new MutationObserver(update);
    observer.observe(root.current, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); groups.delete(key); repaint(); };
  }, [root, source, spans, editor]);
}
