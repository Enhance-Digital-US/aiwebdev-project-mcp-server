import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'triage_issue',
    {
      description: 'Get AI suggestions for issue priority, labels, and assignee',
      argsSchema: z.object({
        title: z.string().describe('Issue title'),
        description: z.string().describe('Issue description'),
      }),
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Triage the following issue and suggest:',
              '1. Priority (critical, high, medium, low)',
              '2. Labels (as a comma-separated list)',
              '3. Which team member role should handle it',
              '',
              `Title: ${args.title}`,
              `Description: ${args.description}`,
              '',
              'Respond in JSON format: { "priority": "...", "labels": ["..."], "suggested_role": "..." }',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'sprint_summary',
    {
      description: 'Generate a sprint status update for a project',
      argsSchema: z.object({
        project_name: z.string().describe('Name of the project'),
      }),
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Write a sprint status update for the project "${args.project_name}".`,
              '',
              'Include:',
              '- Summary of completed work',
              '- Work currently in progress',
              '- Any blockers or risks',
              '- Plan for the next sprint',
              '',
              'Use a professional but concise tone suitable for a team standup or stakeholder update.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'bug_report',
    {
      description: 'Generate a structured bug report template',
      argsSchema: z.object({
        error_message: z.string().optional().describe('The error message, if available'),
      }),
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Create a structured bug report with the following sections:',
              '',
              '## Summary',
              '(One-line description of the bug)',
              '',
              '## Steps to Reproduce',
              '1. ',
              '',
              '## Expected Behavior',
              '',
              '## Actual Behavior',
              args.error_message ? `\nError message: ${args.error_message}` : '',
              '',
              '## Environment',
              '- Browser/OS: ',
              '- Version: ',
              '',
              '## Priority Suggestion',
              '(critical/high/medium/low with reasoning)',
              '',
              'Fill in as much as you can infer and mark unknowns with [TODO].',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
