import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';
import { verifyPassword } from '../common/utils/password';
import { AdminAuthService } from './admin-auth.service';
import { AdminsRepository } from './admins.repository';
import { LoginAttemptsService } from './login-attempts.service';

vi.mock('../common/utils/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$12$dummyhashdummyhashdummyhashdummyhashdummyha'),
  verifyPassword: vi.fn(),
}));

describe('AdminAuthService', () => {
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') } as unknown as JwtService;
  const config = { jwtExpiresIn: '8h' } as AppConfigService;
  const attempts = {
    assertNotLocked: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(1),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const activeAdmin = { id: 'admin-1', email: 'admin@example.com', isActive: true, passwordHash: 'stored-hash' };
  const make = (admins: unknown) =>
    new AdminAuthService(admins as AdminsRepository, jwt, config, attempts as unknown as LoginAttemptsService);

  beforeEach(() => {
    vi.mocked(verifyPassword).mockReset();
    Object.values(attempts).forEach((fn) => fn.mockClear());
  });

  it('returns a bearer token for an active admin and clears failures', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const service = make({ findByEmail: vi.fn().mockResolvedValue(activeAdmin) });

    await expect(service.login({ email: 'admin@example.com', password: 'correct-password' })).resolves.toEqual({
      accessToken: 'signed-token',
      tokenType: 'Bearer',
      expiresIn: '8h',
    });
    expect(attempts.clear).toHaveBeenCalledWith('admin@example.com');
    expect(attempts.recordFailure).not.toHaveBeenCalled();
  });

  it('uses the same error for an unknown admin and a bad password, and counts the failure', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const service = make({ findByEmail: vi.fn().mockResolvedValue(null) });

    await expect(service.login({ email: 'missing@example.com', password: 'correct-password' })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    });
    expect(verifyPassword).toHaveBeenCalled();
    expect(attempts.recordFailure).toHaveBeenCalledWith('missing@example.com');
  });

  it('rejects an inactive admin even with the right password', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const service = make({ findByEmail: vi.fn().mockResolvedValue({ ...activeAdmin, isActive: false }) });

    await expect(service.login({ email: 'admin@example.com', password: 'correct-password' })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
  });

  it('does not check the password while the email is locked', async () => {
    attempts.assertNotLocked.mockRejectedValueOnce(new Error('locked'));
    const findByEmail = vi.fn();
    const service = make({ findByEmail });

    await expect(service.login({ email: 'admin@example.com', password: 'x' })).rejects.toThrow('locked');
    expect(findByEmail).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
