import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../fcm/dto/register-device.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Pass phone and/or deviceId (at least one).
 * Pro follows the phone number; deviceId is a convenience after pay / restore.
 */
export class ProStatusQueryDto {
  @ApiPropertyOptional({
    description: 'Install id. Optional if phone is sent.',
    example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04',
  })
  @Transform(trim)
  @ValidateIf((o: ProStatusQueryDto) => !o.phone)
  @IsString({ message: 'Provide deviceId and/or phone' })
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'Phone used at purchase. Preferred key for Pro across devices (no OTP).',
    example: '9876543210',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^\+?[0-9\s-]{8,20}$/, { message: 'phone must be 8–20 digits (optional + / spaces / dashes)' })
  phone?: string;
}
