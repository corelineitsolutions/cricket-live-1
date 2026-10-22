import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../fcm/dto/register-device.dto';
import { PRO_PLAN_CODES, ProPlanCodeValue } from '../pro-plans';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateProOrderDto {
  @ApiProperty({
    description: 'Stable id for this install (same as FCM deviceId). Pro is tied to this id.',
    example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04',
    minLength: 8,
    maxLength: 128,
  })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;

  @ApiProperty({
    description: 'User phone (digits, optional + / spaces). Required on the Pro screen.',
    example: '9876543210',
    minLength: 8,
    maxLength: 20,
  })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^\+?[0-9\s-]{8,20}$/, { message: 'phone must be 8–20 digits (optional + / spaces / dashes)' })
  phone!: string;

  @ApiPropertyOptional({ description: 'Optional contact email.', example: 'user@example.com' })
  @Transform(lower)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiProperty({ enum: PRO_PLAN_CODES, example: 'SIX_MONTH' })
  @IsIn(PRO_PLAN_CODES)
  planCode!: ProPlanCodeValue;
}
