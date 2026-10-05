import { DevicePlatform } from '@prisma/client';
import { FirebaseService } from '../firebase/firebase.service';
import { FakeDb } from '../testing/fake-db';
import { FakeFirebase } from '../testing/fake-firebase';
import { FCM_BATCH_SIZE, FcmService } from './fcm.service';
import { maskToken } from './fcm.mapper';
import { FcmRepository } from './fcm.repository';

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function setup() {
  const db = new FakeDb();
  const firebase = new FakeFirebase();
  const service = new FcmService(new FcmRepository(db.asPrisma()), firebase as unknown as FirebaseService);
  return { db, firebase, service };
}

describe('FcmService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a device without returning its FCM token', async () => {
    const { db, service } = setup();

    const result = await service.registerDevice({
      deviceId: 'device-123456',
      fcmToken: TOKEN_A,
      platform: 'android',
      appVersion: '1.0.0',
    });

    expect(result).toEqual({
      deviceId: 'device-123456',
      platform: 'android',
      appVersion: '1.0.0',
      isActive: true,
      lastSeenAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN_A);
    expect(db.rows.fcmDevice).toHaveLength(1);
    expect(db.rows.fcmDevice[0]).toMatchObject({ fcmToken: TOKEN_A, platform: DevicePlatform.ANDROID, isActive: true });
  });

  it('updates the same row when the device registers again with a new token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const { db, service } = setup();
    await service.registerDevice({ deviceId: 'device-123456', fcmToken: TOKEN_A, platform: 'android', appVersion: '1.0.0' });
    await service.deactivateDevice('device-123456');

    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    const result = await service.registerDevice({
      deviceId: 'device-123456',
      fcmToken: TOKEN_B,
      platform: 'ios',
      appVersion: '1.1.0',
    });

    expect(db.rows.fcmDevice).toHaveLength(1);
    expect(db.rows.fcmDevice[0]).toMatchObject({
      fcmToken: TOKEN_B,
      platform: DevicePlatform.IOS,
      appVersion: '1.1.0',
      isActive: true,
      lastSeenAt: new Date('2026-10-01T12:00:00.000Z'),
    });
    expect(result).toMatchObject({ platform: 'ios', isActive: true, lastSeenAt: '2026-10-01T12:00:00.000Z' });
  });

  it('deactivates an older device that held the same token', async () => {
    const { db, service } = setup();
    await service.registerDevice({ deviceId: 'old-install-1', fcmToken: TOKEN_A, platform: 'android' });
    await service.registerDevice({ deviceId: 'new-install-2', fcmToken: TOKEN_A, platform: 'android' });

    const byId = Object.fromEntries(db.rows.fcmDevice.map((row) => [row.deviceId, row.isActive]));
    expect(byId).toEqual({ 'old-install-1': false, 'new-install-2': true });
  });

  it('deactivates without deleting, and 404s for unknown devices', async () => {
    const { db, service } = setup();
    await service.registerDevice({ deviceId: 'device-123456', fcmToken: TOKEN_A, platform: 'android' });

    await expect(service.deactivateDevice('device-123456')).resolves.toMatchObject({ isActive: false });
    expect(db.rows.fcmDevice).toHaveLength(1);
    await expect(service.deactivateDevice('unknown-device')).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('sends to active devices only and deactivates tokens Firebase rejects', async () => {
    const { db, firebase, service } = setup();
    await service.registerDevice({ deviceId: 'device-aaaaaa', fcmToken: TOKEN_A, platform: 'android' });
    await service.registerDevice({ deviceId: 'device-bbbbbb', fcmToken: TOKEN_B, platform: 'ios' });
    await service.registerDevice({ deviceId: 'device-cccccc', fcmToken: 'fcm-token-cccccccccccccccccccc', platform: 'ios' });
    await service.deactivateDevice('device-cccccc');
    firebase.failures.set(TOKEN_B, 'messaging/registration-token-not-registered');

    const result = await service.sendToDevices(['device-aaaaaa', 'device-bbbbbb', 'device-cccccc'], {
      title: 'Match started',
      body: 'MUM vs DEL is live',
      data: { matchId: '61521' },
    });

    expect(result).toEqual({ targeted: 2, sent: 1, failed: 1, deactivated: 1, skipped: null });
    expect(firebase.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [TOKEN_A, TOKEN_B], data: { matchId: '61521' } }),
    );
    expect(db.rows.fcmDevice.find((row) => row.deviceId === 'device-bbbbbb')?.isActive).toBe(false);
  });

  it('keeps tokens after transient Firebase errors', async () => {
    const { db, firebase, service } = setup();
    await service.registerDevice({ deviceId: 'device-aaaaaa', fcmToken: TOKEN_A, platform: 'android' });
    firebase.failures.set(TOKEN_A, 'messaging/internal-error');

    const result = await service.sendToDevice('device-aaaaaa', { title: 'Result', body: 'MUM won by 5 runs' });

    expect(result).toMatchObject({ sent: 0, failed: 1, deactivated: 0 });
    expect(db.rows.fcmDevice[0]?.isActive).toBe(true);
  });

  it('splits large sends into batches of 500', async () => {
    const { db, firebase, service } = setup();
    const ids = Array.from({ length: FCM_BATCH_SIZE + 20 }, (_, i) => `device-${String(i).padStart(6, '0')}`);
    for (const deviceId of ids) {
      db.rows.fcmDevice.push({ id: deviceId, deviceId, fcmToken: `fcm-token-${deviceId}`, isActive: true });
    }

    const result = await service.sendToDevices(ids, { title: 'Hello', body: 'World' });

    expect(firebase.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ targeted: ids.length, sent: ids.length });
  });

  it('skips delivery when Firebase is not configured', async () => {
    const { firebase, service } = setup();
    firebase.configured = false;

    await expect(service.sendToDevice('device-aaaaaa', { title: 'Hi', body: 'There' })).resolves.toMatchObject({
      skipped: 'firebase_not_configured',
      sent: 0,
    });
    expect(firebase.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('rejects an empty notification', async () => {
    const { service } = setup();
    await expect(service.sendToDevice('device-aaaaaa', { title: ' ', body: 'x' })).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('masks tokens for admin views', () => {
    expect(maskToken(TOKEN_A)).toBe('fcm-to…aaaa');
    expect(maskToken('short')).toBe('****');
  });
});
