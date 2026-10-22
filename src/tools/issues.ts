import type { McpServer, ServerEventBus } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Store } from '../store.js';

const StatusEnum = z.enum(['backlog', 'open', 'in_progress', 'review', 'done', 'closed']);
const PriorityEnum = z.enum(['critical', 'high', 'medium', 'low']);

export function registerIssueTools(server: McpServer, store: Store, bus?: ServerEventBus) {
  const notifyBoardChanged = (projectId: string) => {
    bus?.publish({ kind: 'resource_updated', uri: `tracker://projects/${projectId}/board` });
  };

  server.registerTool(
    'create_issue',
    {
      description: 'Create a new issue in a project',
      inputSchema: z.object({
        project_id: z.string().describe('The project to create the issue in'),
        title: z.string().describe('Issue title'),
        description: z.string().optional().describe('Issue description'),
        priority: PriorityEnum.optional().describe('Issue priority'),
        assignee_id: z.string().optional().describe('User ID to assign the issue to'),
        labels: z.array(z.string()).optional().describe('Labels to tag the issue with'),
        external_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional idempotency key chosen by the caller. Retrying with the same key in the same project returns the first issue instead of creating another.',
          ),
      }),
    },
    async (input) => {
      const project = await store.getProject(input.project_id);
      if (!project) {
        return { content: [{ type: 'text' as const, text: `Project ${input.project_id} not found` }], isError: true };
      }
      const { issue, replayed } = await store.createIssue(input);
      // A replay changed nothing, so subscribers to the board don't need a nudge.
      if (!replayed) notifyBoardChanged(input.project_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...issue, replayed }, null, 2) }] };
    },
  );

  server.registerTool(
    'update_issue',
    {
      description: 'Update fields on an existing issue',
      inputSchema: z.object({
        issue_id: z.string().describe('The issue ID to update'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        status: StatusEnum.optional().describe('New status'),
        priority: PriorityEnum.optional().describe('New priority'),
        assignee_id: z.string().optional().describe('New assignee user ID'),
        labels: z.array(z.string()).optional().describe('New labels'),
      }),
    },
    async (input) => {
      const existing = await store.getIssue(input.issue_id);
      if (!existing) {
        return { content: [{ type: 'text' as const, text: `Issue ${input.issue_id} not found` }], isError: true };
      }
      const { issue_id, ...updates } = input;
      const issue = await store.updateIssue(issue_id, updates);
      notifyBoardChanged(issue.project_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(issue, null, 2) }] };
    },
  );

  server.registerTool(
    'search_issues',
    {
      description: 'Search for issues by text query',
      inputSchema: z.object({
        query: z.string().describe('Search query to match against issue titles and descriptions'),
        project_id: z.string().optional().describe('Limit search to a specific project'),
      }),
    },
    async (input) => {
      let results = await store.searchIssues(input.query);
      if (input.project_id) {
        results = results.filter((issue) => issue.project_id === input.project_id);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'bulk_update_status',
    {
      description: 'Change the status of multiple issues at once',
      inputSchema: z.object({
        issue_ids: z.array(z.string()).describe('List of issue IDs to update'),
        status: StatusEnum.describe('The new status to set'),
      }),
    },
    async (input) => {
      const issues = await Promise.all(input.issue_ids.map(id => store.getIssue(id)));
      const projectIds = [...new Set(issues.filter(Boolean).map(i => i!.project_id))];
      const count = await store.bulkUpdateStatus(input.issue_ids, input.status);
      for (const pid of projectIds) {
        notifyBoardChanged(pid);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ updated: count, status: input.status }, null, 2) }],
      };
    },
  );
}
