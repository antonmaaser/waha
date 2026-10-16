import { AppModule } from '@waha/apps/app_sdk/apps/definition';
import { AppName } from '@waha/apps/app_sdk/apps/apps';
import { McpController } from '@waha/apps/mcp/api/mcp.controller';
import { McpService } from '@waha/apps/mcp/mcp.service';
import { McpAppService } from '@waha/apps/mcp/services/McpAppService';
import { HttpPathsRegistration } from '@waha/plugins/http.paths.module';
import { McpOAuthModule } from './oauth/oauth.module';
import { oauthEnabled } from './oauth/config';

const McpAppModule: AppModule = {
  name: AppName.mcp,
  openapi: {
    title: 'MCP',
    description: 'Model Context Protocol (MCP) server for AI clients',
  },
  definition: {
    plainkey: false,
    queue: false,
    migrations: false,
    restartOnChange: false,
    unique: false,
  },
  nestjs: {
    imports: [
      McpOAuthModule,
      HttpPathsRegistration(
        { prefix: '/mcp', include: { authBasic: false } },
        { prefix: 'mcp', include: { authApiKey: !oauthEnabled() } },
      ),
    ],
    controllers: [McpController],
    providers: [McpService, McpAppService],
  },
  Service: McpAppService,
};

export default McpAppModule;
