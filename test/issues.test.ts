import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDemoData } from '../src/demo.js';
import { Store } from '../src/store.js';
import { mcp, toolText } from './helpers.js';
import { devToken } from './setup.js';

const bob = () => new Store(env.DB, { userId: 'user-bob', scopes: ['member'] });
const carol = () => new Store(env.DB, { userId: 'user-carol', scopes: ['viewer'] });

async function countWithKey(projectId: string, externalId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id = ? AND external_id = ?')
    .bind(projectId, externalId)
    .first<{ n: number }>();
  return row!.n;
}

beforeEach(async () => {
  await resetDemoData(env.DB);
});

describe('issue-tools: idempotent issue creation', () => {
  it('returns the first issue when the same key is retried', async () => {
    const first = await bob().createIssue({ project_id: 'proj-demo', title: 'Bug report', external_id: 'wf-123' });
    const second = await bob().createIssue({ project_id: 'proj-demo', title: 'Bug report', external_id: 'wf-123' });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.issue.id).toBe(first.issue.id);
    expect(await countWithKey('proj-demo', 'wf-123')).toBe(1);
  });

  it('keeps the first call’s fields when a replay sends different ones', async () => {
    await bob().createIssue({ project_id: 'proj-demo', title: 'Original title', external_id: 'wf-123' });
    const replay = await bob().createIssue({ project_id: 'proj-demo', title: 'Changed title', external_id: 'wf-123' });

    expect(replay.replayed).toBe(true);
    expect(replay.issue.title).toBe('Original title');
  });

  it('creates a new issue for the same key in another project', async () => {
    const other = await bob().createProject({ name: 'Bob’s project' });
    const demo = await bob().createIssue({ project_id: 'proj-demo', title: 'In demo', external_id: 'wf-123' });
    const mine = await bob().createIssue({ project_id: other.id, title: 'In mine', external_id: 'wf-123' });

    expect(mine.replayed).toBe(false);
    expect(mine.issue.id).not.toBe(demo.issue.id);
    expect(mine.issue.project_id).toBe(other.id);
  });

  it('does not deduplicate calls without a key', async () => {
    const first = await bob().createIssue({ project_id: 'proj-demo', title: 'No key' });
    const second = await bob().createIssue({ project_id: 'proj-demo', title: 'No key' });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(second.issue.id).not.toBe(first.issue.id);
    expect(first.issue.external_id).toBeNull();
  });
});

describe('issue-tools: replays follow the same role rules', () => {
  it('refuses a viewer replaying a key a member already used', async () => {
    await bob().createIssue({ project_id: 'proj-demo', title: 'Filed by Bob', external_id: 'wf-123' });
    await expect(
      carol().createIssue({ project_id: 'proj-demo', title: 'Filed by Bob', external_id: 'wf-123' }),
    ).rejects.toThrow('Forbidden');
  });
});

describe('issue-tools: over MCP', () => {
  it('accepts external_id and marks the second call as a replay', async () => {
    const token = await devToken('user-bob', 'member');
    const args = { project_id: 'proj-demo', title: 'From a workflow', external_id: 'wf-456' };

    const first = JSON.parse(toolText((await mcp(token, 'tools/call', { name: 'create_issue', arguments: args })).body));
    const second = JSON.parse(toolText((await mcp(token, 'tools/call', { name: 'create_issue', arguments: args })).body));

    expect(first).toMatchObject({ replayed: false, external_id: 'wf-456' });
    expect(second).toMatchObject({ replayed: true, id: first.id, external_id: 'wf-456' });
  });

  it('includes external_id in the issue resource', async () => {
    const { issue } = await bob().createIssue({ project_id: 'proj-demo', title: 'Readable key', external_id: 'wf-123' });
    const token = await devToken('user-bob', 'member');
    const read = await mcp(token, 'resources/read', { uri: `tracker://issues/${issue.id}` });

    expect(JSON.parse(read.body!.result.contents[0].text).external_id).toBe('wf-123');
  });

  it('refuses a viewer replay without revealing the existing issue', async () => {
    const { issue } = await bob().createIssue({ project_id: 'proj-demo', title: 'Filed by Bob', external_id: 'wf-123' });
    const token = await devToken('user-carol', 'viewer');
    const create = await mcp(token, 'tools/call', {
      name: 'create_issue',
      arguments: { project_id: 'proj-demo', title: 'Filed by Bob', external_id: 'wf-123' },
    });

    expect(toolText(create.body)).toContain('Forbidden');
    expect(toolText(create.body)).not.toContain(issue.id);
  });

  it('rejects an empty external_id', async () => {
    const token = await devToken('user-bob', 'member');
    const create = await mcp(token, 'tools/call', {
      name: 'create_issue',
      arguments: { project_id: 'proj-demo', title: 'Empty key', external_id: '' },
    });

    expect(create.body?.result?.isError ?? Boolean(create.body?.error)).toBe(true);
  });
});
