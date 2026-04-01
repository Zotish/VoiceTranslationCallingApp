import React, { useState } from 'react';
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
    isMuted, isSpeaking, isListening, isVoiceCloned, endCall, toggleMute
  } = useCall();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showTranscript, setShowTranscript] = useState(false);

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
            {/* Listening indicator */}
            <div className={`voice-indicator ${isListening ? 'active' : ''}`}>
              <div className="voice-waves">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
              <p className="voice-label">
                {isListening ? `Listening in ${myLang}...` : 'Mic paused'}
              </p>
            </div>

            {/* Speaking/Playing translation indicator */}
            {isSpeaking && (
              <div className="voice-indicator speaking active">
                <div className="voice-waves speaking-waves">
                  <span></span><span></span><span></span><span></span><span></span>
                </div>
                <p className="voice-label">
                  {isVoiceCloned
                    ? `Playing ${remoteUser?.name}'s cloned voice in ${myLang}...`
                    : `Playing translated voice in ${myLang}...`
                  }
                </p>
              </div>
            )}

            {/* Minimal last message preview */}
            {transcripts.length > 0 && (
              <div className="last-message-preview">
                <p className="preview-text">
                  {transcripts[transcripts.length - 1].type === 'you'
                    ? `You: "${transcripts[transcripts.length - 1].text}"`
                    : `${remoteUser?.name}: "${transcripts[transcripts.length - 1].translated || transcripts[transcripts.length - 1].text}"`
                  }
                </p>
              </div>
            )}

            {/* Toggle transcript button */}
            <button
              className="btn-show-transcript"
              onClick={() => setShowTranscript(!showTranscript)}
            >
              {showTranscript ? 'Hide Transcript' : 'Show Transcript'}
            </button>
          </div>
        )}

        {/* Full Transcript (hidden by default) */}
        {callState === 'in-call' && showTranscript && (
          <div className="transcripts-area">
            <div className="transcripts-list">
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
            <small>{showTranscript ? 'Voice' : 'Text'}</small>
          </button>
        </div>

        {/* How it works info (shown when calling) */}
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
