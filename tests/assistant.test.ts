import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProposal, structuredResponse, Interviewer } from '../server/assistant.ts';
import { demoQuestion, demoProposal } from '../server/demo-assistant.ts';
import { loadConfig } from '../server/config.ts';
import type { ChatMessage } from '../shared/schema.ts';

const messages: ChatMessage[] = [
  { id: 'q1', role: 'assistant', content: 'What happened at the climbing wall?', createdAt: '' },
  { id: 'a1', role: 'user', content: 'I fell off the same move for an hour. The puzzle is the fun bit.', createdAt: '' },
  { id: 'a2', role: 'user', content: 'EDM. Weird little venues. Tuesday nights too!', createdAt: '' },
];
const config = () => ({ ...loadConfig(), aiMode: 'openrouter' as const, openrouterApiKey: 'test-key', openrouterModel: 'test/model' });
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));

test('rewritten prose is allowed; the existing bio is kept as an exact comparison snapshot', () => {
  const bio = 'I make **tiny games**.\n\nCoffee is non-negotiable.';
  const revised = 'I make **tiny games**, and coffee is non-negotiable. I like a climbing puzzle, even if it takes an hour to solve one move.';
  const result = validateProposal(bio, messages, { introMarkdown: revised, changeSummary: 'Wove in the climbing detail.', sourceIds: ['bio', 'a1'], suggestedTags: [] });
  assert.equal(result.introMarkdown, revised);
  assert.equal(result.baseMarkdown, bio);
  assert.ok(!result.introMarkdown.includes(messages[1].content));
});
test('empty drafts, unknown sources, assistant sources and unsupported tag references fail closed', () => {
  const valid = { introMarkdown: 'A real draft.', changeSummary: 'Revised.', sourceIds: ['a1'], suggestedTags: [] };
  for (const sourceIds of [['fake'], ['q1'], ['a1', 'a1'], []]) {
    assert.throws(() => validateProposal('', messages, { ...valid, sourceIds }), /INVALID_AI_PROPOSAL/);
  }
  assert.throws(() => validateProposal('Existing bio', messages, valid), /INVALID_AI_PROPOSAL/);
  assert.throws(() => validateProposal('', messages, { ...valid, introMarkdown: '  ' }), /INVALID_AI_PROPOSAL/);
  for (const tag of [{ code: 'edm', sourceId: 'a2' }, { code: 'made_up', sourceId: 'a1' }]) {
    assert.throws(() => validateProposal('', messages, { ...valid, suggestedTags: [tag] }), /INVALID_AI_PROPOSAL/);
  }
});
test('an existing bio alone can be edited and cited without interview answers', () => {
  const result = validateProposal('I read. I also climb.', [], { introMarkdown: 'I read and climb.', changeSummary: 'Combined two sentences.', sourceIds: ['bio'], suggestedTags: [{ code: 'books', sourceId: 'bio' }] });
  assert.equal(result.introMarkdown, 'I read and climb.');
});
test('OpenRouter receives strict structured output requests and provider routing preferences', async () => {
  const fetcher = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'test/model');
    assert.deepEqual(body.reasoning, { effort: 'high', exclude: true });
    assert.ok(body.max_tokens >= 8192);
    assert.deepEqual(body.provider, { require_parameters: true, data_collection: 'deny' });
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.messages, [{ role: 'system', content: 'instructions' }, { role: 'user', content: '{"bio":"original"}' }]);
    return response({ question: 'What caught your attention?' });
  }) as typeof fetch;
  assert.deepEqual(await structuredResponse(config(), 'instructions', { bio: 'original' }, 'questr_question', {}, fetcher), { question: 'What caught your attention?' });
});
test('provider errors, malformed JSON and truncated completions cannot become drafts', async () => {
  const responses = [
    new Response('{}', { status: 429 }), new Response('not json'),
    new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"question":"partial"}' } }] })),
    new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] })),
  ];
  for (const value of responses) await assert.rejects(structuredResponse(config(), '', {}, 'test', {}, (async () => value) as typeof fetch), /ASSISTANT_UNAVAILABLE/);
});
test('both the first question and follow-ups are generated from current bio and full history', async () => {
  let calls = 0;
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'openai/gpt-6-luna');
    assert.deepEqual(body.reasoning, { effort: 'medium', exclude: true });
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.currentBio, calls ? 'Updated bio about climbing.' : 'I build tiny games about trains.');
    assert.deepEqual(input.transcript, calls ? messages.map(({ role, content }) => ({ role, content })) : []);
    calls++;
    return response({ question: calls === 1 ? 'What does a player do on your trains?' : 'Did you find a way past that move?' });
  }) as typeof fetch;
  const assistant = new Interviewer(config(), fetcher);
  assert.equal(await assistant.question([], 'I build tiny games about trains.'), 'What does a player do on your trains?');
  assert.equal(await assistant.question(messages, 'Updated bio about climbing.'), 'Did you find a way past that move?');
  assert.equal(calls, 2);
});
test('draft generation receives the bio, permits rewriting, and maps opaque evidence IDs back', async () => {
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'test/model');
    assert.deepEqual(body.reasoning, { effort: 'high', exclude: true });
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.currentBio, { id: 'bio', markdown: 'I make tiny games.' });
    assert.equal(input.transcript[1].id, 'answer_2');
    assert.ok(!JSON.stringify(input).includes('q1'));
    return response({ introMarkdown: 'I make tiny games and enjoy puzzling over a climbing move.', changeSummary: 'Connected making games with the climbing story.', sourceIds: ['bio', 'answer_2'], suggestedTags: [{ code: 'indoor_climbing', sourceId: 'answer_2' }] });
  }) as typeof fetch;
  const result = await new Interviewer(config(), fetcher).proposal(messages, 'I make tiny games.');
  assert.equal(result.introMarkdown, 'I make tiny games and enjoy puzzling over a climbing move.');
  assert.deepEqual(result.sourceIds, ['bio', 'a1']);
  assert.equal(result.suggestedTags[0].sourceId, 'a1');
  assert.equal(result.baseMarkdown, 'I make tiny games.');
});
test('oversized context fails before sending any text to the provider', async () => {
  const assistant = new Interviewer(config(), (async () => { throw new Error('Must not be called'); }) as typeof fetch);
  await assert.rejects(assistant.question([], 'x'.repeat(120001)), /AI_CONTEXT_TOO_LONG/);
  await assert.rejects(assistant.proposal(messages, 'x'.repeat(120001)), /AI_CONTEXT_TOO_LONG/);
});
test('offline demo preserves existing text and excludes skip commands', () => {
  assert.match(demoQuestion([], 'I like bouldering.'), /climbing/);
  const proposal = demoProposal([...messages, { id: 'skip', role: 'user', content: 'Please skip this topic and ask me a different question.', createdAt: '' }], 'My existing text.');
  assert.ok(proposal.introMarkdown.startsWith('My existing text.'));
  assert.ok(!proposal.sourceIds.includes('skip'));
});

