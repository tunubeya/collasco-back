import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Ip,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { PublicTicketsService } from './public-tickets.service';
import { Public } from '../auth/public.decorator';
import { FileInterceptor } from '@nestjs/platform-express';

@Public()
@Controller('public/tickets')
export class PublicTicketsController {
  constructor(private readonly publicTicketsService: PublicTicketsService) {}

  @Get('links/:token')
  validateLink(@Param('token') token: string) {
    return this.publicTicketsService.validateLink(token);
  }

  @Post('links/:token')
  createTicket(
    @Param('token') token: string,
    @Body() body: { title: string; content: string; email: string },
    @Ip() ip: string,
  ) {
    return this.publicTicketsService.createTicket(token, body, ip);
  }

  @Get('follow/:followUpToken')
  getTicketForFollowUp(@Param('followUpToken') followUpToken: string) {
    return this.publicTicketsService.getTicketForFollowUp(followUpToken);
  }

  @Post('follow/:followUpToken/sections')
  addSection(
    @Param('followUpToken') followUpToken: string,
    @Body() body: { type: 'RESPONSE' | 'COMMENT'; content: string },
    @Ip() ip: string,
  ) {
    return this.publicTicketsService.addSection(followUpToken, body, ip);
  }

  @Post('follow/:followUpToken/images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('followUpToken') followUpToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Ip() ip: string,
  ) {
    return this.publicTicketsService.uploadImage(followUpToken, file, name, ip);
  }

  @Patch('follow/:followUpToken/sections/:sectionId')
  updateSection(
    @Param('followUpToken') followUpToken: string,
    @Param('sectionId') sectionId: string,
    @Body() body: { content: string },
  ) {
    return this.publicTicketsService.updateSection(followUpToken, sectionId, body);
  }
}
