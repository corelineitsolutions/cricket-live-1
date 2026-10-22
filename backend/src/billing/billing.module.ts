import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { RazorpayClient } from './razorpay.client';

@Module({
  controllers: [BillingController],
  providers: [BillingRepository, BillingService, RazorpayClient],
  exports: [BillingService],
})
export class BillingModule {}
