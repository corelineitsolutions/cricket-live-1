import { ApiProperty } from '@nestjs/swagger';
import { AdPlacement } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

export class AdResponseDto {
  @ApiProperty({ example: 'clx1ad000000000000000001' })
  id!: string;

  @ApiProperty({ example: 'Season tickets on sale' })
  title!: string;

  @ApiProperty({ example: 'https://cdn.example.com/ads/banner.png' })
  imageUrl!: string;

  @ApiProperty({ example: 'https://example.com/tickets', description: 'Open in the browser when the ad is tapped.' })
  clickUrl!: string;

  @ApiProperty({ enum: AdPlacement, example: AdPlacement.HOME_BANNER, description: 'Where in the app the ad belongs.' })
  placement!: AdPlacement;

  @ApiProperty({ example: 10, description: 'Higher first. Lists are already sorted by priority.' })
  priority!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Shown from this time. Null: no start limit.' })
  startAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Shown until this time. Null: no end limit.' })
  endAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminAdResponseDto extends AdResponseDto {
  @ApiProperty({
    example: true,
    description: 'True when the public API serves this ad right now (isActive and inside startAt/endAt).',
  })
  isVisibleNow!: boolean;
}

export class AdListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdminAdResponseDto] })
  data!: AdminAdResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class AdminAdDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdminAdResponseDto })
  data!: AdminAdResponseDto;
}

export class DeletedAdDto {
  @ApiProperty({ example: 'clx1ad000000000000000001' })
  id!: string;
}

export class DeletedAdEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: DeletedAdDto })
  data!: DeletedAdDto;
}

export class ActiveAdListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdResponseDto] })
  data!: AdResponseDto[];
}

export class AdDetailsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdResponseDto })
  data!: AdResponseDto;
}
