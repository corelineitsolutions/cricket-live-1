import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { serviceUnavailable, validationError } from '../common/utils/http-errors';

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

/**
 * Thin Razorpay Orders + signature helper (no subscription API).
 * Plan ids from the dashboard are stored as metadata; amounts are fixed in pro-plans.ts.
 */
@Injectable()
export class RazorpayClient {
  constructor(private readonly config: AppConfigService) {}

  assertConfigured(): void {
    if (!this.config.razorpayConfigured) {
      throw serviceUnavailable('Razorpay is not configured');
    }
  }

  async createOrder(params: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder> {
    this.assertConfigured();
    const auth = Buffer.from(`${this.config.razorpayKeyId}:${this.config.razorpayKeySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: 'INR',
        receipt: params.receipt.slice(0, 40),
        notes: params.notes,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const description =
        typeof body.error === 'object' && body.error && 'description' in body.error
          ? String((body.error as { description?: string }).description)
          : `Razorpay order failed (${res.status})`;
      throw serviceUnavailable(description);
    }

    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      throw serviceUnavailable('Razorpay order response missing id');
    }

    return {
      id,
      amount: Number(body.amount ?? params.amountPaise),
      currency: String(body.currency ?? 'INR'),
      status: String(body.status ?? 'created'),
    };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    this.assertConfigured();
    const expected = createHmac('sha256', this.config.razorpayKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }

  requireValidSignature(orderId: string, paymentId: string, signature: string): void {
    if (!this.verifyPaymentSignature(orderId, paymentId, signature)) {
      throw validationError('Invalid Razorpay payment signature');
    }
  }
}
