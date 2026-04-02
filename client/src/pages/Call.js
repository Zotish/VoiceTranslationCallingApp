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
    isMuted, isSpeaking, isListening, isVoiceCloned, debugInfo,
    endCall, toggleMute
  } = useCall();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showTranscript, setShowTranscript] = useState(true); // DEFAULT: show transcript
  const transcriptEndRef = useRef(null);

  // Auto-scroll transcripts
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    endCall();
    navigate('/dashboard');
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
        {/* Call Header */}
        <div className="call-header">
          <div className="call-avatar-large">
            <div className={`avatar-ring ${callState === 'in-call' ? (isSpeaking ? 'speaking' : 'connected') : 'calling'}`}>
              <div className="avatar-inner">
                {remoteUser?.name?.[0]?.toUpperCase() || '?'}
              </div>
            </div>
          </div>
          <h2 className="call-name">{remoteUser?.name || 'Unknown'}</h2>

          {callState === 'calling' && (
            <p className="call-status-text calling-pulse">Calling...</p>
          )}
          {callState === 'ringing' && (
            <p className="call-status-text calling-pulse">Ringing...</p>
          )}
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

        {/* Voice Activity Indicators */}
        {callState === 'in-call' && (
          <div className="voice-activity-section">
            {/* Status indicators */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '10px' }}>
              <div style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '12px',
                background: isListening ? '#4ade80' : '#666', color: '#000'
              }}>
                {isListening ? `Listening (${myLang})` : 'Mic paused'}
              </div>
              {isSpeaking && (
                <div style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px',
                  background: isVoiceCloned ? '#a78bfa' : '#60a5fa', color: '#000'
                }}>
                  {isVoiceCloned ? 'Cloned Voice' : 'Playing translation'}
                </div>
              )}
            </div>

            {/* Debug info */}
            {debugInfo && (
              <p style={{ color: '#888', fontSize: '11px', textAlign: 'center', margin: '4px 0' }}>
                {debugInfo}
              </p>
            )}

            {/* Voice waves */}
            <div className={`voice-indicator ${isListening ? 'active' : ''}`}>
              <div className="voice-waves">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
            </div>

            {isSpeaking && (
              <div className="voice-indicator speaking active">
                <div className="voice-waves speaking-waves">
                  <span></span><span></span><span></span><span></span><span></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Transcript - ALWAYS VISIBLE during call */}
        {callState === 'in-call' && showTranscript && (
          <div className="transcripts-area" style={{ maxHeight: '300px', overflow: 'auto' }}>
            <div className="transcripts-list">
              {transcripts.length === 0 && (
                <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                  Start speaking in {myLang}... your voice will be translated to {remoteLang}
                </p>
              )}
              {transcripts.map((t, i) => (
                <div key={i} className={`transcript-item ${t.type}`}>
                  <div className="transcript-label">
                    {t.type === 'you' ? 'You' : remoteUser?.name}
                    {t.voiceCloned && ' (Cloned)'}
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
          <button
            className={`btn-control ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
          >
            <span className="control-icon">{isMuted ? '🔇' : '🎤'}</span>
            <small>{isMuted ? 'Unmute' : 'Mute'}</small>
          </button>

          <button className="btn-control btn-end-call" onClick={handleEndCall}>
            <span className="control-icon">&#9742;</span>
            <small>End</small>
          </button>

          <button
            className="btn-control"
            onClick={() => setShowTranscript(!showTranscript)}
          >
            <span className="control-icon">{showTranscript ? '🔊' : '📝'}</span>
            <small>{showTranscript ? 'Hide' : 'Show'}</small>
          </button>
        </div>

        {/* Info when calling */}
        {callState === 'calling' && (
          <div className="call-info-box">
            <p>When connected, speak in <strong>{myLang}</strong></p>
            <p>Your voice will be translated to <strong>{remoteLang}</strong></p>
            <p>and played as voice to {remoteUser?.name}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Call;
