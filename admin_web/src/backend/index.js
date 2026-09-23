const mode = import.meta.env.VITE_BACKEND_MODE || 'http';

export const backendMode = mode;

export const backend = import('./http.js');

export async function signIn(username, password) {
  const adapter = await backend;
  return adapter.signIn(username, password);
}

export async function signOut() {
  const adapter = await backend;
  return adapter.signOut();
}

export async function getCurrentUser() {
  const adapter = await backend;
  return adapter.getCurrentUser();
}

export async function listOrders(filters = {}) {
  const adapter = await backend;
  return adapter.listOrders(filters);
}

export async function batchDownload(orderIds = []) {
  const adapter = await backend;
  return adapter.batchDownload(orderIds);
}

export async function listAccounts() {
  const adapter = await backend;
  return adapter.listAccounts();
}

export async function createAccount(data) {
  const adapter = await backend;
  return adapter.createAccount(data);
}

export async function updateAccount(id, data) {
  const adapter = await backend;
  return adapter.updateAccount(id, data);
}
