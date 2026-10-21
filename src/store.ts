export type Status = 'backlog' | 'open' | 'in_progress' | 'review' | 'done' | 'closed';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Role = 'admin' | 'member' | 'viewer';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  assignee_id: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  text: string;
  created_at: string;
}

export interface Member {
  project_id: string;
  user_id: string;
  role: Role;
}

export interface Activity {
  id: string;
  project_id: string;
  issue_id: string | null;
  user_id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface IssueRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  assignee_id: string | null;
  labels: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  user_id: string;
  action: string;
  details: string | null;
  created_at: string;
}

function parseIssueRow(row: IssueRow): Issue {
  return { ...row, labels: row.labels ? JSON.parse(row.labels) : [] };
}

function parseActivityRow(row: ActivityRow): Activity {
  return { ...row, details: row.details ? JSON.parse(row.details) : null };
}

export interface AuthContext {
  userId?: string;
  scopes: string[];
}

function hasScope(auth: AuthContext | undefined, ...required: string[]): boolean {
  if (!auth) return true;
  return required.some(s => auth.scopes.includes(s));
}

function requireScope(auth: AuthContext | undefined, ...required: string[]): void {
  if (!hasScope(auth, ...required)) {
    throw new Error(`Forbidden: requires one of [${required.join(', ')}]`);
  }
}

export class Store {
  constructor(private db: D1Database, private auth?: AuthContext) {}

  private async canAccessProject(projectId: string): Promise<boolean> {
    if (!this.auth?.userId) return true;
    const row = await this.db
      .prepare('SELECT 1 as ok FROM members WHERE project_id = ? AND user_id = ?')
      .bind(projectId, this.auth.userId)
      .first();
    return row !== null;
  }

