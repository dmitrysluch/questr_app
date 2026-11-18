export interface Config {
  databaseUrl: string; port: number; appOrigin: string; locationCatalogPath: string; communityCatalogPath: string;
  authMode: 'demo' | 'telegram'; aiMode: 'demo' | 'openrouter';
  openrouterApiKey: string; openrouterModel: string; openrouterQuestionModel: string; openrouterReviewModel: string;
  openrouterReasoningEffort: ReasoningEffort; openrouterQuestionReasoningEffort: ReasoningEffort; openrouterReviewReasoningEffort: ReasoningEffort; botToken: string;
  webhookSecret: string; publicAppUrl: string; secureCookie: boolean; googleMapsBrowserKey: string;
  brevoApiKey: string; brevoSenderEmail: string;
}
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
function effort(value: string, name: string): ReasoningEffort {
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)) throw new Error(`Invalid ${name}`);
  return value as ReasoningEffort;
}
export function loadConfig(): Config {
  const authMode = process.env.AUTH_MODE ?? 'demo';
  const aiMode = process.env.AI_MODE ?? 'demo';
  if (!['demo', 'telegram'].includes(authMode) || !['demo', 'openrouter'].includes(aiMode)) throw new Error('Use AUTH_MODE=demo|telegram and AI_MODE=demo|openrouter');
  const config: Config = {
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://questr:questr_local@localhost:55432/questr',
    locationCatalogPath: process.env.LOCATION_CATALOG_PATH ?? './local/locations.json',
    communityCatalogPath: process.env.COMMUNITY_CATALOG_PATH ?? './local/communities.json',
    port: Number(process.env.PORT ?? 5181), appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
    authMode: authMode as Config['authMode'], aiMode: aiMode as Config['aiMode'],
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '', openrouterModel: process.env.OPENROUTER_MODEL ?? 'openai/gpt-6.1-terra',
    openrouterQuestionModel: process.env.OPENROUTER_QUESTION_MODEL ?? 'openai/gpt-6-luna',
    openrouterReviewModel: process.env.OPENROUTER_REVIEW_MODEL ?? 'openai/gpt-6-luna',
    openrouterReasoningEffort: effort(process.env.OPENROUTER_REASONING_EFFORT ?? 'high', 'OPENROUTER_REASONING_EFFORT'),
    openrouterQuestionReasoningEffort: effort(process.env.OPENROUTER_QUESTION_REASONING_EFFORT ?? 'medium', 'OPENROUTER_QUESTION_REASONING_EFFORT'),
    openrouterReviewReasoningEffort: effort(process.env.OPENROUTER_REVIEW_REASONING_EFFORT ?? 'low', 'OPENROUTER_REVIEW_REASONING_EFFORT'),
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '', webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    publicAppUrl: process.env.PUBLIC_APP_URL ?? '', secureCookie: process.env.COOKIE_SECURE === 'true',
    googleMapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY ?? '',
    brevoApiKey: process.env.BREVO_API_KEY ?? '', brevoSenderEmail: process.env.BREVO_SENDER_EMAIL ?? '',
  };
  if (config.authMode === 'telegram' && !config.botToken) throw new Error('TELEGRAM_BOT_TOKEN is required in telegram mode');
  if (config.aiMode === 'openrouter' && !config.openrouterApiKey) throw new Error('OPENROUTER_API_KEY is required in openrouter mode');
  if (config.authMode === 'demo' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.appOrigin).hostname)) throw new Error('Demo authentication is limited to a localhost APP_ORIGIN');
  if (new URL(config.appOrigin).protocol === 'https:' && !config.secureCookie) throw new Error('Set COOKIE_SECURE=true for HTTPS');
  return config;
}
