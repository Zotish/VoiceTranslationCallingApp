import axios from 'axios';

let resolvedBackendUrl = process.env.REACT_APP_BACKEND_URL || null;
let backendResolutionPromise = null;

function withTimeout(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    method: 'GET',
    signal: controller.signal
  }).finally(() => {
    window.clearTimeout(timer);
  });
}

async function probeBackend(baseUrl) {
  try {
    const response = await withTimeout(`${baseUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function detectBackendUrl() {
  if (resolvedBackendUrl) return resolvedBackendUrl;
  if (backendResolutionPromise) return backendResolutionPromise;

  backendResolutionPromise = (async () => {
    const { protocol, hostname, origin } = window.location;
    const localHosts = hostname === 'localhost' || hostname === '127.0.0.1';
    const candidates = [
      origin,
      `${protocol}//${hostname}:5001`,
      `${protocol}//${hostname}:5000`,
      ...(localHosts ? [] : [`${protocol}//localhost:5001`, `${protocol}//localhost:5000`])
    ].filter(Boolean);

    for (const candidate of [...new Set(candidates)]) {
      if (await probeBackend(candidate)) {
        resolvedBackendUrl = candidate;
        return candidate;
      }
    }

    resolvedBackendUrl = `${protocol}//${hostname}:5001`;
    return resolvedBackendUrl;
  })();

  const result = await backendResolutionPromise;
  backendResolutionPromise = null;
  return result;
}

export async function getBackendUrl() {
  return detectBackendUrl();
}

const API = axios.create();

API.interceptors.request.use(async (config) => {
  const baseUrl = await detectBackendUrl();
  config.baseURL = `${baseUrl}/api`;

  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export const register = (data) => API.post('/auth/register', data);
export const login = (data) => API.post('/auth/login', data);
export const getMe = () => API.get('/auth/me');
export const updateProfile = (data) => API.put('/auth/profile', data);
export const linkTelegram = (data) => API.post('/auth/link-telegram', data);
export const linkWhatsapp = (data) => API.post('/auth/link-whatsapp', data);
export const searchUser = (email) => API.get(`/auth/search?email=${encodeURIComponent(email)}`);

export const getContacts = () => API.get('/contacts');
export const addContact = (data) => API.post('/contacts', data);
export const deleteContact = (id) => API.delete(`/contacts/${id}`);

export const getCallHistory = () => API.get('/calls/history');
export const logCall = (data) => API.post('/calls/log', data);

export const uploadVoiceSample = (formData) => API.post('/voice/clone', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  timeout: 60000
});
export const getVoiceStatus = () => API.get('/voice/status');
export const deleteVoiceClone = () => API.delete('/voice/clone');

export default API;
