# Public World worker repair

This package wires the Vercel site to the current World Lab factory. It does
not include a geography pack or credentials.

## What is repaired

- Sandbox output is read through the async SDK file API, not `stdout` string properties.
- The Sandbox never receives the Blob or field token. Its job runs with
  `--skip-blob-upload`; the Vercel function uploads through `@vercel/blob`.
- Each upload uses an immutable content-addressed prefix:
  `published/<pipelineRevision>/cells/<cellId>/<batchHash>/<terrain|semantic>/...`.
  The public tile proxy follows the cell's verified READY pointer. A partial
  upload and changed build timestamps cannot block a later attempt. Legacy
  published paths remain readable.
- A cell is READY only after all 16 terrain metadata files, 16 matching
  `terrain.bin` payloads, and all 64 semantic tiles pass identity/schema checks
  and are readable from Blob.
- A request-cell response no longer writes its stale QUEUED copy over a later
  GENERATING, VALIDATING, FAILED, or READY state.
- Blob write failures are surfaced instead of being silently converted into a
  process-local success.
- Missing worker configuration returns 503 instead of a fake queued job.
- `npm run verify:world` refuses a stub before any field test. With a cell ID
  and the tested APK's coverage index, it checks a new outside-pack bake and
  all 96 public files with two independent HTTP readers.

The worker remains deliberately bounded. `waitUntil` keeps one bake alive for
the 202 response, with a five-minute function ceiling and a lease that allows a
later request to retry. This is not an unlimited distributed queue; add a
durable queue/workflow before enabling high-volume concurrent baking.

## Build a portable snapshot

Run from this website repository, with the World Lab checkout available on the
same machine:

```text
npm ci
npx vercel link --project origintrailz-site
npx vercel env pull .env.local
node --env-file=.env.local scripts/build-factory-snapshot.mjs --engine-root /path/to/origintrailz-v4/world-lab
```

The script copies only factory source and `tools/requirements.txt`, creates a
portable `public/world/config.json`, installs `numpy`, `Pillow`, `pyproj`, and
`tifffile` in a Python 3.13 Sandbox, imports the job as a smoke test, and prints
the resulting snapshot ID. No Blob token is written into the snapshot.

Use the Vercel account that owns the project. The linked project's OIDC token
authenticates the snapshot builder. Alternatively supply `VERCEL_TOKEN`,
`VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` through the operator's environment.
Never paste those values into a chat or commit them. Run `--check-source`
first to validate the source files without creating a VM.

The factory source is owned by `origintrailz-v4`; it is not duplicated into
this public website repository. Source preflight was checked against app
commit `3955ca9ef7eca2837c3b39ed12f43d38ca3b3f7f` (dev56). Dev57 was not
available on the inspected branches. The snapshot contains source and
dependencies; it does not contain the Bergura pack or set a geographic limit.

## Vercel production variables

Set these in the Vercel project (values are intentionally not stored here):

```text
OTZ_BAKE_MODE=sandbox
OTZ_BAKE_SNAPSHOT_ID=<snapshot id printed by the script>
BLOB_READ_WRITE_TOKEN=<Vercel Blob read/write token>
OTZ_BLOB_PUBLIC_BASE=https://<store>.public.blob.vercel-storage.com
OTZ_FIELD_TOKEN=<shared field token>
OTZ_PUBLISH_TOKEN=<separate operator token>
OTZ_PIPELINE_REVISION=norway-g2-2026.09
```

`OTZ_BLOB_PUBLIC_BASE` is the public Blob host only; it must be HTTPS and must
not contain a query string. Keep the field and publish tokens different. The
mobile client sends only `cellId` and the field token; it never sends longitude,
latitude, or Blob credentials.

Apply the variables to **production**, including
`OTZ_BAKE_WORKDIR=/vercel/sandbox/world-lab`, then deploy this branch's API
changes through the normal release process. Setting the variables without
deploying the artifact bridge is insufficient. Preserve any newer local
website/hero work when merging this focused change.

