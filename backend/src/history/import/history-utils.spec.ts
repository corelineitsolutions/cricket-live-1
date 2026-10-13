import { venueKey } from './prisma-history.store';
import { safeErrorMessage } from './safe-error';

describe('venueKey', () => {
  it('normalises case and whitespace but keeps different cities apart', () => {
    expect(venueKey('  Old  Trafford ', 'Manchester')).toBe('old trafford|manchester');
    expect(venueKey('Old Trafford', 'manchester')).toBe(venueKey('OLD TRAFFORD', 'Manchester'));
    expect(venueKey('Old Trafford', null)).not.toBe(venueKey('Old Trafford', 'Manchester'));
    expect(venueKey('Old Trafford, Manchester', null)).not.toBe(venueKey('Old Trafford', 'Manchester'));
  });

  it('stays within the column length for very long names', () => {
    const key = venueKey('x'.repeat(300), 'y');
    expect(key.length).toBeLessThanOrEqual(191);
    expect(key).not.toBe(venueKey(`${'x'.repeat(299)}z`, 'y'));
  });
});

describe('safeErrorMessage', () => {
  it('redacts connection strings and credential pairs', () => {
    const message = safeErrorMessage(
      Object.assign(new Error('Can not reach mysql://admin:s3cret@db.example.com:25060/cricketdb password=abc'), {
        code: 'P1001',
      }),
    );
    expect(message).toContain('P1001');
    expect(message).not.toMatch(/s3cret|admin:|abc|db\.example\.com/);
  });
});
