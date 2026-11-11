import { useEffect, useRef, useState } from 'react';
import {
  MDXEditor, type MDXEditorMethods, headingsPlugin, listsPlugin, quotePlugin,
  linkPlugin, linkDialogPlugin, thematicBreakPlugin, markdownShortcutPlugin,
  toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, Separator, diffSourcePlugin, DiffSourceToggleWrapper,
  tablePlugin, codeBlockPlugin, codeMirrorPlugin, defaultSvgIcons,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { t } from '../i18n.ts';

export default function BioEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<MDXEditorMethods>(null);
  const lastValue = useRef(value);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (value !== lastValue.current) { lastValue.current = value; ref.current?.setMarkdown(value); }
  }, [value]);
  return <div className="bio-editor" data-testid="bio-editor">
    <MDXEditor ref={ref} markdown={value} suppressHtmlProcessing trim={false}
      translation={(key, fallback, values) => key === 'toolbar.richText' ? t('editor.visual') : key === 'toolbar.source' ? t('editor.markdown') : fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))}
      iconComponentFor={name => name === 'rich_text' ? <span className="editor-mode-label">{t('editor.visual')}</span> : name === 'markdown' ? <span className="editor-mode-label">{t('editor.markdown')}</span> : defaultSvgIcons[name]}
      contentEditableClassName="prose editor-content" placeholder={t('bio.editorPlaceholder')}
      onError={() => setError(true)}
      onChange={(markdown, initialNormalize) => {
        if (initialNormalize) return;
        lastValue.current = markdown; setError(false); onChange(markdown);
      }}
      plugins={[
        headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }), listsPlugin(), quotePlugin(),
        linkPlugin({ validateUrl: url => /^(https?:\/\/|mailto:)/i.test(url) }), linkDialogPlugin(), thematicBreakPlugin(), tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
        codeMirrorPlugin({ codeBlockLanguages: { txt: 'Text', js: 'JavaScript', ts: 'TypeScript', python: 'Python', '': 'Text' } }),
        markdownShortcutPlugin(), diffSourcePlugin({ viewMode: 'rich-text' }),
        toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper options={['rich-text', 'source']}>
          <UndoRedo /><Separator /><BlockTypeSelect /><Separator />
          <BoldItalicUnderlineToggles options={['Bold', 'Italic']} /><ListsToggle options={['bullet', 'number']} />
          <CreateLink />
        </DiffSourceToggleWrapper> }),
      ]}
    />
    {error && <p className="inline-warning" role="status">{t('editor.error')}</p>}
  </div>;
}
