import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DEVICE_ID_PATTERN } from './register-device.dto';

export class DeactivateDeviceDto {
  @ApiProperty({ example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04', description: 'The deviceId used at registration.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;
}
