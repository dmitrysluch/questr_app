import { useEffect, useRef, useState } from 'react';
import {
  MDXEditor, type MDXEditorMethods, headingsPlugin, listsPlugin, quotePlugin,
  linkPlugin, linkDialogPlugin, thematicBreakPlugin, markdownShortcutPlugin,
  toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, Separator, diffSourcePlugin, DiffSourceToggleWrapper,
  tablePlugin, codeBlockPlugin, codeMirrorPlugin, defaultSvgIcons,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { getLocale, t } from '../i18n.ts';
import { useContentHighlights } from './ContentReview.tsx';
import type { ContentSpan } from '../../shared/content-policy.ts';

const editorRu: Record<string, string> = {
  'toolbar.undo': 'Отменить {{shortcut}}', 'toolbar.redo': 'Повторить {{shortcut}}',
  'toolbar.bold': 'Жирный', 'toolbar.removeBold': 'Убрать жирный',
  'toolbar.italic': 'Курсив', 'toolbar.removeItalic': 'Убрать курсив',
  'toolbar.bulletedList': 'Маркированный список', 'toolbar.numberedList': 'Нумерованный список',
  'toolbar.link': 'Добавить ссылку', 'toolbar.blockTypes.paragraph': 'Абзац',
  'toolbar.blockTypes.quote': 'Цитата', 'toolbar.blockTypes.heading': 'Заголовок {{level}}',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': 'Выбрать тип блока',
  'toolbar.blockTypeSelect.placeholder': 'Тип блока',
  'createLink.urlPlaceholder': 'Выбери или вставь ссылку',
  'createLink.textTooltip': 'Текст, который будет показан вместо ссылки',
  'createLink.text': 'Текст ссылки', 'createLink.titleTooltip': 'Подсказка при наведении',
  'createLink.title': 'Заголовок ссылки', 'createLink.saveTooltip': 'Сохранить ссылку',
  'createLink.cancelTooltip': 'Отменить изменение', 'dialogControls.save': 'Сохранить',
  'dialogControls.cancel': 'Отмена', 'linkPreview.open': 'Открыть {{url}} в новом окне',
  'linkPreview.edit': 'Изменить ссылку', 'linkPreview.copyToClipboard': 'Копировать',
  'linkPreview.copied': 'Скопировано', 'linkPreview.remove': 'Убрать ссылку',
};

export default function BioEditor({ value, onChange, flagged = [] }: { value: string; onChange: (value: string) => void; flagged?: ContentSpan[] }) {
  const container = useRef<HTMLDivElement>(null);
  useContentHighlights(container, value, flagged, true);
  const ref = useRef<MDXEditorMethods>(null);
  const lastValue = useRef(value);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (value !== lastValue.current) { lastValue.current = value; ref.current?.setMarkdown(value); }
  }, [value]);
  return <div className="bio-editor" data-testid="bio-editor" ref={container}>
    <MDXEditor ref={ref} markdown={value} suppressHtmlProcessing trim={false}
      translation={(key, fallback, values) => {
        const message = key === 'toolbar.richText' ? t('editor.visual') : key === 'toolbar.source' ? t('editor.markdown') : getLocale() === 'ru' ? editorRu[key] ?? fallback : fallback;
        return message.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
      }}
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