test('topic changes are explicit controls in model context and cannot be cited as bio facts', async () => {
  const control: ChatMessage = { id: 'change', role: 'user', kind: 'change_topic', content: '', createdAt: '' };
  const fetcher = (async (_url: string, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    assert.equal(input.topicChangeRequested, true);
    assert.deepEqual(input.transcript.at(-1), { role: 'user', action: 'change_topic' });
    assert.deepEqual(input.selectedInterests, ['EDM', 'Tiny games']);
    assert.equal(input.openingAngle, null);
    return response({ question: 'What kind of music do you like?' });
  }) as typeof fetch;
  await new Interviewer(config(), fetcher).question([...messages, control], 'I like climbing.', false, [{ kind: 'catalog', code: 'edm' }, { kind: 'custom', label: 'Tiny games', emoji: '🕹️', locale: 'en' }]);
  assert.throws(() => validateProposal('', [control], { introMarkdown: 'Invented bio.', changeSummary: 'Edited.', sourceIds: ['change'], suggestedTags: [] }), /INVALID_AI_PROPOSAL/);
  await assert.rejects(new Interviewer(config(), fetcher).proposal([control], ''), /MORE_DETAIL_NEEDED/);
  assert.equal(demoProposal([control], 'My own bio.').introMarkdown, 'My own bio.');
});

test('each new interview asks the model for an opening with a fresh starting angle', async () => {
  let calls = 0;
  const angles = new Set<string>();
  const assistant = new Interviewer(config(), (async (_url: string, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    assert.equal(input.topicChangeRequested, false);
    assert.ok(input.openingAngle.length > 10);
    angles.add(input.openingAngle);
    assert.deepEqual(input.transcript, []);
    calls++;
    return response({ question: calls === 1 ? 'What do you make time for?' : 'What would you like company for?' });
  }) as typeof fetch);
  assert.notEqual(await assistant.question([], ''), await assistant.question([], ''));
  assert.equal(calls, 2);
  assert.equal(angles.size, 2);
});
