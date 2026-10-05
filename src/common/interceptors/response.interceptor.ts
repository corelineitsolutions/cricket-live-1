import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

function isPaginated(value: unknown): value is { data: unknown; meta: { page: number; total: number } } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (!('data' in record) || !('meta' in record) || !record.meta || typeof record.meta !== 'object') {
    return false;
  }

  const meta = record.meta as Record<string, unknown>;
  return typeof meta.page === 'number' && typeof meta.total === 'number';
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((value) => {
        if (isPaginated(value)) {
          return { success: true, data: value.data, meta: value.meta };
        }
        return { success: true, data: value };
      }),
    );
  }
}
