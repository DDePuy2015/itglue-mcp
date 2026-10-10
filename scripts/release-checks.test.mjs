import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PROVENANCE_TYPE, REPOSITORY, verifyPublishInputs, verifyOci, verifyProvenance, verifySignedAttestation, summarizeScan, verifySourceSbom } from './release-checks.mjs';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const provenance = () => ({
  buildType: 'https://mobyproject.org/buildkit@v1',
  metadata: { 'https://mobyproject.org/buildkit@v1#metadata': { vcs: { revision: sha, source: `${REPOSITORY}.git` } } },
  buildConfig: { llbDefinition: [{ op: 'build' }] },
  invocation: { parameters: { args: {} } },
});
const approved = () => ({ GITHUB_REPOSITORY: 'DDePuy2015/itglue-mcp', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, SOURCE_SHA: sha, RELEASE_CONFIRMATION: 'true', ACR_LOGIN_SERVER: 'summititmcpacr.azurecr.io', IMAGE_REPOSITORY: 'itglue-mcp' });

test('publication rejects fork, feature ref, different SHA, malformed SHA, missing confirmation and destination changes', () => {
  verifyPublishInputs(approved());
  for (const patch of [
    { GITHUB_REPOSITORY: 'attacker/itglue-mcp' }, { GITHUB_REF: 'refs/heads/feature' },
    { SOURCE_SHA: 'c'.repeat(40) }, { SOURCE_SHA: `${sha};echo injected` },
    { RELEASE_CONFIRMATION: 'false' }, { ACR_LOGIN_SERVER: 'attacker.azurecr.io' }, { IMAGE_REPOSITORY: 'other' },
  ]) assert.throws(() => verifyPublishInputs({ ...approved(), ...patch }));
});

test('provenance rejects source substitution, missing maximum-mode data and credential build arguments', () => {
  verifyProvenance(provenance(), sha);
  const otherSource = provenance();
  otherSource.metadata['https://mobyproject.org/buildkit@v1#metadata'].vcs.source = 'https://github.com/attacker/source';
  assert.throws(() => verifyProvenance(otherSource, sha));
  assert.throws(() => verifyProvenance(provenance(), 'c'.repeat(40)));
  assert.throws(() => verifyProvenance({ ...provenance(), buildConfig: {} }, sha));
  const credential = provenance();
  credential.invocation.parameters.args.GITHUB_TOKEN = 'fixture-placeholder';
  assert.throws(() => verifyProvenance(credential, sha));
});

function ociFixture({ includeSbom = true, revision = sha } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'itglue-oci-'));
  mkdirSync(join(directory, 'blobs', 'sha256'), { recursive: true });
  const blob = (value, mediaType = 'application/vnd.oci.image.manifest.v1+json') => {
    const bytes = Buffer.from(JSON.stringify(value));
    const hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(directory, 'blobs', 'sha256', hash), bytes);
    return { digest: `sha256:${hash}`, size: bytes.length, mediaType };
  };
  const config = blob({ architecture: 'amd64', os: 'linux', config: { User: 'mcp', Cmd: ['node', 'dist/index.js'], Labels: { 'org.opencontainers.image.revision': revision, 'org.opencontainers.image.source': REPOSITORY } } });
  const image = blob({ schemaVersion: 2, config, layers: [blob({ fixture: 'image layer' }, 'application/vnd.oci.image.layer.v1.tar')] });
  const statement = (predicateType, predicate) => blob({ _type: 'https://in-toto.io/Statement/v0.1', predicateType, subject: [{ name: 'image', digest: { sha256: image.digest.slice(7) } }], predicate }, 'application/vnd.in-toto+json');
  const layers = [statement(PROVENANCE_TYPE, provenance())];
  if (includeSbom) layers.push(statement('https://spdx.dev/Document', { spdxVersion: 'SPDX-2.3' }));
  const attestation = blob({ config: blob({}), layers });
  attestation.annotations = { 'vnd.docker.reference.digest': image.digest, 'vnd.docker.reference.type': 'attestation-manifest' };
  const root = blob({ schemaVersion: 2, manifests: [image, attestation] }, 'application/vnd.oci.image.index.v1+json');
  writeFileSync(join(directory, 'index.json'), JSON.stringify({ manifests: [root] }));
  return { directory, root, config, image };
}

