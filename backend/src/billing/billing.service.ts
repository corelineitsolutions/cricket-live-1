import { Injectable } from '@nestjs/common';
import { ProPaymentStatus, ProPlanCode } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { notFound, serviceUnavailable, validationError } from '../common/utils/http-errors';
import { BillingRepository } from './billing.repository';
import { CreateProOrderDto } from './dto/create-pro-order.dto';
import {
  ProOrderResponseDto,
  ProPlanDto,
  ProStatusResponseDto,
  ProVerifyResponseDto,
} from './dto/pro.response.dto';
import { VerifyProPaymentDto } from './dto/verify-pro-payment.dto';
import { PRO_PLANS, proPlanByCode } from './pro-plans';
import { RazorpayClient } from './razorpay.client';

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

@Injectable()
export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly razorpay: RazorpayClient,
    private readonly config: AppConfigService,
  ) {}

  listPlans(): { plans: ProPlanDto[] } {
    return {
      plans: PRO_PLANS.map((p) => ({
        code: p.code,
        label: p.label,
        durationMonths: p.durationMonths,
        amountInr: p.amountInr,
        amountPaise: p.amountPaise,
        currency: 'INR',
        razorpayPlanId: this.razorpayPlanIdFor(p.code),
      })),
    };
  }

  async createOrder(dto: CreateProOrderDto): Promise<ProOrderResponseDto> {
    this.razorpay.assertConfigured();
    const plan = proPlanByCode(dto.planCode);
    if (!plan) {
      throw validationError('Unknown planCode');
    }

    const razorpayPlanId = this.razorpayPlanIdFor(plan.code);
    if (!razorpayPlanId) {
      throw serviceUnavailable(`Razorpay plan id not set for ${plan.code}`);
    }

    const phone = normalizePhone(dto.phone);
    const email = dto.email?.trim().toLowerCase() || null;
    const receipt = `pro_${dto.deviceId}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);

    const order = await this.razorpay.createOrder({
      amountPaise: plan.amountPaise,
      receipt,
      notes: {
        planCode: plan.code,
        deviceId: dto.deviceId,
        phone,
        razorpayPlanId,
      },
    });

    const purchase = await this.repo.createPurchase({
      deviceId: dto.deviceId,
      phone,
      email,
      planCode: plan.code as ProPlanCode,
      razorpayPlanId,
      razorpayOrderId: order.id,
      amountPaise: plan.amountPaise,
    });

    return {
      razorpayOrderId: order.id,
      razorpayKeyId: this.config.razorpayKeyId,
      amountPaise: plan.amountPaise,
      currency: 'INR',
      planCode: plan.code,
      planLabel: plan.label,
      razorpayPlanId,
      purchaseId: purchase.id,
      prefill: {
        contact: phone,
        ...(email ? { email } : {}),
      },
    };
  }

  async verifyPayment(dto: VerifyProPaymentDto): Promise<ProVerifyResponseDto> {
    this.razorpay.assertConfigured();
    this.razorpay.requireValidSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);

    const purchase = await this.repo.findByOrderId(dto.razorpayOrderId);
    if (!purchase) {
      throw notFound('Unknown Razorpay order');
    }
    if (purchase.deviceId !== dto.deviceId) {
      throw validationError('deviceId does not match this order');
    }

    if (purchase.status === ProPaymentStatus.PAID && purchase.startsAt && purchase.endsAt) {
      return {
        isPro: true,
        planCode: purchase.planCode,
        startsAt: purchase.startsAt.toISOString(),
        endsAt: purchase.endsAt.toISOString(),
        purchaseId: purchase.id,
      };
    }

    const plan = proPlanByCode(purchase.planCode);
    if (!plan) {
      throw validationError('Purchase has unknown plan');
    }

    const startsAt = new Date();
    const endsAt = addMonths(startsAt, plan.durationMonths);
    const paid = await this.repo.markPaid({
      id: purchase.id,
      razorpayPaymentId: dto.razorpayPaymentId,
      startsAt,
      endsAt,
    });

    return {
      isPro: true,
      planCode: paid.planCode,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      purchaseId: paid.id,
    };
  }

  /**
   * Pro is keyed by phone. deviceId is optional convenience after pay / restore.
   * Prefer phone when both are sent.
   */
  async status(params: { deviceId?: string; phone?: string }): Promise<ProStatusResponseDto> {
    const phone = params.phone ? normalizePhone(params.phone) : undefined;
    if (!phone && !params.deviceId) {
      throw validationError('Provide deviceId and/or phone');
    }

    let active = phone ? await this.repo.findActiveProByPhone(phone) : null;
    if (!active && params.deviceId) {
      active = await this.repo.findActiveProByDeviceId(params.deviceId);
    }

    if (!active?.endsAt) {
      return { isPro: false, planCode: null, phone: null, startsAt: null, endsAt: null };
    }
    return {
      isPro: true,
      planCode: active.planCode,
      phone: active.phone,
      startsAt: active.startsAt?.toISOString() ?? null,
      endsAt: active.endsAt.toISOString(),
    };
  }

  /**
   * New phone: user enters the same number they paid with → attach this deviceId to that Pro.
   * No OTP. Anyone who knows the number can restore (by design for now).
   */
  async restore(dto: { deviceId: string; phone: string }): Promise<ProStatusResponseDto> {
    const phone = normalizePhone(dto.phone);
    const active = await this.repo.findActiveProByPhone(phone);
    if (!active?.endsAt) {
      return { isPro: false, planCode: null, phone: null, startsAt: null, endsAt: null };
    }

    if (active.deviceId !== dto.deviceId) {
      await this.repo.attachDevice(active.id, dto.deviceId);
    }

    return {
      isPro: true,
      planCode: active.planCode,
      phone: active.phone,
      startsAt: active.startsAt?.toISOString() ?? null,
      endsAt: active.endsAt.toISOString(),
    };
  }

  private razorpayPlanIdFor(code: string): string {
    if (code === 'SIX_MONTH') return this.config.razorpayPlan6mId;
    if (code === 'ONE_YEAR') return this.config.razorpayPlan1yId;
    return '';
  }
}
