import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { IApiKeyAuth } from '@waha/core/auth/auth';
import { SessionActions } from '@waha/core/auth/casl.types';
import { HeaderOrQueryApiKeyStrategy } from '@waha/core/auth/HeaderOrQueryApiKeyStrategy';
import { ApiKeyAuthService } from './ApiKeyAuthService';
import {
  DASHBOARD_SESSION_MARKER,
  DashboardSessionAuth,
} from './DashboardSessionAuth';
import { IncomingMessage } from 'http';

export interface User {
  isAdmin: boolean;
  session?: string;
  actions?: SessionActions | null;
}

function AdminUser(): User {
  return {
    isAdmin: true,
    session: null,
  };
}

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(
  HeaderOrQueryApiKeyStrategy,
) {
  constructor(
    private auth: IApiKeyAuth,
    private apiKeyService: ApiKeyAuthService,
    private dashboardSession: DashboardSessionAuth,
  ) {
    // @ts-ignore — PassportStrategy mixin doesn't forward constructor arg types
    super(true, (apikey, done, request) => {
      return this.validate(apikey, done, request);
    });
  }

  validate(
    apikey: string,
    done: (err?, user?: User) => void,
    request?: IncomingMessage,
  ): void {
    this.user(apikey, request)
      .then((user) => done(null, user))
      .catch((err) => done(err, null));
  }

  async user(apikey: string, request?: IncomingMessage): Promise<User> {
    if (apikey === DASHBOARD_SESSION_MARKER) {
      if (this.dashboardSession.isValid(request)) {
        return AdminUser();
      }
      return null;
    }
    if (this.auth.isValid(apikey)) {
      return AdminUser();
    }
    return this.apiKeyService.get(apikey);
  }
}