test('OCI verification binds complete blob graph, image config, source, SBOM and provenance to the exported digest', () => {
  const fixture = ociFixture();
  try {
    const result = verifyOci(fixture.directory, sha, fixture.root.digest);
    assert.equal(result.configDigest, fixture.config.digest);
    assert.equal(result.runtimeDigest, fixture.image.digest);
    assert.throws(() => verifyOci(fixture.directory, sha, digest));
    writeFileSync(join(fixture.directory, 'blobs', 'sha256', fixture.config.digest.slice(7)), 'tampered');
    assert.throws(() => verifyOci(fixture.directory, sha, fixture.root.digest));
  } finally { rmSync(fixture.directory, { recursive: true }); }
  for (const options of [{ includeSbom: false }, { revision: 'c'.repeat(40) }]) {
    const invalid = ociFixture(options);
    try { assert.throws(() => verifyOci(invalid.directory, sha, invalid.root.digest)); }
    finally { rmSync(invalid.directory, { recursive: true }); }
  }
});

function envelope(predicate, type = PROVENANCE_TYPE, subjectDigest = digest) {
  return { payloadType: 'application/vnd.in-toto+json', signatures: [{ sig: 'verified-fixture' }], payload: Buffer.from(JSON.stringify({ _type: 'https://in-toto.io/Statement/v1', predicateType: type, subject: [{ digest: { sha256: subjectDigest.slice(7) } }], predicate })).toString('base64') };
}

test('verified signed statements must contain the exact image digest, source and validated predicate', () => {
  const expected = provenance();
  verifySignedAttestation(JSON.stringify(envelope(expected)), PROVENANCE_TYPE, sha, digest, expected);
  verifySignedAttestation(`${JSON.stringify(envelope(expected))}\n${JSON.stringify(envelope(expected))}`, PROVENANCE_TYPE, sha, digest, expected);
  assert.throws(() => verifySignedAttestation(JSON.stringify(envelope(expected, PROVENANCE_TYPE, `sha256:${'c'.repeat(64)}`)), PROVENANCE_TYPE, sha, digest, expected));
  assert.throws(() => verifySignedAttestation(JSON.stringify(envelope(expected)), PROVENANCE_TYPE, 'c'.repeat(40), digest, expected));
  const sbom = { bomFormat: 'CycloneDX', components: [{ name: 'fixture' }] };
  verifySignedAttestation(JSON.stringify(envelope(sbom, 'https://cyclonedx.org/bom')), 'https://cyclonedx.org/bom', sha, digest, sbom);
  assert.throws(() => verifySignedAttestation(JSON.stringify(envelope({ ...sbom, components: [] }, 'https://cyclonedx.org/bom')), 'https://cyclonedx.org/bom', sha, digest, sbom));
  assert.throws(() => verifySignedAttestation(JSON.stringify({ ...envelope(expected), signatures: [] }), PROVENANCE_TYPE, sha, digest, expected));
});

test('scan evidence excludes matched secrets, paths and source excerpts', () => {
  const report = { Results: [{ Target: 'private-path', Type: 'node-pkg', Secrets: [{ RuleID: 'fixture', Severity: 'HIGH', Match: 'private-content', Code: { Lines: ['private-content'] } }], Vulnerabilities: [{ VulnerabilityID: 'CVE-fixture', Severity: 'HIGH', FixedVersion: '2', Description: 'private-content' }] }] };
  const output = JSON.stringify(summarizeScan(report));
  assert.ok(!output.includes('private-content'));
  assert.ok(!output.includes('private-path'));
  assert.ok(output.includes('CVE-fixture'));
});

test('source SBOM rejects empty inventories and missing or substituted production packages', () => {
  const lock = { packages: { '': {}, 'node_modules/@fixture/sdk': { version: '1.0.0' }, 'node_modules/transitive': { version: '2.0.0' }, 'node_modules/build-only': { version: '3.0.0', dev: true } } };
  const valid = { bomFormat: 'CycloneDX', components: [{ purl: 'pkg:npm/%40fixture/sdk@1.0.0' }, { purl: 'pkg:npm/transitive@2.0.0' }] };
  verifySourceSbom(valid, lock);
  assert.throws(() => verifySourceSbom({ ...valid, components: [] }, lock));
  assert.throws(() => verifySourceSbom({ ...valid, components: valid.components.slice(0, 1) }, lock));
  assert.throws(() => verifySourceSbom({ ...valid, components: [{ purl: 'pkg:npm/%40fixture/sdk@0.0.1' }, valid.components[1]] }, lock));
});
