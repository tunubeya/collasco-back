import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/auth/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
