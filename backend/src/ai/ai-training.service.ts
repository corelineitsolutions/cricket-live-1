import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logEvent } from '../common/utils/structured-log';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

const WEAK_ANSWER =
  /could not|can'?t help|cannot help|no information|don'?t have|do not have|unable to|try again|माफ़|नहीं\s*मिला|डेटा नहीं मिला|Archive answers need/i;

export interface TrainingQuestionInput {
  question: string;
  language: string;
  matchId?: string | null;
  outcome: string;
  toolsUsed?: string[];
  answer?: string | null;
}

/**
 * Opt-in Ask question log for team Hinglish / routing training.
 * Writes only when AI_LOG_QUESTIONS=true. Never throws on the ask path.
 */
@Injectable()
export class AiTrainingService {
  private readonly logger = new Logger(AiTrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async logAsk(input: TrainingQuestionInput): Promise<void> {
    if (!this.config.aiLogQuestions) return;
    const question = input.question.trim().slice(0, 500);
    if (!question) return;
    const answerPreview = (input.answer ?? '').trim().slice(0, 280) || null;
    const toolsUsed = input.toolsUsed ?? [];
    const needsReview =
      input.outcome !== 'answered' || toolsUsed.length === 0 || (answerPreview != null && WEAK_ANSWER.test(answerPreview));
    try {
      await this.prisma.aiTrainingQuestion.create({
        data: {
          question,
          language: input.language.slice(0, 8),
          matchId: input.matchId?.slice(0, 16) || null,
          outcome: input.outcome.slice(0, 32),
          toolsUsed: toolsUsed as Prisma.InputJsonValue,
          answerPreview,
          needsReview,
        },
      });
    } catch {
      logEvent(this.logger, 'warn', 'ai-training-log-failed');
    }
  }

  async list(opts: { limit: number; needsReviewOnly?: boolean }) {
    const where = opts.needsReviewOnly ? { needsReview: true } : undefined;
    const [items, total, reviewCount] = await Promise.all([
      this.prisma.aiTrainingQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
      }),
      this.prisma.aiTrainingQuestion.count(),
      this.prisma.aiTrainingQuestion.count({ where: { needsReview: true } }),
    ]);
    return {
      loggingEnabled: this.config.aiLogQuestions,
      total,
      needsReview: reviewCount,
      items: items.map((row) => ({
        id: row.id,
        question: row.question,
        language: row.language,
        matchId: row.matchId,
        outcome: row.outcome,
        toolsUsed: row.toolsUsed,
        answerPreview: row.answerPreview,
        needsReview: row.needsReview,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
