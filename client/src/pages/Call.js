import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCall } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';

const LANG_NAMES = {
  'bn': 'Bangla', 'zh': 'Chinese', 'hi': 'Hindi', 'en': 'English',
  'es': 'Spanish', 'fr': 'French', 'de': 'German', 'ja': 'Japanese',
  'ko': 'Korean', 'ar': 'Arabic', 'pt': 'Portuguese', 'ru': 'Russian',
  'tr': 'Turkish', 'th': 'Thai', 'vi': 'Vietnamese', 'it': 'Italian',
  'ms': 'Malay', 'id': 'Indonesian', 'ur': 'Urdu', 'ta': 'Tamil'
};

function Call() {
  const {
    callState, remoteUser, callDuration, transcripts,
    isMuted, isSpeaking, isListening, debugLog,
    endCall, toggleMute, sendTestMessage
  } = useCall();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showDebug, setShowDebug] = useState(false);
  const [testText, setTestText] = useState('');
  const transcriptEndRef = useRef(null);
  const debugEndRef = useRef(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  useEffect(() => {
    if (debugEndRef.current) {
      debugEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [debugLog]);

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    endCall();
    navigate('/dashboard');
  };

  const handleTestSend = () => {
    if (testText.trim()) {
      sendTestMessage(testText.trim());
      setTestText('');
    }
  };

  if (callState === 'idle' && !remoteUser) {
    navigate('/dashboard');
    return null;
  }

  const myLang = LANG_NAMES[user?.language] || user?.language || '?';
  const remoteLang = LANG_NAMES[remoteUser?.language] || remoteUser?.language || '?';

  return (
    <div className="call-page">
      <div className="call-container">
        {/* Header */}
        <div className="call-header">
          <div className="call-avatar-large">
            <div className={`avatar-ring ${callState === 'in-call' ? (isSpeaking ? 'speaking' : 'connected') : 'calling'}`}>
              <div className="avatar-inner">
                {remoteUser?.name?.[0]?.toUpperCase() || '?'}
              </div>
            </div>
          </div>
          <h2 className="call-name">{remoteUser?.name || 'Unknown'}</h2>

          {callState === 'calling' && <p className="call-status-text calling-pulse">Calling...</p>}
          {callState === 'in-call' && (
            <>
              <p className="call-timer">{formatDuration(callDuration)}</p>
              <div className="translation-badge">
                <span className="lang-badge">{myLang}</span>
                <span className="arrow-icon">&#8644;</span>
                <span className="lang-badge">{remoteLang}</span>
              </div>
            </>
          )}
        </div>

        {/* Status indicators */}
        {callState === 'in-call' && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
            <span style={{
              padding: '4px 10px', borderRadius: '12px', fontSize: '11px',
              background: isListening ? '#22c55e' : '#ef4444', color: '#fff'
            }}>
              MIC: {isListening ? 'ON' : 'OFF'}
            </span>
            {isSpeaking && (
              <span style={{
                padding: '4px 10px', borderRadius: '12px', fontSize: '11px',
                background: '#3b82f6', color: '#fff'
              }}>
                PLAYING TRANSLATION
              </span>
            )}
          </div>
        )}

        {/* Voice waves */}
        {callState === 'in-call' && (
          <div className="voice-activity-section">
            <div className={`voice-indicator ${isListening ? 'active' : ''}`}>
              <div className="voice-waves">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        {/* Test send input - type text to test translation */}
        {callState === 'in-call' && (
          <div style={{ padding: '8px 16px', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={testText}
              onChange={e => setTestText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTestSend()}
              placeholder={`Type in ${myLang} to test...`}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '8px',
                border: '1px solid #444', background: '#1a1a2e', color: '#fff',
                fontSize: '14px'
              }}
            />
            <button
              onClick={handleTestSend}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                background: '#7c3aed', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: '14px'
              }}
            >
              Send
            </button>
          </div>
        )}

        {/* Transcript */}
        {callState === 'in-call' && (
          <div className="transcripts-area" style={{ maxHeight: '250px', overflow: 'auto' }}>
            <div className="transcripts-list">
              {transcripts.length === 0 && (
                <p style={{ color: '#888', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                  Speak in {myLang} or type above to test...
                </p>
              )}
              {transcripts.map((t, i) => (
                <div key={i} className={`transcript-item ${t.type}`}>
                  <div className="transcript-label">
                    {t.type === 'you' ? 'You' : remoteUser?.name}
                  </div>
                  <div className="transcript-text">{t.text}</div>
                  {t.translated && (
                    <div className="transcript-translated">{t.translated}</div>
                  )}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {/* Call Controls */}
        <div className="call-controls">
          <button className={`btn-control ${isMuted ? 'active' : ''}`} onClick={toggleMute}>
            <span className="control-icon">{isMuted ? '🔇' : '🎤'}</span>
            <small>{isMuted ? 'Unmute' : 'Mute'}</small>
          </button>

          <button className="btn-control btn-end-call" onClick={handleEndCall}>
            <span className="control-icon">&#9742;</span>
            <small>End</small>
          </button>

          <button className="btn-control" onClick={() => setShowDebug(!showDebug)}>
            <span className="control-icon">🐛</span>
            <small>Debug</small>
          </button>
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div style={{
            margin: '10px 16px', padding: '10px', borderRadius: '8px',
            background: '#0a0a1a', border: '1px solid #333', maxHeight: '200px', overflow: 'auto'
          }}>
            <p style={{ color: '#7c3aed', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
              Debug Log
            </p>
            {debugLog.map((msg, i) => (
              <p key={i} style={{ color: '#aaa', fontSize: '10px', margin: '2px 0', fontFamily: 'monospace' }}>
                {msg}
              </p>
            ))}
            {debugLog.length === 0 && (
              <p style={{ color: '#666', fontSize: '10px' }}>No debug messages yet...</p>
            )}
            <div ref={debugEndRef} />
          </div>
        )}

        {/* Calling info */}
        {callState === 'calling' && (
          <div className="call-info-box">
            <p>When connected, speak in <strong>{myLang}</strong></p>
            <p>Translation will play as voice in <strong>{remoteLang}</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Call;
