import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'https://github.com/DDePuy2015/itglue-mcp';
export const PROVENANCE_TYPE = 'https://slsa.dev/provenance/v0.2';

export function verifyPublishInputs(env) {
  assert.equal(env.GITHUB_REPOSITORY, 'DDePuy2015/itglue-mcp', 'wrong repository');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'publisher requires main');
  assert.equal(env.RELEASE_CONFIRMATION, 'true', 'explicit confirmation required');
  assert.match(env.SOURCE_SHA ?? '', /^[0-9a-f]{40}$/, 'invalid source SHA');
  assert.equal(env.SOURCE_SHA, env.GITHUB_SHA, 'source must equal the dispatched main SHA');
  assert.equal(env.ACR_LOGIN_SERVER, 'summititmcpacr.azurecr.io', 'unapproved registry');
  assert.equal(env.IMAGE_REPOSITORY, 'itglue-mcp', 'unapproved image repository');
}

export function verifyProvenance(predicate, sourceSha) {
  assert.match(sourceSha ?? '', /^[0-9a-f]{40}$/);
  assert.equal(predicate?.buildType, 'https://mobyproject.org/buildkit@v1', 'BuildKit provenance required');
  const metadata = predicate.metadata?.['https://mobyproject.org/buildkit@v1#metadata'];
  assert.equal(metadata?.vcs?.revision, sourceSha, 'provenance source revision mismatch');
  assert.equal(metadata?.vcs?.source?.replace(/\.git$/, ''), REPOSITORY, 'provenance repository mismatch');
  assert.ok(predicate.buildConfig?.llbDefinition?.length, 'maximum-mode provenance required');
  assert.ok(!Object.keys(predicate.invocation?.parameters?.args ?? {}).some(key => /token|password|secret/i.test(key)), 'credential build arguments forbidden');
  return predicate;
}

// Verify the content-addressed OCI graph before scanning or uploading its bytes.
export function verifyOci(directory, sourceSha, expectedDigest) {
  assert.match(expectedDigest ?? '', /^sha256:[0-9a-f]{64}$/);
  const blob = descriptor => {
    assert.match(descriptor.digest ?? '', /^sha256:[0-9a-f]{64}$/);
    const bytes = readFileSync(resolve(directory, 'blobs', 'sha256', descriptor.digest.slice(7)));
    assert.equal(bytes.length, descriptor.size, 'OCI blob size mismatch');
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, descriptor.digest, 'OCI blob digest mismatch');
    return bytes;
  };
  const wrapper = JSON.parse(readFileSync(resolve(directory, 'index.json'), 'utf8'));
  assert.equal(wrapper.manifests?.length, 1, 'one exported image index required');
  const root = wrapper.manifests[0];
  assert.equal(root.digest, expectedDigest, 'exported index differs from BuildKit digest');
  const manifests = [];
  const visit = descriptor => {
    const document = JSON.parse(blob(descriptor));
    if (document.manifests) document.manifests.forEach(visit);
    else {
      assert.ok(document.config && document.layers, 'invalid OCI manifest');
      const config = JSON.parse(blob(document.config));
      document.layers.forEach(blob);
      manifests.push({ descriptor, document, config });
    }
  };
  visit(root);
  const runnable = manifests.filter(item => item.config.os === 'linux' && item.config.architecture === 'amd64');
  assert.equal(runnable.length, 1, 'exactly one linux/amd64 image required');
  assert.equal(manifests.filter(item => item.config.os !== 'unknown' || item.config.architecture !== 'unknown').length, 1, 'additional unscanned platforms forbidden');
  const image = runnable[0];
  assert.equal(image.config.config?.Labels?.['org.opencontainers.image.revision'], sourceSha, 'image revision mismatch');
  assert.equal(image.config.config?.Labels?.['org.opencontainers.image.source'], REPOSITORY, 'image repository mismatch');
  assert.equal(image.config.config?.User, 'mcp');
  assert.deepEqual(image.config.config?.Cmd, ['node', 'dist/index.js']);
  const attestations = manifests.filter(item => item.descriptor.annotations?.['vnd.docker.reference.digest'] === image.descriptor.digest);
  const statements = attestations.flatMap(item => item.document.layers.map(layer => JSON.parse(blob(layer))));
  const provenance = statements.filter(statement => statement.predicateType === PROVENANCE_TYPE);
  assert.equal(provenance.length, 1, 'one BuildKit provenance statement required');
  assert.ok(provenance[0].subject?.some(subject => subject.digest?.sha256 === image.descriptor.digest.slice(7)), 'provenance subject mismatch');
  verifyProvenance(provenance[0].predicate, sourceSha);
  assert.ok(statements.some(statement => statement.predicateType === 'https://spdx.dev/Document' && statement.subject?.some(subject => subject.digest?.sha256 === image.descriptor.digest.slice(7))), 'BuildKit image SBOM required');
  return { sourceSha, digest: root.digest, runtimeDigest: image.descriptor.digest, configDigest: image.document.config.digest, provenance: provenance[0].predicate };
}

