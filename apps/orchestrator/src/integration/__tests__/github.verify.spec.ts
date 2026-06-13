import { UnconfiguredGithubVerifier } from '../github.verify';

describe('UnconfiguredGithubVerifier', () => {
  it('honestly reports not_configured (cannot mint a token without an App)', async () => {
    const outcome = await new UnconfiguredGithubVerifier().verify('any-installation');
    expect(outcome).toEqual({ ok: false, status: 'not_configured', error: expect.any(String) });
  });
});
