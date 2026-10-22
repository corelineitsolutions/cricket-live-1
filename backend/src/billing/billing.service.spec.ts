import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PRO_PLANS } from './pro-plans';

function makeService(overrides?: {
  plan6m?: string;
  plan1y?: string;
  keyId?: string;
  keySecret?: string;
  active?: Awaited<ReturnType<BillingService['status']>> extends infer _R ? unknown : never;
}) {
  const keySecret = overrides?.keySecret ?? 'test_secret';
  const repo = {
    createPurchase: vi.fn(),
    findByOrderId: vi.fn(),
    markPaid: vi.fn(),
    markFailed: vi.fn(),
    findActiveProByDeviceId: vi.fn().mockResolvedValue(null),
    findActiveProByPhone: vi.fn().mockResolvedValue(null),
    attachDevice: vi.fn(),
  };
  const razorpay = {
    assertConfigured: vi.fn(),
    createOrder: vi.fn(),
    requireValidSignature: vi.fn(),
    verifyPaymentSignature: vi.fn((orderId: string, paymentId: string, signature: string) => {
      const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
      return expected === signature;
    }),
  };
  // Wire requireValidSignature to throw like the real client
  razorpay.requireValidSignature.mockImplementation((orderId: string, paymentId: string, signature: string) => {
    if (!razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
      throw new HttpException({ success: false, message: 'Invalid Razorpay payment signature', code: 'VALIDATION_ERROR' }, 400);
    }
  });

  const config = {
    razorpayKeyId: overrides?.keyId ?? 'rzp_test_key',
    razorpayKeySecret: keySecret,
    razorpayPlan6mId: overrides?.plan6m ?? 'plan_6m',
    razorpayPlan1yId: overrides?.plan1y ?? 'plan_1y',
    razorpayConfigured: true,
  };

  const service = new BillingService(repo as never, razorpay as never, config as never);
  return { service, repo, razorpay, config };
}

describe('BillingService', () => {
  it('lists both fixed Pro plans', () => {
    const { service } = makeService();
    const { plans } = service.listPlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.code)).toEqual(['SIX_MONTH', 'ONE_YEAR']);
    expect(plans[0].amountInr).toBe(999);
    expect(plans[1].amountInr).toBe(1799);
    expect(plans[0].razorpayPlanId).toBe('plan_6m');
  });

  it('creates an order and stores a CREATED purchase', async () => {
    const { service, repo, razorpay } = makeService();
    razorpay.createOrder.mockResolvedValue({ id: 'order_1', amount: 99900, currency: 'INR', status: 'created' });
    repo.createPurchase.mockResolvedValue({ id: 'pur_1' });

    const out = await service.createOrder({
      deviceId: 'device-test-0001',
      phone: '98765 43210',
      email: 'User@Example.com',
      planCode: 'SIX_MONTH',
    });

    expect(out.razorpayOrderId).toBe('order_1');
    expect(out.amountPaise).toBe(PRO_PLANS[0].amountPaise);
    expect(out.prefill?.contact).toBe('9876543210');
    expect(repo.createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-test-0001',
        phone: '9876543210',
        email: 'user@example.com',
        planCode: 'SIX_MONTH',
        razorpayOrderId: 'order_1',
      }),
    );
  });

  it('verify activates Pro for 6 months', async () => {
    const { service, repo, razorpay, config } = makeService();
    const orderId = 'order_1';
    const paymentId = 'pay_1';
    const signature = createHmac('sha256', config.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');

    repo.findByOrderId.mockResolvedValue({
      id: 'pur_1',
      deviceId: 'device-test-0001',
      planCode: 'SIX_MONTH',
      status: 'CREATED',
      startsAt: null,
      endsAt: null,
    });
    repo.markPaid.mockImplementation(async (p: { id: string; startsAt: Date; endsAt: Date }) => ({
      id: p.id,
      planCode: 'SIX_MONTH',
      startsAt: p.startsAt,
      endsAt: p.endsAt,
    }));

    const out = await service.verifyPayment({
      deviceId: 'device-test-0001',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    });

    expect(out.isPro).toBe(true);
    expect(out.planCode).toBe('SIX_MONTH');
    expect(razorpay.requireValidSignature).toHaveBeenCalled();
    const paidArgs = repo.markPaid.mock.calls[0][0] as { startsAt: Date; endsAt: Date };
    const months =
      (paidArgs.endsAt.getUTCFullYear() - paidArgs.startsAt.getUTCFullYear()) * 12 +
      (paidArgs.endsAt.getUTCMonth() - paidArgs.startsAt.getUTCMonth());
    expect(months).toBe(6);
  });

  it('status returns isPro false when no active purchase', async () => {
    const { service } = makeService();
    await expect(service.status({ deviceId: 'device-test-0001' })).resolves.toEqual({
      isPro: false,
      planCode: null,
      phone: null,
      startsAt: null,
      endsAt: null,
    });
  });

  it('status finds Pro by phone across devices', async () => {
    const { service, repo } = makeService();
    const endsAt = new Date('2027-04-22T12:00:00.000Z');
    const startsAt = new Date('2026-10-22T12:00:00.000Z');
    repo.findActiveProByPhone.mockResolvedValue({
      planCode: 'SIX_MONTH',
      phone: '9876543210',
      startsAt,
      endsAt,
    });

    await expect(service.status({ phone: '98765 43210' })).resolves.toEqual({
      isPro: true,
      planCode: 'SIX_MONTH',
      phone: '9876543210',
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  });

  it('restore attaches new deviceId to phone Pro', async () => {
    const { service, repo } = makeService();
    const endsAt = new Date('2027-04-22T12:00:00.000Z');
    const startsAt = new Date('2026-10-22T12:00:00.000Z');
    repo.findActiveProByPhone.mockResolvedValue({
      id: 'pur_1',
      deviceId: 'old-device-0001',
      planCode: 'ONE_YEAR',
      phone: '9876543210',
      startsAt,
      endsAt,
    });
    repo.attachDevice.mockResolvedValue({});

    const out = await service.restore({ deviceId: 'new-device-0002', phone: '9876543210' });
    expect(out.isPro).toBe(true);
    expect(repo.attachDevice).toHaveBeenCalledWith('pur_1', 'new-device-0002');
  });
});
