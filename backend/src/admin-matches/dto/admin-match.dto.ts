import { ApiProperty } from '@nestjs/swagger';
import { MatchDto } from '../../matches/dto/match.dto';

export class AdminLiveMatchDto extends MatchDto {
  @ApiProperty({ type: String, nullable: true, example: 'clx0abc123def456ghi789jkl', description: 'Backend (MySQL) id. Null until the metadata row exists.' })
  internalId!: string | null;

  @ApiProperty({ example: 812, description: 'WebSocket subscribers for this match across all instances.' })
  subscribers!: number;
}

export class AdminLiveBoardDto {
  @ApiProperty({ type: [AdminLiveMatchDto] })
  matches!: AdminLiveMatchDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Last successful Sportmonks poll.' })
  updatedAt!: string | null;

  @ApiProperty({ example: false })
  stale!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'live', description: 'Live-score worker state.' })
  workerState!: string | null;
}

export class AdminLiveBoardEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdminLiveBoardDto })
  data!: AdminLiveBoardDto;
}

export class AdminStoredMatchDto extends MatchDto {
  @ApiProperty({ example: 'clx0abc123def456ghi789jkl' })
  internalId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CacheEntryDto {
  @ApiProperty({ example: true })
  cached!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cachedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 24, description: 'Seconds until the cached copy expires.' })
  expiresInSeconds!: number | null;
}

export class MatchCacheStateDto {
  @ApiProperty({ type: CacheEntryDto, description: 'Stored-match cache used by GET /matches/{id} when the match is not live.' })
  details!: CacheEntryDto;

  @ApiProperty({ type: CacheEntryDto })
  scorecard!: CacheEntryDto;

  @ApiProperty({ type: CacheEntryDto })
  commentary!: CacheEntryDto;
}

export class AdminMatchDetailDto {
  @ApiProperty({ example: 61521, description: 'Sportmonks fixture id (the public matchId).' })
  matchId!: number;

  @ApiProperty({ type: String, nullable: true })
  internalId!: string | null;

  @ApiProperty({ example: true, description: 'Listed in the live feed right now.' })
  inLiveFeed!: boolean;

  @ApiProperty({ type: AdminLiveMatchDto, nullable: true, description: 'Snapshot in Redis, exactly as written by the worker from Sportmonks.' })
  live!: AdminLiveMatchDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When the worker last wrote the snapshot.' })
  liveWrittenAt!: string | null;

  @ApiProperty({ type: AdminStoredMatchDto, nullable: true, description: 'Row in MySQL.' })
  stored!: AdminStoredMatchDto | null;

  @ApiProperty({ type: MatchCacheStateDto, nullable: true, description: 'Null when Redis is unavailable.' })
  cache!: MatchCacheStateDto | null;
}

export class AdminMatchDetailEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdminMatchDetailDto })
  data!: AdminMatchDetailDto;
}
