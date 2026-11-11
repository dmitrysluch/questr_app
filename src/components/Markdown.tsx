import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// No raw-HTML plugin: HTML/JSX is never executed. URL transformation rejects unsafe protocols.
export function Markdown({ content }: { content: string }) {
  return <div className="prose" dir="auto"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    disallowedElements={['img', 'iframe', 'script', 'style', 'input']}
    components={{ a: props => <a href={props.href} target="_blank" rel="noopener noreferrer nofollow">{props.children}</a> }}
  >{content}</ReactMarkdown></div>;
}
