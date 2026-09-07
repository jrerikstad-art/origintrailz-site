# PUBLIC WORLD — Vercel adapter

Status: prepared client + API surface. Full Sandbox bake proof requires Vercel env + Blob + field token.

## Routes

| Path | Role |
|------|------|
| `GET /api/world/healthz` | API up + worker heartbeat |
| `POST /api/world/__factory/request-cell` | `{ cellId, ring }` + `X-OTZ-Field-Token` |
| `GET /api/world/__factory/cell-status` | Bake state |
| `POST /api/world/jobs/start-bake` | Kick GENERATING (stub/sandbox) |
| `POST /api/world/jobs/publish-result` | Commit READY + tile URL list |
| `GET /api/world/world/*` | Published tiles via `OTZ_BLOB_PUBLIC_BASE` |
| `/map` | Real World Engine shell (not landing GLB) |

## Env (Vercel project — do not commit)

- `OTZ_FIELD_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `OTZ_BLOB_PUBLIC_BASE` (public Blob prefix for `published/<revision>/…`)
- `OTZ_PIPELINE_REVISION` (default `norway-g2-2026.09`)
- `OTZ_BAKE_MODE` = `stub` | `sandbox`

## One-cell bake (operator / Sandbox)

From `origintrailz-v4/world-lab`:

```bash
python tools/factory/cloud_cell_job.py --cell-id NO-25832-XXX-YYYY --out /tmp/otz-cell
# upload published/* to Blob under published/$OTZ_PIPELINE_REVISION/
curl -X POST https://origintrailz.com/api/world/jobs/publish-result \
  -H "Content-Type: application/json" \
  -H "X-OTZ-Field-Token: $OTZ_FIELD_TOKEN" \
  -d @/tmp/otz-cell/publish-result.json
```

## Client contract

Phone / `/map` use:

- Bundled or same-origin `/world` for pack tiles
- `factoryBaseUrl=https://origintrailz.com/api/world` for enqueue + remote published reads
- Never set `worldBaseUrl` to the factory on mobile (tile GETs stay local-first)
