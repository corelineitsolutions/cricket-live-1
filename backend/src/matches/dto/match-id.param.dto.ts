import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Sportmonks fixture id (digits), or the legacy backend id (cuid) for stored matches. */
export const MATCH_ID_PARAM_PATTERN = /^(?:[1-9]\d{0,11}|c[a-z0-9]{20,40})$/;
export const SPORTMONKS_ID_PATTERN = /^[1-9]\d{0,11}$/;

export class MatchIdParamDto {
  @ApiProperty({ example: '61521', description: 'matchId from any match response (Sportmonks fixture id).' })
  @IsString()
  @Matches(MATCH_ID_PARAM_PATTERN, { message: 'id must be a numeric match id' })
  id!: string;
}
