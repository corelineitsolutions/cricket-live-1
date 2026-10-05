import { PaginationMetaDto } from '../dto/pagination.dto';

export function buildPagination(page: number, limit: number, total: number): PaginationMetaDto {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
