import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { resetDemoData } from '../src/demo.js';

async function count(sql: string): Promise<number> {
  return (await env.DB.prepare(sql).first<{ n: number }>())!.n;
}

async function counts() {
  return {
    projects: await count('SELECT COUNT(*) AS n FROM projects'),
    members: await count('SELECT COUNT(*) AS n FROM members'),
    issues: await count('SELECT COUNT(*) AS n FROM issues'),
    comments: await count('SELECT COUNT(*) AS n FROM comments'),
    activity: await count('SELECT COUNT(*) AS n FROM activity'),
  };
}

describe('demo-data: seeded demo project', () => {
  it('seeds proj-demo with the three personas and 8 issues covering every status and priority', async () => {
    await resetDemoData(env.DB);

    const members = await env.DB.prepare(
      "SELECT user_id, role FROM members WHERE project_id = 'proj-demo' ORDER BY user_id",
    ).all<{ user_id: string; role: string }>();
    expect(members.results).toEqual([
      { user_id: 'user-alice', role: 'admin' },
      { user_id: 'user-bob', role: 'member' },
      { user_id: 'user-carol', role: 'viewer' },
    ]);

    expect(await count("SELECT COUNT(*) AS n FROM issues WHERE project_id = 'proj-demo'")).toBe(8);
    expect(await count('SELECT COUNT(DISTINCT status) AS n FROM issues')).toBe(6);
    expect(await count('SELECT COUNT(DISTINCT priority) AS n FROM issues')).toBe(4);
    expect(await count('SELECT COUNT(*) AS n FROM comments')).toBeGreaterThan(0);
    expect(await count('SELECT COUNT(*) AS n FROM activity')).toBeGreaterThan(0);
  });
});

describe('demo-data: reset restores the demo state', () => {
  it('sweeps away student-created projects', async () => {
    await resetDemoData(env.DB);
    await env.DB.prepare("INSERT INTO projects (id, name) VALUES ('student-proj', 'Mine')").run();
    await env.DB.prepare(
      "INSERT INTO members (project_id, user_id, role) VALUES ('student-proj', 'user-bob', 'admin')",
    ).run();

    await resetDemoData(env.DB);

    const projects = await env.DB.prepare('SELECT id FROM projects').all<{ id: string }>();
    expect(projects.results.map((p) => p.id)).toEqual(['proj-demo']);
  });

  it('gives the same result when run twice', async () => {
    await resetDemoData(env.DB);
    const first = await counts();
    await resetDemoData(env.DB);
    expect(await counts()).toEqual(first);
  });
});

describe('demo-data: scheduled reset', () => {
  it('re-seeds the demo data from the cron handler', async () => {
    await env.DB.prepare("DELETE FROM projects WHERE id = 'proj-demo'").run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE id = 'proj-demo'")).toBe(1);
  });
});
