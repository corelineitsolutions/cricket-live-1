import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    return super.shouldSkip(context);
  }

  /** `/feeds/:endpoint` serves every feed from one handler; each feed gets its own counter. */
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const endpoint = context.switchToHttp().getRequest<{ params?: Record<string, unknown> }>().params?.endpoint;
    const scoped = typeof endpoint === 'string' && endpoint ? `${suffix}-${endpoint.toLowerCase()}` : suffix;
    return super.generateKey(context, scoped, name);
  }
}
