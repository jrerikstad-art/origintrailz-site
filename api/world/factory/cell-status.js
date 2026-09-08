import { checkFieldToken, handleOptions, json } from '../../../lib/world-api/http.js';
import { listCells } from '../../../lib/world-api/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'GET') return json(res, req, 405, { ok: false, error: 'method' });

  const auth = checkFieldToken(req);
  if (!auth.ok) return json(res, req, 401, { ok: false, error: 'unauthorized' });

  const url = new URL(req.url, 'http://localhost');
  const one = url.searchParams.get('cellId');
  const many = url.searchParams.get('cellIds');
  const ids = [];
  if (one) ids.push(one);
  if (many) ids.push(...many.split(',').map((s) => s.trim()).filter(Boolean));
  if (ids.length === 0) {
    return json(res, req, 400, { ok: false, error: 'cellId_required' });
  }
  if (ids.length > 32) {
    return json(res, req, 400, { ok: false, error: 'too_many_cells' });
  }

  const cells = await listCells(ids);
  return json(res, req, 200, { cells });
}
