import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useCall } from '../context/CallContext';
import * as api from '../services/api';

const LANG_NAMES = {
  bn: 'Bangla', zh: 'Chinese', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', th: 'Thai', vi: 'Vietnamese',
  it: 'Italian', ms: 'Malay', id: 'Indonesian', ur: 'Urdu', ta: 'Tamil'
};

function Dashboard() {
  const { user } = useAuth();
  const { onlineUsers } = useSocket();
  const { callUser } = useCall();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [callHistory, setCallHistory] = useState([]);

  useEffect(() => {
    api.getContacts().then(res => setContacts(res.data)).catch(() => {});
    api.getCallHistory().then(res => setCallHistory(res.data)).catch(() => {});
  }, []);

  const handleCall = (contact) => {
    callUser(contact);
    navigate('/call');
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (timestamp) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="dashboard-page">
      <div className="welcome-section">
        <h1>Welcome, {user?.name}</h1>
        <p>Your language: <strong>{LANG_NAMES[user?.language] || user?.language}</strong></p>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h2>Quick Call</h2>
          {contacts.length === 0 ? (
            <p className="empty-text">No contacts yet. <span className="link" onClick={() => navigate('/contacts')}>Add contacts</span></p>
          ) : (
            <div className="contact-list">
              {contacts.slice(0, 5).map(contact => (
                <div key={contact.id} className="contact-item">
                  <div className="contact-info">
                    <div className="contact-avatar">{contact.name[0].toUpperCase()}</div>
                    <div>
                      <div className="contact-name">{contact.name}</div>
                      <div className="contact-lang">{LANG_NAMES[contact.language] || contact.language}</div>
                    </div>
                    <span className={`status-dot ${onlineUsers.includes(contact.userId) ? 'online' : 'offline'}`} />
                  </div>
                  <button className="btn btn-call" onClick={() => handleCall(contact)}>
                    &#9742; Call
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Call History</h2>
          {callHistory.length === 0 ? (
            <p className="empty-text">No calls yet</p>
          ) : (
            <div className="history-list">
              {callHistory.slice(0, 10).map(call => (
                <div key={call.id} className="history-item">
                  <div className="history-icon">
                    {call.type === 'outgoing' ? '↗' : '↙'}
                  </div>
                  <div className="history-info">
                    <div className="history-name">
                      {call.type === 'outgoing' ? call.calleeName : call.callerName}
                    </div>
                    <div className="history-meta">
                      {formatTime(call.timestamp)} · {formatDuration(call.duration)}
                    </div>
                  </div>
                  <div className="history-langs">
                    {LANG_NAMES[call.fromLang]} → {LANG_NAMES[call.toLang]}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
