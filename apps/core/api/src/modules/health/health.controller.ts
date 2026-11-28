import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', version: '0.1.0' } } })
  health(): { status: 'ok'; version: string } { return { status: 'ok', version: '0.1.0' }; }
}
