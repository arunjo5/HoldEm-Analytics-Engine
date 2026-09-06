// saved ranges and saved solves (per-account library)
import { apiCall, jsonBody } from './api.js';

export const listRanges = () => apiCall('/api/ranges');
export const createRange = ({ name, keys }) => apiCall('/api/ranges', { method: 'POST', ...jsonBody({ name, keys }) });
export const updateRange = (id, fields) => apiCall(`/api/ranges/${encodeURIComponent(id)}`, { method: 'PATCH', ...jsonBody(fields) });
export const deleteRange = (id) => apiCall(`/api/ranges/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listSolves = () => apiCall('/api/solves');
export const createSolve = ({ name, config, summary }) => apiCall('/api/solves', { method: 'POST', ...jsonBody({ name, config, summary }) });
export const renameSolve = (id, name) => apiCall(`/api/solves/${encodeURIComponent(id)}`, { method: 'PATCH', ...jsonBody({ name }) });
export const deleteSolve = (id) => apiCall(`/api/solves/${encodeURIComponent(id)}`, { method: 'DELETE' });
