import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { DeactivateDeviceDto } from './dto/deactivate-device.dto';
import { DeviceEnvelopeDto } from './dto/device.response.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { FcmService } from './fcm.service';

@ApiTags('Devices')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limit exceeded (code TOO_MANY_REQUESTS).' })
@Controller({ path: 'devices', version: '1' })
export class FcmController {
  constructor(private readonly devices: FcmService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register or update this device for push notifications',
    description: [
      'Anonymous. Call on app start and whenever Firebase issues a new FCM token.',
      'The device is identified by deviceId: calling again updates the token, platform, appVersion and lastSeenAt of the same record and re-activates it. It never creates duplicates.',
      'Push notifications are for notification features only; live scores arrive over the WebSocket.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: DeviceEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid fields (VALIDATION_ERROR).' })
  register(@Body() dto: RegisterDeviceDto) {
    return this.devices.registerDevice(dto);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop push notifications for this device',
    description: 'For example when the user turns notifications off. The record is kept; registering again re-activates it.',
  })
  @ApiOkResponse({ type: DeviceEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown deviceId (RESOURCE_NOT_FOUND).' })
  deactivate(@Body() dto: DeactivateDeviceDto) {
    return this.devices.deactivateDevice(dto.deviceId);
  }
}