// Called only on output from successful identity/issuer-bound Cosign verification.
export function verifySignedAttestation(text, type, sourceSha, digest, expectedPredicate) {
  assert.match(digest ?? '', /^sha256:[0-9a-f]{64}$/);
  let documents;
  try { documents = JSON.parse(text); }
  catch { documents = text.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  const envelopes = Array.isArray(documents) ? documents : [documents];
  assert.ok(envelopes.length, 'no verified attestations');
  for (const envelope of envelopes) {
    assert.equal(envelope.payloadType, 'application/vnd.in-toto+json');
    assert.ok(envelope.signatures?.length, 'missing signature');
    const bytes = Buffer.from(envelope.payload, 'base64');
    assert.equal(bytes.toString('base64'), envelope.payload, 'invalid base64');
    const statement = JSON.parse(bytes.toString('utf8'));
    assert.ok(['https://in-toto.io/Statement/v0.1', 'https://in-toto.io/Statement/v1'].includes(statement._type));
    assert.equal(statement.predicateType, type);
    assert.equal(statement.subject?.length, 1);
    assert.equal(statement.subject[0].digest?.sha256, digest.slice(7), 'signed subject differs from published digest');
    if (type === PROVENANCE_TYPE) verifyProvenance(statement.predicate, sourceSha);
    assert.deepEqual(statement.predicate, expectedPredicate, 'signed predicate differs from validated evidence');
  }
}

export function summarizeScan(report) {
  // Retain finding identifiers only, never matched secrets or source excerpts.
  return (report.Results ?? []).map(result => ({
    type: result.Type,
    vulnerabilities: (result.Vulnerabilities ?? []).map(item => ({ id: item.VulnerabilityID, severity: item.Severity, fixedVersion: item.FixedVersion })),
    secrets: (result.Secrets ?? []).map(item => ({ rule: item.RuleID, severity: item.Severity })),
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'guard') verifyPublishInputs(process.env);
  else if (command === 'oci') {
    const result = verifyOci(input, process.env.EXPECTED_SHA, process.env.IMAGE_DIGEST);
    writeFileSync(resolve(output, 'image-metadata.json'), JSON.stringify({ ...result, provenance: undefined }, null, 2));
    writeFileSync(resolve(output, 'verified-provenance.json'), JSON.stringify(result.provenance, null, 2));
  } else if (command === 'scan-summary') {
    writeFileSync(output, JSON.stringify(summarizeScan(JSON.parse(readFileSync(input, 'utf8'))), null, 2));
  } else if (command === 'signed-provenance' || command === 'signed-sbom') {
    verifySignedAttestation(readFileSync(input, 'utf8'), command === 'signed-provenance' ? PROVENANCE_TYPE : 'https://cyclonedx.org/bom', process.env.SOURCE_SHA, process.env.DIGEST, JSON.parse(readFileSync(output, 'utf8')));
  } else throw new Error('Unknown release-check command');
}
