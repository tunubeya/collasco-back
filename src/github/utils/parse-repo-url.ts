export function parseRepoUrl(url?: string): { owner: string; repo: string } | null {
  if (!url) return null;

  // https://github.com/owner/repo(.git)?
  const https = url.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (https) return { owner: https[1], repo: https[2] };

  // git@github.com:owner/repo(.git)?
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  return null;
}
