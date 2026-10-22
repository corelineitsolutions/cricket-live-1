import { Injectable } from '@nestjs/common';
import { ProPaymentStatus, ProPlanCode, ProPurchase } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type CreateProPurchaseInput = {
  deviceId: string;
  phone: string;
  email: string | null;
  planCode: ProPlanCode;
  razorpayPlanId: string;
  razorpayOrderId: string;
  amountPaise: number;
};

@Injectable()
export class BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPurchase(input: CreateProPurchaseInput): Promise<ProPurchase> {
    return this.prisma.proPurchase.create({
      data: {
        deviceId: input.deviceId,
        phone: input.phone,
        email: input.email,
        planCode: input.planCode,
        razorpayPlanId: input.razorpayPlanId,
        razorpayOrderId: input.razorpayOrderId,
        amountPaise: input.amountPaise,
        currency: 'INR',
        status: ProPaymentStatus.CREATED,
      },
    });
  }

  findByOrderId(razorpayOrderId: string): Promise<ProPurchase | null> {
    return this.prisma.proPurchase.findUnique({ where: { razorpayOrderId } });
  }

  markPaid(params: {
    id: string;
    razorpayPaymentId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<ProPurchase> {
    return this.prisma.proPurchase.update({
      where: { id: params.id },
      data: {
        status: ProPaymentStatus.PAID,
        razorpayPaymentId: params.razorpayPaymentId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
      },
    });
  }

  markFailed(id: string): Promise<ProPurchase> {
    return this.prisma.proPurchase.update({
      where: { id },
      data: { status: ProPaymentStatus.FAILED },
    });
  }

  /** Latest still-active paid Pro for this device. */
  findActiveProByDeviceId(deviceId: string, now = new Date()): Promise<ProPurchase | null> {
    return this.prisma.proPurchase.findFirst({
      where: {
        deviceId,
        status: ProPaymentStatus.PAID,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });
  }

  /** Latest still-active paid Pro for this phone (cross-device). */
  findActiveProByPhone(phone: string, now = new Date()): Promise<ProPurchase | null> {
    return this.prisma.proPurchase.findFirst({
      where: {
        phone,
        status: ProPaymentStatus.PAID,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });
  }

  /** Point the paid row at a new install so status?deviceId= works without re-entering phone. */
  attachDevice(id: string, deviceId: string): Promise<ProPurchase> {
    return this.prisma.proPurchase.update({
      where: { id },
      data: { deviceId },
    });
  }
}
