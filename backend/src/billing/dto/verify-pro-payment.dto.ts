import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../fcm/dto/register-device.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class VerifyProPaymentDto {
  @ApiProperty({
    description: 'Same deviceId used when creating the order.',
    example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04',
  })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;

  @ApiProperty({ example: 'order_MwXYZ...' })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  razorpayOrderId!: string;

  @ApiProperty({ example: 'pay_MwABC...' })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  razorpayPaymentId!: string;

  @ApiProperty({ description: 'HMAC from Razorpay Checkout success callback.' })
  @Transform(trim)
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  razorpaySignature!: string;
}
