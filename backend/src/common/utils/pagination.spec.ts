import { buildPagination } from './pagination';

describe('buildPagination', () => {
  it('returns zero pages when there are no rows', () => {
    expect(buildPagination(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('rounds the page count up', () => {
    expect(buildPagination(2, 20, 41).totalPages).toBe(3);
  });
});
