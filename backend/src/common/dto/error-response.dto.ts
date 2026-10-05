import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success!: boolean;

  @ApiProperty({ example: 'Resource not found' })
  message!: string;

  @ApiProperty({ example: 'RESOURCE_NOT_FOUND' })
  code!: string;

  @ApiPropertyOptional({ type: [String] })
  errors?: string[];
}
