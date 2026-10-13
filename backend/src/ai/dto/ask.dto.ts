import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../fcm/dto/register-device.dto';

export const AI_LANGUAGES = ['en', 'hi'] as const;
export const AI_QUESTION_MAX_LENGTH = 500;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AskDto {
  @ApiProperty({
    description: 'The user question. Not stored or logged.',
    example: 'How many runs do they need per over?',
    minLength: 2,
    maxLength: AI_QUESTION_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(AI_QUESTION_MAX_LENGTH)
  question!: string;

  @ApiPropertyOptional({ enum: AI_LANGUAGES, default: 'en', description: 'Answer language: English or Hindi.' })
  @IsOptional()
  @IsIn(AI_LANGUAGES)
  language: (typeof AI_LANGUAGES)[number] = 'en';

  @ApiPropertyOptional({ example: '61521', description: 'Match the user is looking at, so "this match" can be resolved.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @IsString()
  @Matches(/^\d{1,10}$/, { message: 'matchId must be a numeric id' })
  matchId?: string;

  @ApiProperty({
    description: 'The same install id used for POST /devices. Only a keyed hash of it is used, for per-device limits.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;
}

export class AskResultDto {
  @ApiProperty({ example: 'Delhi Royals need 61 runs from 28 balls (required rate 13.07).' })
  answer!: string;

  @ApiProperty({ enum: AI_LANGUAGES })
  language!: string;

  @ApiProperty({ type: [String], example: ['Match 61521'], description: 'Data the answer was based on.' })
  sources!: string[];

  @ApiProperty({ example: true, description: 'True when the answer was produced without an AI model (demo mode).' })
  mocked!: boolean;

  @ApiProperty({ example: 'AI answers can be wrong. Check the scorecard for official figures.' })
  disclaimer!: string;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}

export class AskEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AskResultDto })
  data!: AskResultDto;
}

export class AiStatusDto {
  @ApiProperty({ description: 'False when the assistant is switched off or not configured; hide the AI entry point.' })
  available!: boolean;

  @ApiProperty({ type: [String], example: ['en', 'hi'] })
  languages!: string[];

  @ApiProperty({ example: AI_QUESTION_MAX_LENGTH })
  maxQuestionLength!: number;
}
