import { collectCell, parseCellId, publicBase, publishedPrefix, uploadCell } from './cell-artifacts.mjs';

export function bakeConfiguration(env = process.env) {
  const mode = (env.OTZ_BAKE_MODE || 'stub').toLowerCase();
  const missing = ['OTZ_BAKE_SNAPSHOT_ID', 'BLOB_READ_WRITE_TOKEN', 'OTZ_BLOB_PUBLIC_BASE', 'OTZ_FIELD_TOKEN']
    .filter(key => !(env[key] || '').trim());
  if (mode !== 'sandbox') missing.unshift('OTZ_BAKE_MODE=sandbox');
  if (env.OTZ_BLOB_PUBLIC_BASE) {
    try { publicBase(env.OTZ_BLOB_PUBLIC_BASE); } catch { missing.push('valid HTTPS OTZ_BLOB_PUBLIC_BASE'); }
  }
  return { mode, missing, configured: mode === 'sandbox' && missing.length === 0 };
}

/** No Blob or field credentials enter the VM. Only validated, expected artifacts leave it. */
export async function runSandboxBake({ cellId, revision, snapshotId, base, workdir = '/vercel/sandbox/world-lab',
  timeoutMs = 240_000, vcpus = 4, signal, onValidating = async () => {},
  Sandbox, put, fetchImpl = fetch }) {
  parseCellId(cellId);
  publishedPrefix(revision);
  publicBase(base);
  if (!snapshotId) throw new Error('snapshot_required');
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  Sandbox ||= (await import('@vercel/sandbox')).Sandbox;
  put ||= (await import('@vercel/blob')).put;
  let sandbox;
  const started = Date.now();
  try {
    sandbox = await Sandbox.create({ source: { type: 'snapshot', snapshotId },
      resources: { vcpus }, timeout: timeoutMs, persistent: false, signal: deadline });
    const out = '/tmp/otz-out';
    const run = await sandbox.runCommand({ cmd: 'python',
      args: ['tools/factory/cloud_cell_job.py', '--cell-id', cellId, '--out', out,
        '--pipeline-revision', revision, '--force-rebuild', '--skip-blob-upload'],
      cwd: workdir, signal: deadline });
    if (run.exitCode !== 0) {
      // SDK stdout/stderr are asynchronous methods, not string properties.
      const detail = await run.stderr({ signal: deadline }).catch(() => '');
      throw new Error(`cloud_cell_job_exit_${run.exitCode}${detail ? `: ${detail.slice(-400)}` : ''}`);
    }
    const raw = await sandbox.readFileToBuffer({ path: `${out}/publish-result.json` }, { signal: deadline });
    if (!raw || raw.length > 256 * 1024) throw new Error('publish_result_missing_or_oversize');
    const result = JSON.parse(raw.toString('utf8'));
    if (result.cellId !== cellId || result.state !== 'READY') throw new Error('bake_result_not_ready');
    // Ignore result.tileUrls: Python's local paths are not published HTTPS assets.
    const cell = await collectCell(cellId, rel => sandbox.readFileToBuffer(
      { path: `${out}/${publishedPrefix(revision)}${rel}` }, { signal: deadline }));
    await onValidating({ sandboxId: sandbox.sandboxId });
    const published = await uploadCell({ cell, revision, base, put, fetchImpl, signal: deadline });
    return { ...published, cellId, state: 'READY', pipelineRevision: revision,
      sandboxId: sandbox.sandboxId, durationMs: Date.now() - started };
  } finally {
    // Cleanup uses its own deadline, even when the bake deadline was exceeded.
    if (sandbox) await sandbox.stop({ signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
}