Configure the phone's existing Factory/World source setting to the exact
HTTPS base that passes the verification below, and enter the same field
token. Check `origintrailz.com/api/world/healthz` separately before choosing
the custom domain; a working `vercel.app` endpoint does not prove the custom
domain is routed correctly. No APK rebuild is required solely to change an
exposed factory URL setting.

## Acceptance for the first cell

Run the configuration check first:

```text
npm run verify:world -- --base https://origintrailz-site.vercel.app/api/world
```

Only after it passes, choose a previously unpublished Norway cell outside
the tested APK pack. Supply the actual APK's `coverage-index.json`, not the
landing page's showcase manifest. Set `OTZ_FIELD_TOKEN` in the local
environment and run:

```text
npm run verify:world -- --base https://origintrailz-site.vercel.app/api/world --cell NO-25832-318-6547 --bundled-coverage /path/to/apk/world/coverage-index.json
```

The example is a candidate to verify, not a claimed supported/baked fixture.
The command refuses overlap, a pre-existing READY cell, a stub or missing
files. It checks mobile CORS, waits for the same job to finish, downloads
all 16 terrain JSONs, 16 binaries and 64 semantics twice, and compares
hashes with no intervening generation.

Its successful report explicitly says `phoneRendering: NOT_TESTED`.
Finish acceptance on the physical phone using mobile data, GPS outside the
pack and this same endpoint: new terrain must appear at the committed
position. Repeat on a second device. Do not call dev57 or public generation
fixed before this physical-device test.

## Evidence from 10 September 2026

- 20 local worker/publication/proof tests pass (mocked Sandbox/Blob transport).
- All 19 snapshot inputs pass source preflight against the referenced app commit.
- The real public preflight still fails with `generation_disabled`, because
  production reports `bakeMode: stub`, no snapshot, and no field token.
- Vercel project access returned 403 in this session. No snapshot was
  created, no environment values were changed and no live cell was baked.

This is a code repair ready for review and activation, not a production pass.

If any file is missing or changed between upload and verification, the cell
stays non-ready and the response names the failed artifact. Do not mark a cell
READY from the Python `publish-result.json` alone.

## Follow-up after CLI activation

The operator reports production was activated through their Node CLI session.
Fresh public HTTP checks on 11 September confirm:

- `https://origintrailz-site.vercel.app/api/world/healthz` returns 200 with
  `bakeMode: sandbox`, `autoPublish: true`, `durableStore: true`,
  `tileProxy: true`, and `fieldTokenRequired: true`.
- That response does not include `sandboxConfigured` or this repair's
  `workerImplementation` marker. This leaves the exact deployed worker
  unverified. A successful health response is not a new-cell bake proof.
- The mobile request-cell OPTIONS preflight returns 204 and allows
  `http://127.0.0.1:18743` and `X-OTZ-Field-Token`.
- `https://origintrailz.com/api/world/healthz` returns a 404 HTML page titled
  `Build incomplete`. The custom domain has not passed the same API check.
- The sampled terrain and semantic URLs for candidate cell
  `NO-25832-318-6547` return 404. No authenticated bake was requested here;
  this does not establish a worker failure.

Next actions for the authorized CLI operator:

1. Confirm the active deployment contains this repair or equivalent artifact
   validation/publication fixes. PR #3 was still open at this check. Preserve
   newer local website work when integrating it.
2. Resolve the custom domain's Vercel project/DNS routing and require a JSON
   health response there. Until that passes, use the verified `vercel.app`
   factory base in the phone's existing factory setting, with the field token
   supplied through the app's token setting. Never put tokens in a report.
3. Run the acceptance command above from the authenticated operator session,
   using the actual tested APK's coverage index. If readiness fields are
   absent, the command now says `generation_configuration_unverified` rather
   than incorrectly claiming the worker is still disabled.
4. Capture the same job reaching READY, both independent reads of all 96
   artifacts, and the physical phone rendering that new cell over mobile data.

The connected Vercel MCP still returned no teams and project access 403 in
this session; the field token and CLI credentials are not available here.
The operator's CLI is the current activation route. Do not repeat OAuth
reconnection as a substitute for the domain and bake checks above.
