import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { Store, Status } from '../store.js';

export function registerProjectResources(server: McpServer, store: Store) {
  server.registerResource(
    'projects-list',
    'tracker://projects',
    { description: 'List all projects' },
    async (uri) => {
      const projects = await store.listProjects();
      return { contents: [{ uri: uri.href, text: JSON.stringify(projects, null, 2) }] };
    },
  );

  server.registerResource(
    'project-board',
    new ResourceTemplate('tracker://projects/{projectId}/board', { list: undefined }),
    { description: 'Get a project board with issues grouped by status' },
    async (uri, params) => {
      const projectId = params.projectId as string;
      const project = await store.getProject(projectId);
      if (!project) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'Project not found' }) }] };
      }
      const issues = await store.listIssues(projectId);
      const board: Record<string, typeof issues> = {};
      const statuses: Status[] = ['backlog', 'open', 'in_progress', 'review', 'done', 'closed'];
      for (const status of statuses) {
        board[status] = issues.filter(i => i.status === status);
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify({ project, board }, null, 2) }] };
    },
  );

  server.registerResource(
    'project-activity',
    new ResourceTemplate('tracker://projects/{projectId}/activity', { list: undefined }),
    { description: 'Get recent activity for a project' },
    async (uri, params) => {
      const projectId = params.projectId as string;
      const project = await store.getProject(projectId);
      if (!project) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'Project not found' }) }] };
      }
      const activity = await store.getActivity(projectId, 50);
      return { contents: [{ uri: uri.href, text: JSON.stringify(activity, null, 2) }] };
    },
  );
}
