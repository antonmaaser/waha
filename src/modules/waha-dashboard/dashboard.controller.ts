import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  DASHBOARD_SESSION_MARKER,
  DashboardSessionAuth,
} from '@waha/core/auth/DashboardSessionAuth';
import { dashboardBootstrap } from '@waha/modules/waha-dashboard/dashboard.bootstrap';
import { Request, Response } from 'express';

@Controller('dashboard')
@ApiExcludeController()
export class DashboardBootstrapController {
  constructor(private sessions: DashboardSessionAuth) {}

  @Get('bootstrap.js')
  bootstrap(@Req() request: Request, @Res() response: Response): void {
    if (!this.sessions.enabled) {
      throw new NotFoundException();
    }
    const origin = this.sessions.origin(request);
    if (!origin) {
      throw new ForbiddenException();
    }
    response.set({
      'Cache-Control': 'no-store',
      Vary: 'Authorization, Cookie, Origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    response.cookie(
      this.sessions.cookieName(origin),
      this.sessions.issue(origin),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: origin.startsWith('https:'),
        path: '/',
        maxAge: this.sessions.lifetime,
      },
    );
    response
      .type('application/javascript')
      .send(
        `(${dashboardBootstrap.toString()})(${JSON.stringify(
          DASHBOARD_SESSION_MARKER,
        )}, ${Math.min(60_000, this.sessions.lifetime / 2)});`,
      );
  }
}
