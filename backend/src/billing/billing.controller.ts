import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { BillingService } from './billing.service';
import { CreateProOrderDto } from './dto/create-pro-order.dto';
import {
  ProOrderResponseDto,
  ProPlansResponseDto,
  ProStatusResponseDto,
  ProVerifyResponseDto,
} from './dto/pro.response.dto';
import { ProStatusQueryDto } from './dto/pro-status.query.dto';
import { RestoreProDto } from './dto/restore-pro.dto';
import { VerifyProPaymentDto } from './dto/verify-pro-payment.dto';

@ApiTags('Pro / Razorpay')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'pro', version: '1' })
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'List Pro plans (₹999 / 6 months, ₹1799 / 1 year)',
    description: 'Paywall UI: show these two packages. Amounts are fixed; razorpayPlanId comes from server env.',
  })
  @ApiOkResponse({ type: ProPlansResponseDto })
  listPlans() {
    return this.billing.listPlans();
  }

  @Post('order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Razorpay order for Pro',
    description: [
      'Call after the user enters phone (email optional) and picks a plan.',
      'Open Razorpay Checkout with razorpayKeyId + razorpayOrderId + amountPaise.',
      'Then POST /pro/verify with the Checkout success fields.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: ProOrderResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'Razorpay not configured or API error.' })
  createOrder(@Body() dto: CreateProOrderDto) {
    return this.billing.createOrder(dto);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Razorpay payment and activate Pro',
    description: 'Checks HMAC signature, marks the purchase PAID, sets startsAt/endsAt. Idempotent if already paid.',
  })
  @ApiOkResponse({ type: ProVerifyResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Bad signature or device mismatch.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  verify(@Body() dto: VerifyProPaymentDto) {
    return this.billing.verifyPayment(dto);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Pro entitlement by phone and/or deviceId',
    description: [
      'Pro follows the phone number used at payment (no OTP).',
      'Pass phone and/or deviceId (at least one). Phone wins when both are sent.',
      'When isPro is true, the frontend must show 0 ads.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: ProStatusResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  status(@Query() query: ProStatusQueryDto) {
    return this.billing.status({ deviceId: query.deviceId, phone: query.phone });
  }

  @Post('restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore Pro on a new phone using the paid phone number',
    description: [
      'No OTP. User enters the same phone they paid with; we attach this deviceId to that Pro.',
      'Then GET /pro/status?deviceId= works on this install without asking for phone again.',
      'Anyone who knows the number can restore — acceptable until OTP is added.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: ProStatusResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  restore(@Body() dto: RestoreProDto) {
    return this.billing.restore(dto);
  }
}
