# Summit MCP Operations Contract

Before changing or deploying this service, read the canonical platform contract:

https://github.com/DDePuy2015/summit-mcp-ops

Required references:

- `PLATFORM_CONTEXT.md`
- `DEPLOYMENT_RUNBOOK.md`
- `SERVICE_MAP.yaml`

Every Azure deployment requires a new `deploy/itglue/...` branch, a pull request
merged into `main`, an immutable ACR image digest, a staged Container Apps
rollout, and a deployment record in the operations repository. Keep this
repository limited to IT Glue MCP code. Password values, API keys, PSKs, JWTs,
and customer secrets must never enter source, logs, tests, or deployment
records.
