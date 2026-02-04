import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// 👇 Interfaces públicas que usas en otros servicios
export interface ParsedGitUrl {
  owner: string;
  repo: string;
  number?: number; // issue/PR number
  sha?: string; // commit
}

export interface IssueSummary {
  id: number;
  number: number;
  title: string;
  state: string; // "open" | "closed"
  labels: string[];
  url: string;
  assignees: string[];
}

export interface PullSummary {
  id: number;
  number: number;
  title: string;
  state: string; // "open" | "closed"
  merged: boolean;
  draft: boolean;
  url: string;
  headRef?: string;
  baseRef?: string;
  author?: string | null;
}

export interface CommitSummary {
  sha: string;
  message?: string | null;
  url: string;
  author?: string | null;
}

@Injectable()
export class GithubService {
  constructor(private readonly prisma: PrismaService) {}
  // Evitamos importar ESM en tiempo de carga; lo traemos con dynamic import.
  private octokit?: InstanceType<typeof import('@octokit/rest').Octokit>;

  private async getClient(tokenOverride?: string) {
    const { Octokit } = await import('@octokit/rest');

    // si me pasan tokenOverride, creo un cliente temporal con ese token
    if (tokenOverride) {
      return new Octokit({ auth: tokenOverride });
    }

    // si no, reutilizo el singleton maestro
    if (!this.octokit) {
      const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
      this.octokit = new Octokit(token ? { auth: token } : {});
    }
    return this.octokit;
  }

  private ensureGithubHost(url: URL) {
    if (url.hostname !== 'github.com') {
      throw new BadRequestException('Only github.com URLs are supported');
    }
  }

  parseUrl(url: string): ParsedGitUrl {
    try {
      const u = new URL(url);
      this.ensureGithubHost(u);
      // Soporta: issues, pull, commit
      // /{owner}/{repo}/issues/{number}
      // /{owner}/{repo}/pull/{number}
      // /{owner}/{repo}/commit/{sha}
      const parts = u.pathname.split('/').filter(Boolean);
      const [owner, repo, type, id] = parts;

      if (!owner || !repo || !type) throw new Error('Invalid path');

      if (type === 'issues' || type === 'pull') {
        const number = Number.parseInt(id ?? '', 10);
        if (Number.isNaN(number)) throw new Error('Invalid issue/PR number');
        return { owner, repo, number };
      } else if (type === 'commit') {
        if (!id) throw new Error('Missing commit sha');
        return { owner, repo, sha: id };
      }

      throw new Error('Unsupported GitHub URL');
    } catch (err) {
      // ✅ sin pasar `any` como segundo parámetro
      throw new BadRequestException('Invalid GitHub URL', { cause: err as Error });
    }
  }

  // Duck-typing para no importar RequestError (ESM) y evitar ERR_REQUIRE_ESM
  private mapRequestError(e: unknown): never {
    const err = e as { status?: number };
    if (typeof err?.status === 'number') {
      if (err.status === 404) throw new NotFoundException('GitHub resource not found');
      if (err.status === 401) throw new UnauthorizedException('Invalid or missing GitHub token');
      if (err.status === 403) throw new ForbiddenException('GitHub API forbidden or rate-limited');
      throw new BadRequestException(`GitHub error (${err.status})`);
    }
    throw e;
  }

