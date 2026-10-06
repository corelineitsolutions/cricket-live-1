import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Numeric Latiyal id (as found in match payloads) or the backend id from list endpoints. */
export const ENTITY_ID_PATTERN = /^(?:[1-9]\d{0,11}|c[a-z0-9]{20,40})$/;

export class EntityIdParamDto {
  @ApiProperty({
    example: '101',
    description: 'The sportmonksId from a match payload (recommended), or the backend id returned by list endpoints.',
  })
  @IsString()
  @Matches(ENTITY_ID_PATTERN, { message: 'id must be a numeric id or a backend id' })
  id!: string;
}
