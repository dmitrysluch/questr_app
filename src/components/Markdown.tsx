import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRef } from 'react';
import type { ContentSpan } from '../../shared/content-policy.ts';
import { useContentHighlights } from './ContentReview.tsx';

// No raw-HTML plugin: HTML/JSX is never executed. URL transformation rejects unsafe protocols.
export function Markdown({ content, flagged = [] }: { content: string; flagged?: ContentSpan[] }) {
  const root = useRef<HTMLDivElement>(null);
  useContentHighlights(root, content, flagged);
  return <div className="prose" dir="auto" ref={root}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    disallowedElements={['img', 'iframe', 'script', 'style', 'input']}
    components={{ a: props => <a href={props.href} target="_blank" rel="noopener noreferrer nofollow">{props.children}</a> }}
  >{content}</ReactMarkdown></div>;
}
