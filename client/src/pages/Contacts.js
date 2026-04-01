import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useCall } from '../context/CallContext';
import * as api from '../services/api';

const LANG_NAMES = {
  bn: 'Bangla', zh: 'Chinese', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', th: 'Thai', vi: 'Vietnamese',
  it: 'Italian', ms: 'Malay', id: 'Indonesian', ur: 'Urdu', ta: 'Tamil'
};

function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { onlineUsers } = useSocket();
  const { callUser } = useCall();
  const navigate = useNavigate();

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const res = await api.getContacts();
      setContacts(res.data);
    } catch (err) {
      console.error('Failed to load contacts');
    }
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const res = await api.addContact({ email });
      setContacts(prev => [...prev, res.data]);
      setEmail('');
      setSuccess('Contact added!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add contact');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteContact(id);
      setContacts(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete contact');
    }
  };

  const handleCall = (contact) => {
    callUser(contact);
    navigate('/call');
  };

  return (
    <div className="contacts-page">
      <h1>Contacts</h1>

      <div className="card add-contact-card">
        <h2>Add Contact</h2>
        <form onSubmit={handleAddContact} className="add-contact-form">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter contact's email"
            required
          />
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}
      </div>

      <div className="card">
        <h2>Your Contacts ({contacts.length})</h2>
        {contacts.length === 0 ? (
          <p className="empty-text">No contacts yet. Add someone by their email!</p>
        ) : (
          <div className="contact-list">
            {contacts.map(contact => (
              <div key={contact.id} className="contact-item">
                <div className="contact-info">
                  <div className="contact-avatar">{contact.name[0].toUpperCase()}</div>
                  <div>
                    <div className="contact-name">{contact.name}</div>
                    <div className="contact-lang">{LANG_NAMES[contact.language] || contact.language}</div>
                    <div className="contact-email">{contact.email}</div>
                  </div>
                  <span className={`status-dot ${onlineUsers.includes(contact.userId) ? 'online' : 'offline'}`} />
                </div>
                <div className="contact-actions">
                  <button className="btn btn-call" onClick={() => handleCall(contact)}>
                    &#9742; Call
                  </button>
                  <button className="btn btn-danger-sm" onClick={() => handleDelete(contact.id)}>
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Contacts;
