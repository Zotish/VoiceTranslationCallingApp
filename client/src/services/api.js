import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

const API = axios.create({
  baseURL: `${BACKEND_URL}/api`
});

// Attach JWT token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const register = (data) => API.post('/auth/register', data);
export const login = (data) => API.post('/auth/login', data);
export const getMe = () => API.get('/auth/me');
export const updateProfile = (data) => API.put('/auth/profile', data);
export const linkTelegram = (data) => API.post('/auth/link-telegram', data);
export const linkWhatsapp = (data) => API.post('/auth/link-whatsapp', data);
export const searchUser = (email) => API.get(`/auth/search?email=${encodeURIComponent(email)}`);

// Contacts
export const getContacts = () => API.get('/contacts');
export const addContact = (data) => API.post('/contacts', data);
export const deleteContact = (id) => API.delete(`/contacts/${id}`);

// Calls
export const getCallHistory = () => API.get('/calls/history');
export const logCall = (data) => API.post('/calls/log', data);

export { BACKEND_URL };
export default API;
