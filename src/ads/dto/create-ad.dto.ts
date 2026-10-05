import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdPlacement } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAdDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  title!: string;

  @ApiProperty()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(512)
  imageUrl!: string;

  @ApiProperty()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(512)
  clickUrl!: string;

  @ApiProperty({ enum: AdPlacement })
  @IsEnum(AdPlacement)
  placement!: AdPlacement;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  priority: number = 0;

  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startAt?: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endAt?: Date | null;
}
