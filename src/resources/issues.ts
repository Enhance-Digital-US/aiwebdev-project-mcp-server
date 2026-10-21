import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { Store } from '../store.js';

export function registerIssueResources(server: McpServer, store: Store) {
  server.registerResource(
    'all-issues',
    'tracker://issues/list',
    { description: 'List all issues across all projects' },
    async (uri) => {
      const projects = await store.listProjects();
      const allIssues = (await Promise.all(projects.map(p => store.listIssues(p.id)))).flat();
      return { contents: [{ uri: uri.href, text: JSON.stringify(allIssues, null, 2) }] };
    },
  );

  server.registerResource(
    'issue-detail',
    new ResourceTemplate('tracker://issues/{issueId}', { list: undefined }),
    { description: 'Get a single issue with its comments' },
    async (uri, params) => {
      const issueId = params.issueId as string;
      const issue = await store.getIssue(issueId);
      if (!issue) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'Issue not found' }) }] };
      }
      const comments = await store.listComments(issueId);
      return { contents: [{ uri: uri.href, text: JSON.stringify({ ...issue, comments }, null, 2) }] };
    },
  );
}
