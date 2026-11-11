export interface Config {
  databaseUrl: string; port: number; appOrigin: string;
  authMode: 'demo' | 'telegram'; aiMode: 'demo' | 'openai';
  openaiApiKey: string; openaiModel: string; botToken: string;
  webhookSecret: string; publicAppUrl: string; secureCookie: boolean;
}
export function loadConfig(): Config {
  const authMode = process.env.AUTH_MODE ?? 'demo';
  const aiMode = process.env.AI_MODE ?? 'demo';
  if (!['demo', 'telegram'].includes(authMode) || !['demo', 'openai'].includes(aiMode)) throw new Error('Invalid AUTH_MODE or AI_MODE');
  const config: Config = {
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://questr:questr_local@localhost:55432/questr',
    port: Number(process.env.PORT ?? 5181), appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
    authMode: authMode as Config['authMode'], aiMode: aiMode as Config['aiMode'],
    openaiApiKey: process.env.OPENAI_API_KEY ?? '', openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '', webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    publicAppUrl: process.env.PUBLIC_APP_URL ?? '', secureCookie: process.env.COOKIE_SECURE === 'true',
  };
  if (config.authMode === 'telegram' && !config.botToken) throw new Error('TELEGRAM_BOT_TOKEN is required in telegram mode');
  if (config.aiMode === 'openai' && !config.openaiApiKey) throw new Error('OPENAI_API_KEY is required in openai mode');
  if (config.authMode === 'demo' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.appOrigin).hostname)) throw new Error('Demo authentication is limited to a localhost APP_ORIGIN');
  if (new URL(config.appOrigin).protocol === 'https:' && !config.secureCookie) throw new Error('Set COOKIE_SECURE=true for HTTPS');
  return config;
}
