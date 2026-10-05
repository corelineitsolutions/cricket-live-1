import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminOnly } from '../common/guards/admin-auth.guard';
import { AdminDeviceListEnvelopeDto } from './dto/device.response.dto';
import { ListDevicesQueryDto } from './dto/list-devices.query.dto';
import { FcmService } from './fcm.service';

@ApiTags('Admin devices')
@AdminOnly()
@Controller({ path: 'admin/devices', version: '1' })
export class AdminDevicesController {
  constructor(private readonly devices: FcmService) {}

  @Get()
  @ApiOperation({
    summary: 'List registered devices',
    description: 'Newest activity first. FCM tokens are masked (fcmTokenMasked); full tokens are never returned.',
  })
  @ApiOkResponse({ type: AdminDeviceListEnvelopeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid filter (VALIDATION_ERROR).' })
  async list(@Query() query: ListDevicesQueryDto) {
    const result = await this.devices.listForAdmin(query);
    return { data: result.items, meta: result.meta };
  }
}
