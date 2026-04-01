import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const LANGUAGES = [
  { code: 'bn', name: 'Bangla (Bengali)' },
  { code: 'zh', name: 'Chinese' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'it', name: 'Italian' },
  { code: 'ms', name: 'Malay' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'ta', name: 'Tamil' }
];

function Settings() {
  const { user, updateUserProfile, linkTelegramAccount, linkWhatsappAccount, logout } = useAuth();
  const [language, setLanguage] = useState(user?.language || 'en');
  const [name, setName] = useState(user?.name || '');
  const [telegramUsername, setTelegramUsername] = useState(user?.linkedTelegram || '');
  const [whatsappNumber, setWhatsappNumber] = useState(user?.linkedWhatsapp || '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const showMsg = (text) => {
    setMsg(text);
    setError('');
    setTimeout(() => setMsg(''), 3000);
  };

  const showError = (text) => {
    setError(text);
    setMsg('');
    setTimeout(() => setError(''), 3000);
  };

  const handleUpdateProfile = async () => {
    try {
      await updateUserProfile({ name, language });
      showMsg('Profile updated!');
    } catch (err) {
      showError('Failed to update profile');
    }
  };

  const handleLinkTelegram = async () => {
    if (!telegramUsername) return showError('Enter Telegram username');
    try {
      await linkTelegramAccount(telegramUsername);
      showMsg('Telegram linked!');
    } catch (err) {
      showError('Failed to link Telegram');
    }
  };

  const handleLinkWhatsapp = async () => {
    if (!whatsappNumber) return showError('Enter WhatsApp number');
    try {
      await linkWhatsappAccount(whatsappNumber);
      showMsg('WhatsApp linked!');
    } catch (err) {
      showError('Failed to link WhatsApp');
    }
  };

  return (
    <div className="settings-page">
      <h1>Settings</h1>

      {msg && <div className="success-msg">{msg}</div>}
      {error && <div className="error-msg">{error}</div>}

      <div className="card">
        <h2>Profile</h2>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={user?.email || ''} disabled />
        </div>
        <div className="form-group">
          <label>Preferred Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={handleUpdateProfile}>Save Profile</button>
      </div>

      <div className="card">
        <h2>Link Telegram</h2>
        <p className="card-desc">Connect your Telegram account to receive calls through Telegram.</p>
        <div className="link-row">
          <input
            type="text"
            value={telegramUsername}
            onChange={(e) => setTelegramUsername(e.target.value)}
            placeholder="@username"
          />
          <button className="btn btn-secondary" onClick={handleLinkTelegram}>
            {user?.linkedTelegram ? 'Update' : 'Link'}
          </button>
        </div>
        {user?.linkedTelegram && (
          <p className="linked-status">Linked: @{user.linkedTelegram}</p>
        )}
      </div>

      <div className="card">
        <h2>Link WhatsApp</h2>
        <p className="card-desc">Connect your WhatsApp account to receive calls through WhatsApp.</p>
        <div className="link-row">
          <input
            type="text"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="+880 1XXX XXXXXX"
          />
          <button className="btn btn-secondary" onClick={handleLinkWhatsapp}>
            {user?.linkedWhatsapp ? 'Update' : 'Link'}
          </button>
        </div>
        {user?.linkedWhatsapp && (
          <p className="linked-status">Linked: {user.linkedWhatsapp}</p>
        )}
      </div>

      <div className="card">
        <button className="btn btn-danger" onClick={logout}>Sign Out</button>
      </div>
    </div>
  );
}

export default Settings;