  /** ==================== WHOAMI ==================== */
  async whoAmI(opts?: { tokenOverride?: string }) {
    try {
      const client = await this.getClient(opts?.tokenOverride); // usa GITHUB_TOKEN del env
      const { data } = await client.users.getAuthenticated();
      return {
        login: data.login,
        id: data.id,
        type: data.type,
      };
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  /** ==================== Issues / Pulls / Commits ==================== */
  async getIssueByUrl(issueUrl: string): Promise<IssueSummary> {
    try {
      const { owner, repo, number } = this.parseUrl(issueUrl);
      const client = await this.getClient();
      const { data } = await client.issues.get({ owner, repo, issue_number: number! });

      type LabelLike = string | { name?: string | null } | null | undefined;
      type AssigneeLike = { login?: string | null } | null | undefined;

      const labelsArr = (data.labels ?? []) as LabelLike[];
      const assigneesArr = (data.assignees ?? []) as AssigneeLike[];

      const labels = labelsArr
        .map((l) => (typeof l === 'string' ? l : (l?.name ?? '')))
        .filter((s): s is string => Boolean(s));

      const assignees = assigneesArr
        .map((a) => a?.login ?? '')
        .filter((s): s is string => Boolean(s));

      return {
        id: data.id,
        number: data.number,
        title: data.title,
        state: data.state, // "open" | "closed"
        labels,
        url: data.html_url,
        assignees,
      };
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async getPullByUrl(prUrl: string): Promise<PullSummary> {
    try {
      const { owner, repo, number } = this.parseUrl(prUrl);
      const client = await this.getClient();
      const { data } = await client.pulls.get({ owner, repo, pull_number: number! });

      return {
        id: data.id,
        number: data.number,
        title: data.title,
        state: data.state, // "open" | "closed"
        merged: !!data.merged,
        draft: !!data.draft,
        url: data.html_url,
        headRef: data.head?.ref,
        baseRef: data.base?.ref,
        author: data.user?.login ?? null,
      };
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async getCommitByUrl(commitUrl: string) {
    try {
      const { owner, repo, sha } = this.parseUrl(commitUrl);
      const client = await this.getClient();
      const { data } = await client.repos.getCommit({ owner, repo, ref: sha! });
      return {
        sha: data.sha,
        message: data.commit?.message ?? null,
        author: data.author?.login ?? data.commit?.author?.name ?? null,
        url: data.html_url,
        filesChanged: Array.isArray(data.files) ? data.files.length : 0,
      };
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async listPullCommits(prUrl: string): Promise<CommitSummary[]> {
    try {
      const { owner, repo, number } = this.parseUrl(prUrl);
      const client = await this.getClient();

      type PullCommitItem = {
        sha: string;
        html_url: string;
        commit?: {
          message?: string | null;
          author?: { name?: string | null } | null;
        } | null;
        author?: { login?: string | null } | null;
      };

      const items = (await client.paginate(client.pulls.listCommits, {
        owner,
        repo,
        pull_number: number!,
        per_page: 100,
      })) as PullCommitItem[];

      return items.map((c) => ({
        sha: c.sha,
        message: c.commit?.message ?? null,
        url: c.html_url,
        author: c.author?.login ?? c.commit?.author?.name ?? null,
      }));
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async listRepoIssues(
    owner: string,
    repo: string,
    q: {
      state: 'open' | 'closed' | 'all';
      labels?: string;
      since?: string;
      assignee?: string;
      per_page?: number;
      page?: number;
    },
    opt?: { tokenOverride?: string },
  ): Promise<IssueSummary[]> {
    try {
      const client = await this.getClient(opt?.tokenOverride);

      type LabelLike = string | { name?: string | null } | null | undefined;
      type AssigneeLike = { login?: string | null } | null | undefined;
      type IssueItem = {
        id: number;
        number: number;
        title: string;
        state: string;
        html_url: string;
        labels?: ReadonlyArray<LabelLike> | null;
        assignees?: ReadonlyArray<AssigneeLike> | null;
      };

      const items = (await client.paginate(client.issues.listForRepo, {
        owner,
        repo,
        state: q.state,
        labels: q.labels,
        since: q.since,
        assignee: q.assignee,
        per_page: q.per_page ?? 50,
        page: q.page ?? 1,
      })) as IssueItem[];

      return items.map((i) => {
        const labelsArr = (i.labels ?? []) as LabelLike[];
        const assigneesArr = (i.assignees ?? []) as AssigneeLike[];
        const labels = labelsArr
          .map((l) => (typeof l === 'string' ? l : (l?.name ?? '')))
          .filter((s): s is string => Boolean(s));
        const assignees = assigneesArr
          .map((a) => a?.login ?? '')
          .filter((s): s is string => Boolean(s));
        return {
          id: i.id,
          number: i.number,
          title: i.title,
          state: i.state,
          labels,
          url: i.html_url,
          assignees,
        };
      });
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async listRepoPulls(
    owner: string,
    repo: string,
    q: {
      state: 'open' | 'closed' | 'all';
      sort?: 'created' | 'updated' | 'popularity' | 'long-running';
      direction?: 'asc' | 'desc';
      per_page?: number;
      page?: number;
    },
    opt?: { tokenOverride?: string },
  ): Promise<PullSummary[]> {
    try {
      const client = await this.getClient(opt?.tokenOverride);

      type PullItem = {
        id: number;
        number: number;
        title: string;
        state: string;
        html_url: string;
        merged_at?: string | null;
        draft?: boolean | null;
        head?: { ref?: string | null } | null;
        base?: { ref?: string | null } | null;
        user?: { login?: string | null } | null;
      };

      const items = (await client.paginate(client.pulls.list, {
        owner,
        repo,
        state: q.state, // GitHub acepta 'open' | 'closed' | 'all'
        sort: q.sort,
        direction: q.direction,
        per_page: q.per_page ?? 50,
        page: q.page ?? 1,
      })) as PullItem[];

      return items.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        state: p.state,
        merged: !!p.merged_at,
        draft: !!p.draft,
        url: p.html_url,
        headRef: p.head?.ref ?? undefined,
        baseRef: p.base?.ref ?? undefined,
        author: p.user?.login ?? null,
      }));
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  async getRepo(owner: string, repo: string, opts?: { tokenOverride?: string }) {
    try {
      const client = await this.getClient(opts?.tokenOverride);
      const { data } = await client.repos.get({ owner, repo });
      return {
        fullName: data.full_name,
        private: !!data.private,
        defaultBranch: data.default_branch,
        permissions: {
          admin: !!data.permissions?.admin,
          maintain: !!data.permissions?.maintain,
          push: !!data.permissions?.push,
          triage: !!data.permissions?.triage,
          pull: !!data.permissions?.pull,
        },
        htmlUrl: data.html_url,
        visibility: data.visibility ?? (data.private ? 'private' : 'public'),
        ownerType: data.owner?.type, // "User" | "Organization"
      };
    } catch (e) {
      this.mapRequestError(e);
    }
  }

  /** ==================== Tokens de USUARIO ==================== */
  async upsertUserToken(userId: string, token: string, username?: string) {
    return this.prisma.githubIdentity.upsert({
      where: { userId },
      create: { userId, accessToken: token, username },
      update: { accessToken: token, username },
    });
  }

  async getUserToken(userId: string) {
    const rec = await this.prisma.githubIdentity.findUnique({ where: { userId } });
    return rec?.accessToken ?? null;
  }

  async deleteUserToken(userId: string) {
    // borra si existe; si no, no rompe
    try {
      await this.prisma.githubIdentity.delete({ where: { userId } });
    } catch {
      // ignore
    }
    return { ok: true };
  }

  /** ==================== Tokens de PROYECTO (ProjectGithubCredential) ==================== */

  private async ensureProjectOwner(userId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId !== userId) throw new ForbiddenException('Owner only');
  }

  async upsertProjectTokenForOwner(
    userId: string,
    projectId: string,
    input: { accessToken: string; username?: string },
  ) {
    await this.ensureProjectOwner(userId, projectId);
    // opcional: guardar username en algún lado; el modelo ProjectGithubCredential no lo tiene
    return this.prisma.projectGithubCredential.upsert({
      where: { projectId },
      create: {
        projectId,
        accessToken: input.accessToken,
      },
      update: {
        accessToken: input.accessToken,
      },
    });
  }

  async deleteProjectTokenForOwner(userId: string, projectId: string) {
    await this.ensureProjectOwner(userId, projectId);
    try {
      await this.prisma.projectGithubCredential.delete({ where: { projectId } });
    } catch {
      // ignore si no existía
    }
    return { ok: true };
  }

  async getProjectToken(projectId: string) {
    const rec = await this.prisma.projectGithubCredential.findUnique({
      where: { projectId },
      select: { accessToken: true },
    });
    return rec?.accessToken ?? null;
  }

  /** Preferencia: token del proyecto → token del usuario → undefined */
  async resolveTokenForProject(userId: string, projectId: string) {
    const projectToken = await this.getProjectToken(projectId);
    if (projectToken) return projectToken;
    const userToken = await this.getUserToken(userId);
    return userToken ?? undefined;
  }

  /** WHOAMI usando resolución por proyecto (requiere al menos lectura del proyecto si lo validas fuera) */
  async whoAmIForProject(userId: string, projectId: string) {
    const token = await this.resolveTokenForProject(userId, projectId);
    if (!token) return { connected: false };
    const me = await this.whoAmI({ tokenOverride: token });
    return {
      connected: true,
      github: me,
      source: (await this.getProjectToken(projectId)) ? 'project' : 'user',
    };
  }
}
