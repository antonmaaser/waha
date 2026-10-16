import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from '../mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  post(@Req() req: Request, @Res() res: Response) {
    return this.mcp.handlePost(req, res);
  }

  @Get()
  get(@Res() res: Response) {
    res
      .set('Allow', 'POST')
      .status(405)
      .end();
  }

  @Delete()
  delete(@Res() res: Response) {
    res
      .set('Allow', 'POST')
      .status(405)
      .end();
  }
}
