import {
  Injectable,
  Module,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { Request, Response, NextFunction } from 'express';
import { Auth } from '@waha/core/auth/config';
import { HashAuth, PlainApiKeyAuth } from '@waha/core/auth/auth';
import { AppBootstrapModule } from '@waha/plugins/app.bootstrap.module';
import { AppBootstrapService } from '@waha/plugins/AppBootstrapService';
import { HttpPathsModule } from '@waha/plugins/http.paths.module';
import { HttpPathsService } from '@waha/plugins/HttpPathsService';
import { McpOAuthConfig, readOAuthConfig, resourceMetadataUrl } from './config';
import { AccessTokenVerifier, createOAuthVerifier } from './verifier';

@Injectable()
export class McpOAuthService implements OnModuleInit {
  readonly config: McpOAuthConfig | null = readOAuthConfig();
  private verifier: AccessTokenVerifier;
  private apiKey: string;

  constructor(bootstrap: AppBootstrapService, paths: HttpPathsService) {
    if (!this.config) {
      return;
    }
    this.apiKey = Auth.keyplain.value;
    if (!this.apiKey || !Auth.key.value) {
      throw new Error(
        'MCP OAuth requires a WAHA API key and its plaintext WAHA_API_KEY_PLAIN',
      );
    }
    let auth: HashAuth | PlainApiKeyAuth;
    if (Auth.key.value.startsWith('sha512:')) {
      auth = new HashAuth(Auth.key.value.slice(7), 'sha512');
    } else {
      auth = new PlainApiKeyAuth(Auth.key.value);
    }
    if (!auth.isValid(this.apiKey)) {
      throw new Error('WAHA_API_KEY_PLAIN does not match WAHA_API_KEY');
    }
    const metadataPath = new URL(resourceMetadataUrl(this.config)).pathname;
    paths.register(
      { prefix: metadataPath, include: { authBasic: false } },
      {
        prefix: '/.well-known/oauth-protected-resource',
        include: { authBasic: false },
      },
    );
    bootstrap.register((app) => {
      app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
        return this.authenticate(req, res, next);
      });
      const express = app.getHttpAdapter().getInstance();
      const metadata = (req: Request, res: Response) => {
        if (!this.validateRequest(req, res)) {
          return;
        }
        res.set('Cache-Control', 'no-store').json({
          resource: this.config.resourceUrl,
          authorization_servers: [this.config.issuer],
          scopes_supported: this.config.scopes,
          bearer_methods_supported: ['header'],
        });
      };
      express.get(metadataPath, metadata);
      express.get('/.well-known/oauth-protected-resource', metadata);
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.config) {
      this.verifier = await createOAuthVerifier(this.config);
    }
  }

  private validateRequest(req: Request, res: Response): boolean {
    const resource = new URL(this.config.resourceUrl);
    if (
      req.headers.host !== resource.host ||
      (req.headers.origin !== undefined &&
        !this.config.allowedOrigins.includes(req.headers.origin))
    ) {
      res.status(403).json({ error: 'invalid_request' });
      return false;
    }
    return true;
  }

  async authenticate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.validateRequest(req, res)) {
      return;
    }
    res.set(
      'Access-Control-Expose-Headers',
      'WWW-Authenticate, MCP-Protocol-Version',
    );
    // Reject credentials in URLs, duplicate headers and ambiguous bearer syntax.
    const authorizations = req.rawHeaders.filter(function(value, index) {
      return index % 2 === 0 && value.toLowerCase() === 'authorization';
    });
    if (
      req.query.access_token !== undefined ||
      req.query['x-api-key'] !== undefined ||
      authorizations.length > 1 ||
      (req.headers.authorization &&
        !/^Bearer [A-Za-z0-9\-._~+/]+=*$/i.test(req.headers.authorization))
    ) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!this.verifier) {
      res.status(503).json({ error: 'temporarily_unavailable' });
      return;
    }
    await requireBearerAuth({
      verifier: this.verifier,
      requiredScopes: this.config.scopes,
      resourceMetadataUrl: resourceMetadataUrl(this.config),
    })(req, res, next);
  }

  getApiKey(req: Request): string | undefined {
    if (!this.config) {
      return req.headers['x-api-key'] as string | undefined;
    }
    if (!req.auth) {
      throw new UnauthorizedException();
    }
    return this.apiKey;
  }
}

@Module({
  imports: [AppBootstrapModule, HttpPathsModule],
  providers: [McpOAuthService],
  exports: [McpOAuthService],
})
export class McpOAuthModule {}
