export const LLM_FETCH = Symbol('LLM_FETCH');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export const AiErrorCode = {
  DISABLED: 'AI_DISABLED',
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  BUDGET_EXHAUSTED: 'AI_BUDGET_EXHAUSTED',
  BUSY: 'AI_BUSY',
  TIMEOUT: 'AI_TIMEOUT',
  PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
} as const;

export const AI_DISCLAIMER = {
  en: 'AI answers can be wrong. Check the scorecard for official figures.',
  hi: 'AI के उत्तर गलत हो सकते हैं। आधिकारिक आंकड़ों के लिए स्कोरकार्ड देखें।',
} as const;
