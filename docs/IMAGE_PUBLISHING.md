# Summit image validation and manual publication

Pull requests and pushes to `main` automatically run source lint, typecheck,
tests, build, production dependency audit, source/image secret scans, image
vulnerability checks, runtime alignment, and source/image SBOM generation.
`Validate source and runtime image` retains sanitized scan findings and SBOMs
as workflow artifacts. Existing CI, MCP assertion, Semgrep and fork release
guard checks retain their names.

The validation job builds one `linux/amd64` OCI archive with BuildKit maximum
provenance and SPDX SBOM attestations. It verifies the complete content-addressed
blob graph, source revision, repository and provenance, then loads that archive
for scanning and runtime checks. The image configuration digest must match the
archive. Scan evidence contains identifiers and severities, never matched secret
values or source excerpts. The policy continues to block high/critical fixable
OS/library vulnerabilities and production dependency advisories.

## Deliberate publication

After review and merge, an operator can select `main` in **Fork Image Publish
(ACR only)** and enter the full SHA selected for that dispatch, the fixed
`summititmcpacr.azurecr.io` / `itglue-mcp` destination, and confirmation `true`.
The source SHA must equal GitHub's dispatched workflow SHA. A typo, feature
branch, fork, different source SHA, false confirmation or different destination
fails before source checks or Azure credentials are used. If `main` advances,
select the intended current main SHA again when creating a new dispatch.

The publisher reruns validation, downloads only the resulting same-run archive,
verifies it again, and transfers all its manifests with digest preservation.
There is no credentialed rebuild. Publication uses the unique tag
`sha-<full-source-SHA>-r<run-ID>-a<run-attempt>`; existing tags and ambiguous
registry access fail closed. The image repository must already exist. Workflow
concurrency serializes publication; external writers must also avoid tag reuse.
Deployable identity is always
`summititmcpacr.azurecr.io/itglue-mcp@sha256:<digest>`.

Before reporting success, the job checks registry bytes against the scanned
index digest, signs that digest with keyless Cosign, attaches CycloneDX SBOM and
validated BuildKit provenance, and verifies both signatures and signed claims.
Verification requires this exact identity and issuer:

```text
https://github.com/DDePuy2015/itglue-mcp/.github/workflows/fork-image-publish.yml@refs/heads/main
https://token.actions.githubusercontent.com
```

The signed subject must match the published index digest; signed predicates
must match the validated evidence and source SHA. BuildKit's embedded statements
also bind provenance/SBOM to the runnable image manifest within that index.
Publication artifacts record source SHA, index/runtime/config digests, tag,
workflow run and verification results. A failed signing or verification step
leaves a published but unapproved artifact; it must not be deployed. Use a new
run/tag for a corrected attempt.

## Existing identity prerequisites

The repository needs protected `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
`AZURE_SUBSCRIPTION_ID` settings for an existing dedicated publisher identity.
Its federated credential must trust issuer
`https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`,
and subject `repo:DDePuy2015/itglue-mcp:ref:refs/heads/main`. Use narrowly scoped
ACR repository read/list/push permissions for `itglue-mcp`, including OCI
attestations/signatures. An ABAC-enabled registry can scope the repository writer
role to that repository. The identity must have no Container Apps deployment,
resource-group Contributor, role-assignment or secret-management authority.

Only the publication job requests `id-token: write`; validation uses read-only
GitHub permissions, with `packages: read` explicitly granted by its reusable
caller. No private Ops reusable workflow is called from this public repository.
This change documents prerequisites; it does not create identities, credentials,
federation, role assignments, environments or repository settings.

PR checks exercise the real local image/archive scans, all-manifest transfer to
a local OCI layout with digest preservation, and provenance validation.
Release-helper tests use synthetic OCI and signed-envelope fixtures to test
rejection paths. They do not establish live Azure federation, registry write,
Sigstore service availability or actual certificate issuance. Validate those
only during a separately authorized manual publication.

This workflow publishes artifacts only. Container Apps revision creation,
traffic changes and deployment remain a separately approved operator procedure
under the Summit operations contract.

## Workflow audit observations

The inherited `CI / build` repeats typecheck/build already covered by container
validation. Its check name is retained until downstream check dependencies are
reviewed. `add-to-project.yml` targets an upstream Wyre project and currently
skips project writes when its app credentials are absent. `Release / Fork release
disabled` is an echo-only safety guard. These are candidates for a separate
workflow cleanup; this replacement does not delete them or weaken security gates.
