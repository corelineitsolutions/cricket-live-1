import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdPlacement } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ActiveAdsQueryDto {
  @ApiPropertyOptional({ enum: AdPlacement, description: 'Only ads for this placement. Omit to get every active ad.' })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;
}

export class ListAdsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdPlacement })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
