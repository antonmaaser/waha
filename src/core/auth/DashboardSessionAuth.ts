import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { compare } from '@waha/core/auth/auth';
import { Auth } from '@waha/core/auth/config';
import { parseBool } from '@waha/helpers';
import { createHash, createHmac, randomBytes } from 'crypto';
import { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as path from 'path';

// A public selector, not a credential. It is useless without a valid session.
export const DASHBOARD_SESSION_MARKER = 'waha-dashboard-session';

@Injectable()
export class DashboardSessionAuth implements OnModuleInit {
  private signingKey: Buffer;

  onModuleInit(): void {
    if (this.enabled) {
      this.signingKey = this.loadSigningKey();
    }
  }

  get enabled(): boolean {
    return (
      parseBool(process.env.WAHA_DASHBOARD_ENABLED ?? 'true') &&
      parseBool(process.env.WAHA_DASHBOARD_AUTO_AUTH ?? 'true')
    );
  }

  private get loginProtected(): boolean {
    return !!Auth.dashboard.username.value && !!Auth.dashboard.password.value;
  }

  get lifetime(): number {
    return Number(process.env.WAHA_DASHBOARD_SESSION_TTL ?? 43200) * 1000;
  }

  // Require browser origin evidence; do not trust forwarded hosts or Referer alone
  // when the browser explicitly identifies a cross-origin request.
  origin(request: IncomingMessage, websocket = false): string | null {
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') {
      return null;
    }
    const source = request.headers.origin ?? request.headers.referer;
    const host = request.headers.host;
    if (!source || !host) {
      return null;
    }
    try {
      const url = new URL(source);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return null;
      }
      const target = new URL(`${url.protocol}//${host}`);
      if (url.host !== target.host || url.username || url.password) {
        return null;
      }
      if (!this.loginProtected) {
        const loopback = ['localhost', '127.0.0.1', '[::1]'];
        // WebSocket handshakes carry Origin but browsers omit Fetch Metadata.
        const browserHandshake =
          websocket &&
          request.headers.upgrade?.toLowerCase() === 'websocket' &&
          !!request.headers.origin;
        if (
          (!browserHandshake && site !== 'same-origin') ||
          !loopback.includes(url.hostname)
        ) {
          return null;
        }
      }
      return url.origin;
    } catch {
      return null;
    }
  }

  cookieName(origin: string): string {
    const suffix = createHash('sha256')
      .update(origin)
      .digest('hex')
      .slice(0, 12);
    return `waha_dashboard_session_${suffix}`;
  }

  issue(origin: string): string {
    const expires = Date.now() + this.lifetime;
    const nonce = randomBytes(16).toString('hex');
    const payload = `${expires}.${nonce}`;
    return `${payload}.${this.sign(origin, payload)}`;
  }

  isValid(request?: IncomingMessage): boolean {
    if (!this.enabled || !request) {
      return false;
    }
    const originalUrl =
      (request as IncomingMessage & { originalUrl?: string }).originalUrl ??
      request.url ??
      '/';
    let pathname: string;
    try {
      pathname = new URL(originalUrl, 'http://localhost').pathname;
    } catch {
      return false;
    }
    if (
      pathname !== '/ws' &&
      pathname !== '/health' &&
      pathname !== '/api' &&
      !pathname.startsWith('/api/')
    ) {
      return false;
    }
    const origin = this.origin(request, pathname === '/ws');
    if (!origin) {
      return false;
    }
    const name = this.cookieName(origin);
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map(function(value) {
        return value.trim();
      })
      .filter(function(value) {
        return value.startsWith(`${name}=`);
      });
    if (cookies.length !== 1) {
      return false;
    }
    const value = cookies[0].slice(name.length + 1);
    if (!/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) {
      return false;
    }
    const [expires, nonce, signature] = value.split('.');
    const remaining = Number(expires) - Date.now();
    if (remaining <= 0 || remaining > this.lifetime) {
      return false;
    }
    return compare(signature, this.sign(origin, `${expires}.${nonce}`));
  }

  private sign(origin: string, payload: string): string {
    // Independent of the API key: rotating it does not interrupt Dashboard tabs.
    // Changing Dashboard credentials invalidates existing sessions.
    const credentials = JSON.stringify([
      Auth.dashboard.username.value,
      Auth.dashboard.password.value,
    ]);
    return createHmac('sha256', this.signingKey)
      .update('waha-dashboard-session-v1\0')
      .update(credentials)
      .update('\0')
      .update(origin)
      .update('\0')
      .update(payload)
      .digest('hex');
  }

  private loadSigningKey(): Buffer {
    const directory = process.env.WAHA_LOCAL_STORE_BASE_DIR || './.sessions';
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, '.dashboard-session-secret');
    if (!fs.existsSync(filename)) {
      const temporary = `${filename}.${randomBytes(16).toString('hex')}`;
      fs.writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: 'wx' });
      try {
        // Publish only a complete file; another process may have created it first.
        try {
          fs.linkSync(temporary, filename);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
          }
        }
      } finally {
        fs.unlinkSync(temporary);
      }
    }
    const descriptor = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0) {
        throw new Error('Dashboard signing key must be a private 32-byte file');
      }
      return fs.readFileSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}

@Module({
  providers: [DashboardSessionAuth],
  exports: [DashboardSessionAuth],
})
export class DashboardSessionAuthModule {}
