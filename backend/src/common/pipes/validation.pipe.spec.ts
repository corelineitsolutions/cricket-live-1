import { HttpException } from '@nestjs/common';
import { PaginationQueryDto } from '../dto/pagination.dto';
import { createValidationPipe } from './validation.pipe';

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('rejects fields that are not on the DTO', async () => {
    await expect(
      pipe.transform(
        { page: 1, limit: 20, extra: true },
        { type: 'body', metatype: PaginationQueryDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(HttpException);

    try {
      await pipe.transform(
        { page: 1, limit: 20, extra: true },
        { type: 'body', metatype: PaginationQueryDto, data: '' },
      );
    } catch (error) {
      const response = (error as HttpException).getResponse() as { code: string; errors: string[] };
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.errors.join(' ')).toContain('extra');
    }
  });

  it('converts numeric query strings', async () => {
    const result = (await pipe.transform(
      { page: '2', limit: '10' },
      { type: 'query', metatype: PaginationQueryDto, data: '' },
    )) as PaginationQueryDto;

    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });
});
