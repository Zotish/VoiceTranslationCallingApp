import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../services/api';

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

  // Voice cloning states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceCloned, setVoiceCloned] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // Check voice status on mount
  useEffect(() => {
    api.getVoiceStatus()
      .then(res => setVoiceCloned(res.data.voiceCloned))
      .catch(() => {});
  }, []);

  const showMsg = (text) => {
    setMsg(text);
    setError('');
    setTimeout(() => setMsg(''), 4000);
  };

  const showError = (text) => {
    setError(text);
    setMsg('');
    setTimeout(() => setError(''), 5000);
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

  // ===== VOICE RECORDING =====
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        setRecordedBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start(1000); // Collect in 1s chunks
      setIsRecording(true);
      setRecordingTime(0);
      setRecordedBlob(null);
      setAudioUrl(null);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      showError('Microphone access denied. Please allow microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const uploadVoice = async () => {
    if (!recordedBlob) return showError('Record your voice first');

    if (recordingTime < 10) {
      return showError('Recording too short! Please record at least 30 seconds for best results.');
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      const ext = recordedBlob.type.includes('webm') ? 'webm' : 'mp4';
      formData.append('voiceSample', recordedBlob, `voice_sample.${ext}`);

      const res = await api.uploadVoiceSample(formData);
      setVoiceCloned(true);
      showMsg('Voice cloned successfully! Your voice will be used in translated calls.');
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Voice cloning failed';
      showError(errMsg);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteVoice = async () => {
    try {
      await api.deleteVoiceClone();
      setVoiceCloned(false);
      setRecordedBlob(null);
      setAudioUrl(null);
      showMsg('Voice clone deleted');
    } catch (err) {
      showError('Failed to delete voice clone');
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="settings-page">
      <h1>Settings</h1>

      {msg && <div className="success-msg">{msg}</div>}
      {error && <div className="error-msg">{error}</div>}

      {/* ===== VOICE CLONE SECTION ===== */}
      <div className="card voice-clone-card">
        <h2>Voice Clone</h2>
        <p className="card-desc">
          Record your voice so translated calls sound like YOU, not a robot.
          Speak naturally for 30-60 seconds in any language.
        </p>

        {voiceCloned ? (
          <div className="voice-status-box cloned">
            <div className="voice-status-icon">&#10003;</div>
            <div>
              <p className="voice-status-text">Voice Cloned Successfully!</p>
              <p className="voice-status-sub">Your voice will be used in all translated calls</p>
            </div>
            <button className="btn-danger-sm" onClick={deleteVoice}>Remove</button>
          </div>
        ) : (
          <div className="voice-status-box not-cloned">
            <div className="voice-status-icon">&#9888;</div>
            <div>
              <p className="voice-status-text">Voice Not Cloned</p>
              <p className="voice-status-sub">Using generic AI voice for translations</p>
            </div>
          </div>
        )}

        {/* Recording Controls */}
        <div className="voice-record-section">
          {!isRecording && !recordedBlob && (
            <button className="btn btn-record" onClick={startRecording}>
              <span className="record-dot"></span>
              Start Recording Your Voice
            </button>
          )}

          {isRecording && (
            <div className="recording-active">
              <div className="recording-indicator">
                <span className="rec-dot pulsing"></span>
                <span className="rec-time">{formatTime(recordingTime)}</span>
              </div>
              <p className="rec-tip">
                {recordingTime < 10
                  ? 'Keep talking... (min 10 seconds)'
                  : recordingTime < 30
                    ? 'Good! Keep going for better quality...'
                    : 'Great! You can stop now or continue for even better results.'
                }
              </p>
              <div className="voice-waves-record">
                <span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span>
              </div>
              <button className="btn btn-stop-record" onClick={stopRecording}>
                Stop Recording
              </button>
            </div>
          )}

          {recordedBlob && !isRecording && (
            <div className="recording-preview">
              <p className="preview-label">Recorded: {formatTime(recordingTime)}</p>
              {audioUrl && (
                <audio controls src={audioUrl} className="audio-preview" />
              )}
              <div className="preview-actions">
                <button className="btn btn-primary" onClick={uploadVoice} disabled={isUploading}>
                  {isUploading ? 'Cloning Voice...' : 'Clone My Voice'}
                </button>
                <button className="btn btn-secondary" onClick={startRecording}>
                  Re-record
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile */}
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

      {/* Telegram */}
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

      {/* WhatsApp */}
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
