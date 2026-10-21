import { McpServer, inputRequired } from '@modelcontextprotocol/server';
import type { ServerEventBus } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Store, Status } from '../store.js';

type InputResponses = Record<string, unknown> | undefined;

const STATUS_ORDER: Status[] = ['done', 'closed', 'review', 'in_progress', 'open', 'backlog'];

export function registerProjectTools(server: McpServer, store: Store, bus?: ServerEventBus) {
  server.registerTool(
    'create_project',
    {
      description: 'Create a new project. The authenticated user becomes the project admin.',
      inputSchema: z.object({
        name: z.string().describe('Project name'),
        description: z.string().optional().describe('Project description'),
      }),
    },
    async (input) => {
      const project = await store.createProject(input);
      bus?.publish({ kind: 'resources_list_changed' });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(project, null, 2) }],
      };
    },
  );

  server.registerTool(
    'delete_project',
    {
      description: 'Delete a project and all its issues. Requires confirmation before proceeding.',
      inputSchema: z.object({
        project_id: z.string().describe('The project ID to delete'),
      }),
    },
    async (input, ctx) => {
      const responses = ctx.mcpReq.inputResponses as InputResponses;

      if (responses?.confirm) {
        const response = responses.confirm as { action: string; content?: { proceed?: boolean } };
        if (response.action !== 'accept' || !response.content?.proceed) {
          return { content: [{ type: 'text' as const, text: 'Project deletion cancelled.' }] };
        }
        const result = await store.deleteProject(input.project_id);
        bus?.publish({ kind: 'resources_list_changed' });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, issueCount: result.issueCount }, null, 2) }],
        };
      }

      // Check permission first: only ask for confirmation if the deletion could happen.
      await store.assertCanDeleteProject(input.project_id);

      const project = await store.getProject(input.project_id);
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found' }], isError: true };
      }

      const issues = await store.listIssues(input.project_id);

      return inputRequired({
        inputRequests: {
          confirm: {
            method: 'elicitation/create',
            params: {
              message: `Delete project "${project.name}" and all ${issues.length} issues? This cannot be undone.`,
              requestedSchema: {
                type: 'object',
                properties: { proceed: { type: 'boolean' } },
                required: ['proceed'],
              },
            },
          },
        },
        requestState: JSON.stringify({ project_id: input.project_id }),
      });
    },
  );

  server.registerTool(
    'generate_sprint_report',
    {
      description: 'Generate a sprint summary report for a project. Sends progress notifications if a progressToken is provided.',
      inputSchema: z.object({
        project_id: z.string().describe('The project to report on'),
      }),
    },
    async (input, ctx) => {
      const progressToken = ctx.mcpReq._meta?.progressToken as string | undefined;

      const sendProgress = async (progress: number, total: number) => {
        if (!progressToken) return;
        await ctx.mcpReq.notify({
          method: 'notifications/progress',
          params: { progressToken, progress, total },
        });
      };

      await sendProgress(0, 4);

      const project = await store.getProject(input.project_id);
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found' }], isError: true };
      }

      await sendProgress(1, 4);

      const issues = await store.listIssues(input.project_id);
      const byStatus: Record<string, number> = {};
      for (const issue of issues) {
        byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
      }

      await sendProgress(2, 4);

      const members = await store.listMembers(input.project_id);
      const activity = await store.getActivity(input.project_id, 20);

      await sendProgress(3, 4);

      const completed = (byStatus['done'] ?? 0) + (byStatus['closed'] ?? 0);
      const total = issues.length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      const statusLines = STATUS_ORDER
        .filter(s => byStatus[s])
        .map(s => `  - ${s}: ${byStatus[s]}`);

      const assigneeLoad: Record<string, number> = {};
      for (const issue of issues) {
        if (issue.assignee_id && issue.status !== 'done' && issue.status !== 'closed') {
          assigneeLoad[issue.assignee_id] = (assigneeLoad[issue.assignee_id] ?? 0) + 1;
        }
      }

      const criticalIssues = issues.filter(i => i.priority === 'critical' && i.status !== 'done' && i.status !== 'closed');

      const report = [
        `## Sprint Report: ${project.name}`,
        `Generated: ${new Date().toISOString().split('T')[0]}`,
        '',
        `### Overview`,
        `- Total issues: ${total}`,
        `- Completed: ${completed} (${completionRate}%)`,
        `- Remaining: ${total - completed}`,
        '',
        `### Status Breakdown`,
        ...statusLines,
        '',
        `### Team Workload (open items)`,
        ...Object.entries(assigneeLoad)
          .sort(([, a], [, b]) => b - a)
          .map(([id, count]) => `  - ${id}: ${count} issues`),
        ...(Object.keys(assigneeLoad).length === 0 ? ['  - No assigned open items'] : []),
        '',
        ...(criticalIssues.length > 0
          ? [
              `### Critical Issues`,
              ...criticalIssues.map(i => `  - [${i.status}] ${i.title} (${i.assignee_id ?? 'unassigned'})`),
              '',
            ]
          : []),
        `### Recent Activity (last ${activity.length} events)`,
        ...activity.slice(0, 5).map(a => `  - ${a.action} by ${a.user_id} at ${a.created_at}`),
        ...(activity.length > 5 ? [`  - ... and ${activity.length - 5} more`] : []),
        '',
        `### Team Members: ${members.length}`,
        ...members.map(m => `  - ${m.user_id} (${m.role})`),
      ].join('\n');

      await sendProgress(4, 4);

      return { content: [{ type: 'text' as const, text: report }] };
    },
  );
}
