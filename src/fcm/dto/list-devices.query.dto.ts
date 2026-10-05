import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { DEVICE_ID_PATTERN, DEVICE_PLATFORMS, DevicePlatformValue } from './register-device.dto';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const lowerCase = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class ListDevicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of a deviceId (case-sensitive).', example: '6f1c0b3e' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'search may contain letters, digits, _ . : - only' })
  search?: string;

  @ApiPropertyOptional({ enum: DEVICE_PLATFORMS })
  @IsOptional()
  @Transform(lowerCase)
  @IsIn(DEVICE_PLATFORMS)
  platform?: DevicePlatformValue;

  @ApiPropertyOptional({ type: Boolean, description: 'true: active only, false: inactive only, omit: both.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'date-time', description: 'Last seen at or after this time.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastSeenFrom?: Date;

  @ApiPropertyOptional({ format: 'date-time', description: 'Last seen at or before this time.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastSeenTo?: Date;

  @ApiPropertyOptional({ format: 'date-time', description: 'Registered at or after this time.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({ format: 'date-time', description: 'Registered at or before this time.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTo?: Date;
}