  async createProject(data: { name: string; description?: string }): Promise<Project> {
    requireScope(this.auth, 'admin', 'member');
    const id = crypto.randomUUID();
    await this.db
      .prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)')
      .bind(id, data.name, data.description ?? null)
      .run();
    if (this.auth?.userId) {
      await this.db
        .prepare('INSERT INTO members (project_id, user_id, role) VALUES (?, ?, ?)')
        .bind(id, this.auth.userId, 'admin')
        .run();
    }
    return (await this.getProject(id))!;
  }

  async getProject(id: string): Promise<Project | null> {
    if (this.auth?.userId) {
      return await this.db
        .prepare(
          `SELECT p.* FROM projects p
           INNER JOIN members m ON m.project_id = p.id
           WHERE p.id = ? AND m.user_id = ?`,
        )
        .bind(id, this.auth.userId)
        .first<Project>();
    }
    return await this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(id)
      .first<Project>();
  }

  async listProjects(): Promise<Project[]> {
    if (this.auth?.userId) {
      const result = await this.db
        .prepare(
          `SELECT p.* FROM projects p
           INNER JOIN members m ON m.project_id = p.id
           WHERE m.user_id = ?
           ORDER BY p.created_at DESC`,
        )
        .bind(this.auth.userId)
        .all<Project>();
      return result.results;
    }
    const result = await this.db
      .prepare('SELECT * FROM projects ORDER BY created_at DESC')
      .all<Project>();
    return result.results;
  }

  // Called by delete_project BEFORE it asks the user to confirm, so nobody is
  // asked "Delete project X?" for a deletion they aren't allowed to make.
  // Membership first, then role: a non-member gets the same "not found" as for a
  // project that doesn't exist (no enumeration), a member without admin gets Forbidden.
  async assertCanDeleteProject(id: string): Promise<void> {
    if (!(await this.canAccessProject(id))) {
      throw new Error('Project not found');
    }
    requireScope(this.auth, 'admin');
  }

  async deleteProject(id: string): Promise<{ issueCount: number }> {
    await this.assertCanDeleteProject(id);
    const countRow = await this.db
      .prepare('SELECT COUNT(*) as count FROM issues WHERE project_id = ?')
      .bind(id)
      .first<{ count: number }>();
    const issueCount = countRow?.count ?? 0;
    await this.db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
    return { issueCount };
  }

  async createIssue(data: {
    project_id: string;
    title: string;
    description?: string;
    priority?: Priority;
    assignee_id?: string;
    labels?: string[];
  }): Promise<Issue> {
    requireScope(this.auth, 'admin', 'member');
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        'INSERT INTO issues (id, project_id, title, description, priority, assignee_id, labels) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        data.project_id,
        data.title,
        data.description ?? null,
        data.priority ?? 'medium',
        data.assignee_id ?? null,
        data.labels ? JSON.stringify(data.labels) : null,
      )
      .run();
    return (await this.getIssue(id))!;
  }

  async getIssue(id: string): Promise<Issue | null> {
    if (this.auth?.userId) {
      const row = await this.db
        .prepare(
          `SELECT i.* FROM issues i
           INNER JOIN members m ON m.project_id = i.project_id
           WHERE i.id = ? AND m.user_id = ?`,
        )
        .bind(id, this.auth.userId)
        .first<IssueRow>();
      return row ? parseIssueRow(row) : null;
    }
    const row = await this.db
      .prepare('SELECT * FROM issues WHERE id = ?')
      .bind(id)
      .first<IssueRow>();
    return row ? parseIssueRow(row) : null;
  }

  async listIssues(projectId: string, filters?: {
    status?: Status;
    priority?: Priority;
    assignee_id?: string;
  }): Promise<Issue[]> {
    const conditions = ['project_id = ?'];
    const params: unknown[] = [projectId];
    if (filters?.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters?.priority) { conditions.push('priority = ?'); params.push(filters.priority); }
    if (filters?.assignee_id) { conditions.push('assignee_id = ?'); params.push(filters.assignee_id); }
    const result = await this.db
      .prepare(`SELECT * FROM issues WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`)
      .bind(...params)
      .all<IssueRow>();
    return result.results.map(parseIssueRow);
  }

  async updateIssue(
    id: string,
    updates: Partial<Pick<Issue, 'title' | 'description' | 'status' | 'priority' | 'assignee_id' | 'labels'>>,
  ): Promise<Issue> {
    requireScope(this.auth, 'admin', 'member');
    const setClauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      setClauses.push(`${key} = ?`);
      params.push(key === 'labels' ? JSON.stringify(value) : value);
    }
    if (setClauses.length > 0) {
      setClauses.push("updated_at = datetime('now')");
      params.push(id);
      await this.db
        .prepare(`UPDATE issues SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...params)
        .run();
    }
    return (await this.getIssue(id))!;
  }

  async bulkUpdateStatus(issueIds: string[], status: Status): Promise<number> {
    requireScope(this.auth, 'admin', 'member');
    if (this.auth?.userId) {
      const placeholders = issueIds.map(() => '?').join(', ');
      const accessible = await this.db
        .prepare(
          `SELECT i.id FROM issues i
           INNER JOIN members m ON m.project_id = i.project_id
           WHERE i.id IN (${placeholders}) AND m.user_id = ?`,
        )
        .bind(...issueIds, this.auth.userId)
        .all<{ id: string }>();
      issueIds = accessible.results.map(r => r.id);
      if (issueIds.length === 0) return 0;
    }
    const stmts = issueIds.map(id =>
      this.db
        .prepare("UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status, id),
    );
    const results = await this.db.batch(stmts);
    return results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  }

  async searchIssues(query: string): Promise<Issue[]> {
    const pattern = `%${query}%`;
    if (this.auth?.userId) {
      const result = await this.db
        .prepare(
          `SELECT i.* FROM issues i
           INNER JOIN members m ON m.project_id = i.project_id
           WHERE (i.title LIKE ? OR i.description LIKE ?) AND m.user_id = ?
           ORDER BY i.created_at DESC`,
        )
        .bind(pattern, pattern, this.auth.userId)
        .all<IssueRow>();
      return result.results.map(parseIssueRow);
    }
    const result = await this.db
      .prepare('SELECT * FROM issues WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC')
      .bind(pattern, pattern)
      .all<IssueRow>();
    return result.results.map(parseIssueRow);
  }

  async listMembers(projectId: string): Promise<Member[]> {
    const result = await this.db
      .prepare('SELECT * FROM members WHERE project_id = ?')
      .bind(projectId)
      .all<Member>();
    return result.results;
  }

  async listComments(issueId: string): Promise<Comment[]> {
    const result = await this.db
      .prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC')
      .bind(issueId)
      .all<Comment>();
    return result.results;
  }

  async getActivity(projectId: string, limit: number = 50): Promise<Activity[]> {
    const result = await this.db
      .prepare('SELECT * FROM activity WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(projectId, limit)
      .all<ActivityRow>();
    return result.results.map(parseActivityRow);
  }
}
