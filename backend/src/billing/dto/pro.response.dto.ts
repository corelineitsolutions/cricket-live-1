import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRO_PLAN_CODES, ProPlanCodeValue } from '../pro-plans';

export class ProPlanDto {
  @ApiProperty({ enum: PRO_PLAN_CODES })
  code!: ProPlanCodeValue;

  @ApiProperty({ example: '6 months' })
  label!: string;

  @ApiProperty({ example: 6 })
  durationMonths!: number;

  @ApiProperty({ example: 999, description: 'Display price in INR.' })
  amountInr!: number;

  @ApiProperty({ example: 99900, description: 'Amount in paise for Razorpay Checkout.' })
  amountPaise!: number;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ example: 'plan_Mw...', description: 'Razorpay plan id from env (for reference).' })
  razorpayPlanId!: string;
}

export class ProPlansResponseDto {
  @ApiProperty({ type: [ProPlanDto] })
  plans!: ProPlanDto[];
}

export class ProOrderResponseDto {
  @ApiProperty({ example: 'order_MwXYZ...' })
  razorpayOrderId!: string;

  @ApiProperty({ description: 'Publishable key for Razorpay Checkout (rzp_…).' })
  razorpayKeyId!: string;

  @ApiProperty({ example: 99900 })
  amountPaise!: number;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ enum: PRO_PLAN_CODES })
  planCode!: ProPlanCodeValue;

  @ApiProperty({ example: '6 months' })
  planLabel!: string;

  @ApiProperty({ example: 'plan_Mw...' })
  razorpayPlanId!: string;

  @ApiProperty({ description: 'Our purchase row id.' })
  purchaseId!: string;

  @ApiPropertyOptional({ description: 'Prefill for Checkout.' })
  prefill?: { contact: string; email?: string };
}

export class ProVerifyResponseDto {
  @ApiProperty({ example: true })
  isPro!: boolean;

  @ApiProperty({ enum: PRO_PLAN_CODES })
  planCode!: ProPlanCodeValue;

  @ApiProperty({ description: 'ISO start of entitlement.' })
  startsAt!: string;

  @ApiProperty({ description: 'ISO end of entitlement; after this isPro becomes false.' })
  endsAt!: string;

  @ApiProperty()
  purchaseId!: string;
}

export class ProStatusResponseDto {
  @ApiProperty({ description: 'True while a paid Pro window covers now. Frontend: hide all ads when true.' })
  isPro!: boolean;

  @ApiPropertyOptional({ enum: PRO_PLAN_CODES })
  planCode!: ProPlanCodeValue | null;

  @ApiPropertyOptional({ description: 'Phone the Pro purchase is tied to.' })
  phone!: string | null;

  @ApiPropertyOptional()
  startsAt!: string | null;

  @ApiPropertyOptional()
  endsAt!: string | null;
}
