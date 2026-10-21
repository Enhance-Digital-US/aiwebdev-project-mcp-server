import { McpServer } from '@modelcontextprotocol/server';
import type { ServerEventBus } from '@modelcontextprotocol/server';
import type { Store } from './store.js';
import { registerIssueTools } from './tools/issues.js';
import { registerProjectTools } from './tools/projects.js';
import { registerIssueResources } from './resources/issues.js';
import { registerProjectResources } from './resources/projects.js';
import { registerPrompts } from './prompts/index.js';

export function createServer(store: Store, bus?: ServerEventBus): McpServer {
  const server = new McpServer(
    { name: 'issue-tracker', version: '1.0.0' },
    {
      instructions:
        'Issue tracker MCP server. Use tools to manage projects and issues. ' +
        'Resources expose project boards, issue details, and activity feeds. ' +
        'Prompts help with triage, sprint summaries, and bug reports.',
      cacheHints: {
        'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'prompts/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'resources/list': { ttlMs: 60_000, cacheScope: 'private' },
        'resources/templates/list': { ttlMs: 3_600_000, cacheScope: 'public' },
      },
    },
  );

  registerIssueTools(server, store, bus);
  registerProjectTools(server, store, bus);
  registerIssueResources(server, store);
  registerProjectResources(server, store);
  registerPrompts(server);

  return server;
}
