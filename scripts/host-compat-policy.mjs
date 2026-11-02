import assert from 'node:assert/strict';
export const SUPPORTED_HOSTS = Object.freeze(['0.1.7-rc.2', '0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.5']);
export function validateFixtureRun(run, repository, defaultBranch='main') {
  assert.equal(run?.event,'workflow_dispatch','Host fixture must come from controlled manual workflow');
  assert.equal(run.repository?.full_name,repository,'Foreign fixture repository');
  assert.equal(run.head_repository?.full_name,repository,'Fork fixture forbidden');
  assert.equal(run.status,'completed','Host fixture run incomplete');
  assert.equal(run.conclusion,'success','Host fixture workflow failed');
  assert.equal(run.path,'.github/workflows/host-fixtures.yml','Host fixture must come from the controlled fixture workflow');
  assert.equal(run.head_branch,defaultBranch,'Host fixture must come from the default branch');
  assert.ok(typeof run.head_branch==='string'&&!run.head_branch.startsWith('refs/pull/')&&run.head_branch!=='','Pull request fixture forbidden');
  assert.match(run.head_sha??'',/^[a-f0-9]{40}$/,'Fixture SHA missing');
  assert.ok(Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0,'Invalid fixture run identity');
  return {runId:run.id,attempt:run.run_attempt,sha:run.head_sha,workflow:run.path};
}
export function validateHostManifest(manifest, expectedVersion = manifest?.version) {
  assert.equal(manifest?.name, '@deepseek-ai/dsh', 'Expected an installed DSH package');
  assert.ok(SUPPORTED_HOSTS.includes(expectedVersion), 'Unsupported exact DSH version');
  assert.equal(manifest.version, expectedVersion, 'Host version does not match requested contract');
  return expectedVersion;
}
