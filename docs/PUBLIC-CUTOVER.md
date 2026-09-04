# Public cutover — origintrailz.com

## Current state (2026-09-04)

| Host | Serves | Status |
|------|--------|--------|
| `https://origintrailz-site.vercel.app` | Marketing + WebGL hero | **Live** (GitHub → Vercel) |
| `https://origintrailz.com` | Lovable/Cloudflare empty shell | **404** — DNS not cut over |
| `world.` / `api.` / `factory.` | — | **Do not resolve** |
| LAN `http://127.0.0.1:8799` | Factory `serve_world` | Lab only |

Field phones must **not** use the marketing origin as `OTZ_WORLD_BASE`. World tiles + `__factory/*` are a separate HTTPS service.

## 1. Point the website at Vercel

In **Cloudflare → origintrailz.com → DNS**:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` | `cname.vercel-dns.com` | DNS only (grey) *or* follow Vercel’s domain UI |
| CNAME | `www` | `cname.vercel-dns.com` | same |

Then in **Vercel → origintrailz-site → Settings → Domains**, add:

- `origintrailz.com`
- `www.origintrailz.com`

Remove / disable the Lovable publish so Cloudflare stops returning `x-lovable-serve-error`.

## 2. Public World Service (GPS field phones)

This is the factory HTTPS endpoint phones hit after GPS places the player — **not** a GPS tracking server.

### Interim (PC awake)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).
2. Prefer a **named** tunnel so the URL is stable:

```text
https://world.origintrailz.com  →  http://127.0.0.1:8799
```

Cloudflare DNS:

| Type | Name | Target |
|------|------|--------|
| CNAME | `world` | `<tunnel-id>.cfargotunnel.com` |

3. Start stack:

```bat
tool\start-world-distribution.bat
```

4. Set `world-lab/factory/field-config.local.json`:

```json
{
  "publicWorldBase": "https://world.origintrailz.com",
  "fieldToken": "<strong-shared-secret>",
  "lanFallback": "http://10.0.0.5:8799",
  "factoryRoot": "C:/OrigintrailzWorld"
}
```

5. Rebuild field APK (`OTZ_WORLD_BASE` + `OTZ_FIELD_TOKEN` from that file).

6. Prove off-LAN:

```text
GET https://world.origintrailz.com/healthz
→ { "ok": true, "gate": "WORLD.DISTRIBUTION", ... }
```

Quick tunnels (`*.trycloudflare.com`) work for a one-hour prove-out but the URL changes every restart — named tunnel on `world.` is the right interim for friends.

### Hosted (Phase 4)

Same APIs on a VPS / always-on host with TLS. Retire the home PC. See [`GATE-WORLD-DISTRIBUTION.md`](../origintrailz-v4/world-lab/docs/GATE-WORLD-DISTRIBUTION.md) in the v4 repo.

## Do not

- Point APKs at `https://origintrailz.com` until `/healthz` and tile GETs succeed on that origin (they will not on the marketing site alone).
- Run Node factory workers on the Vercel marketing project.
- Commit `field-config.local.json` or real field tokens.
