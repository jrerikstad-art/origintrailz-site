/**
 * Vercel Workflow stub for one-cell bake.
 * Wire to @vercel/workflow when the project enables Workflows + Sandbox snapshot
 * containing cloud_cell_job.py + numpy/Pillow/pyproj/tifffile.
 *
 * Until then, operators run cloud_cell_job.py externally and POST publish-result.
 */
export async function bakeCellWorkflow(cellId: string): Promise<{ cellId: string; mode: string }> {
  return {
    cellId,
    mode: 'stub — enable Workflows/Sandbox snapshot before claiming Vercel compute proof',
  };
}
