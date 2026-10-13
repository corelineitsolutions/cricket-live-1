import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { FeedsModule } from '../feeds/feeds.module';
import { HistoryModule } from '../history/history.module';
import { IdentityModule } from '../identity/identity.module';
import { MatchesModule } from '../matches/matches.module';
import { AdminAiController } from './admin-ai.controller';
import { LLM_FETCH, LLM_PROVIDER } from './ai.constants';
import { AiController } from './ai.controller';
import { aiReadiness, AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { LlmProvider } from './llm/llm.types';
import { MockLlmProvider } from './llm/mock-llm.provider';
import { LlmFetch, OpenAiCompatibleProvider, validateLlmBaseUrl } from './llm/openai-compatible.provider';

@Module({
  imports: [MatchesModule, IdentityModule, HistoryModule, FeedsModule],
  controllers: [AiController, AdminAiController],
  providers: [
    AiService,
    AiUsageService,
    { provide: LLM_FETCH, useValue: ((input, init) => fetch(input, init)) satisfies LlmFetch },
    {
      provide: LLM_PROVIDER,
      inject: [AppConfigService, LLM_FETCH],
      useFactory: (config: AppConfigService, fetchFn: LlmFetch): LlmProvider | null => {
        if (config.llmProvider === 'mock') return new MockLlmProvider();
        // Never call a real provider unless it is fully configured, including a token budget.
        if (!config.aiEnabled || !aiReadiness(config).ready) return null;
        return new OpenAiCompatibleProvider(
          validateLlmBaseUrl(config.llmBaseUrl)!,
          config.llmApiKey,
          config.llmModel,
          config.llmTimeoutMs,
          fetchFn,
        );
      },
    },
  ],
})
export class AiModule {}
