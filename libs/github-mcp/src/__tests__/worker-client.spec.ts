import { authedGitHubClient, githubAppCredentialsFromEnv } from '../worker-client';

describe('authedGitHubClient', () => {
  it('installs a before-request hook that sets a fresh installation token, and adapts to a GitHubClient', async () => {
    let hookFn: ((o: { headers: Record<string, string> }) => unknown) | undefined;
    const getContent = jest.fn(async () => ({ data: { type: 'file', content: Buffer.from('hi').toString('base64'), encoding: 'base64', size: 2, path: 'a' } }));
    const octokit = {
      hook: { before: jest.fn((_name: 'request', fn: (o: { headers: Record<string, string> }) => unknown) => (hookFn = fn)) },
      rest: { repos: { getContent } },
    };
    const source = { getToken: jest.fn(async () => 'ghs_live_token') };

    const client = authedGitHubClient(octokit as never, source);

    // the hook was registered…
    expect(octokit.hook.before).toHaveBeenCalledWith('request', expect.any(Function));
    // …and sets Authorization from the live token
    const options = { headers: {} as Record<string, string> };
    await hookFn?.(options);
    expect(options.headers.authorization).toBe('token ghs_live_token');
    // …and the returned client talks to octokit.rest
    await client.getFileContents({ owner: 'o', repo: 'r', path: 'a' });
    expect(getContent).toHaveBeenCalled();
  });
});

describe('githubAppCredentialsFromEnv', () => {
  it('returns the App credentials when present (unescaping \\n in the key)', () => {
    const creds = githubAppCredentialsFromEnv({ GITHUB_APP_ID: '42', GITHUB_APP_PRIVATE_KEY: 'a\\nb' } as NodeJS.ProcessEnv);
    expect(creds).toEqual({ appId: '42', privateKey: 'a\nb' });
  });

  it('returns undefined when a credential is missing', () => {
    expect(githubAppCredentialsFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(githubAppCredentialsFromEnv({ GITHUB_APP_ID: '42' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
