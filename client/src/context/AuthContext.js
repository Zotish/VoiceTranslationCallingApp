import React, { createContext, useContext, useState, useEffect } from 'react';
import * as api from '../services/api';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      api.getMe()
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const loginUser = async (email, password) => {
    const res = await api.login({ email, password });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const registerUser = async (name, email, password, language) => {
    const res = await api.register({ name, email, password, language });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const updateUserProfile = async (data) => {
    const res = await api.updateProfile(data);
    setUser(res.data);
    return res.data;
  };

  const linkTelegramAccount = async (telegramUsername) => {
    const res = await api.linkTelegram({ telegramUsername });
    setUser(res.data);
    return res.data;
  };

  const linkWhatsappAccount = async (phoneNumber) => {
    const res = await api.linkWhatsapp({ phoneNumber });
    setUser(res.data);
    return res.data;
  };

  const value = {
    user,
    token,
    loading,
    loginUser,
    registerUser,
    logout,
    updateUserProfile,
    linkTelegramAccount,
    linkWhatsappAccount
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
