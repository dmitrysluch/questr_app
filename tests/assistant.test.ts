import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleProposal, demoPlan, demoQuestion, structuredResponse, Interviewer } from '../server/assistant.ts';
import { loadConfig } from '../server/config.ts';
import type { ChatMessage } from '../shared/schema.ts';

const messages: ChatMessage[] = [
  { id: 'q1', role: 'assistant', content: 'What do you enjoy?', createdAt: '' },
  { id: 'a1', role: 'user', content: "I climb badly, enthusiastically. Mostly bouldering — the puzzles get me.", createdAt: '' },
  { id: 'a2', role: 'user', content: "EDM. Weird little venues. I'm happy to go on a Tuesday, too!", createdAt: '' },
];
test('bio assembly preserves every selected answer byte for byte and changes only structure', () => {
  const existing = 'A **very** particular opening.\n\n  Spaces matter.';
  const result = assembleProposal(existing, messages, { sections: [
    { heading: 'interests', messageIds: ['a2'] }, { heading: 'together', messageIds: ['a1'] },
  ], suggestedTags: [{ code: 'edm', sourceMessageId: 'a2' }] });
  assert.equal(result.introMarkdown, `${existing}\n\n## Things I get into\n\n${messages[2].content}\n\n## Better with company\n\n${messages[1].content}`);
  assert.deepEqual(result.sourceMap[0].messageIds, ['a2']);
});
test('bio assembly fails closed for invented sources, assistant sources, duplicated sources, and unsupported tags', () => {
  assert.throws(() => assembleProposal('', messages, { biography: 'Invented prose' }), /INVALID_AI_PROPOSAL/);
  for (const messageIds of [['fake'], ['q1'], ['a1', 'a1']]) {
    assert.throws(() => assembleProposal('', messages, { sections: [{ heading: 'about', messageIds }], suggestedTags: [] }));
  }
  for (const suggestedTags of [[{ code: 'edm', sourceMessageId: 'a2' }], [{ code: 'invented', sourceMessageId: 'a1' }]]) {
    assert.throws(() => assembleProposal('', messages, { sections: [{ heading: 'about', messageIds: ['a1'] }], suggestedTags }));
  }
});
test('incorporated answers are not duplicated and an empty proposal cannot overwrite the existing bio', () => {
  const result = assembleProposal(messages[1].content, messages, { sections: [{ heading: 'about', messageIds: ['a1', 'a2'] }], suggestedTags: [] });
  assert.equal(result.introMarkdown.split(messages[1].content).length, 2);
  assert.throws(() => assembleProposal('Original', messages, { sections: [], suggestedTags: [] }));
});
test('demo asks a topical follow-up and excludes skip requests from profile content', () => {
  assert.match(demoQuestion(messages.slice(0, 2)), /climbing/);
  const plan = demoPlan([...messages, { id: 'skip', role: 'user', content: 'Please skip this topic and ask me a different question.', createdAt: '' }]);
  assert.ok(!plan.sections.flatMap(s => s.messageIds).includes('skip'));
});
test('OpenAI requests use structured output, disable provider response storage and surface errors', async () => {
  let request: any;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    request = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"question":"Tell me more?"}' }] }] }), { status: 200 });
  }) as typeof fetch;
  const result = await structuredResponse({ ...loadConfig(), openaiApiKey: 'test-key' }, 'instructions', { content: 'original' }, 'test', { type: 'object' }, fakeFetch);
  assert.deepEqual(result, { question: 'Tell me more?' });
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.type, 'json_schema');
  await assert.rejects(structuredResponse(loadConfig(), '', {}, 'test', {}, (async () => new Response('{}', { status: 429 })) as typeof fetch), /ASSISTANT_UNAVAILABLE/);
});
test('AI gets opaque source references; model-provided wording cannot enter a bio', async () => {
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const input = JSON.parse(body.input);
    assert.equal(input.transcript[1].id, 'answer_2');
    assert.ok(!('userId' in input));
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ sections: [{ heading: 'about', messageIds: ['answer_2'] }], suggestedTags: [] }) }] }] }));
  }) as typeof fetch;
  const assistant = new Interviewer({ ...loadConfig(), aiMode: 'openai', openaiApiKey: 'test' }, fetcher);
  const result = await assistant.proposal(messages, '');
  assert.equal(result.introMarkdown, `## A little about me\n\n${messages[1].content}`);
  assert.deepEqual(result.sourceMap[0].messageIds, ['a1']);
});
