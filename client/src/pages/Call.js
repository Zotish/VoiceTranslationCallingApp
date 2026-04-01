import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCall } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';

function Call() {
  const { callState, remoteUser, callDuration, transcripts, isMuted, endCall, toggleMute } = useCall();
  const { user } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="call-page">
      <div className="call-container">
        <div className="call-header">
          <div className="call-avatar">
            {remoteUser?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <h2 className="call-name">{remoteUser?.name || 'Unknown'}</h2>
          <p className="call-status">
            {callState === 'calling' && 'Calling...'}
            {callState === 'ringing' && 'Ringing...'}
            {callState === 'in-call' && formatDuration(callDuration)}
          </p>
          {callState === 'in-call' && (
            <p className="call-lang-info">
              {user?.language?.toUpperCase()} &#8644; {remoteUser?.language?.toUpperCase()}
            </p>
          )}
        </div>

        {callState === 'in-call' && (
          <div className="transcripts-area">
            <h3>Live Translation</h3>
            <div className="transcripts-list">
              {transcripts.length === 0 ? (
                <p className="empty-text">Start speaking... your voice will be translated in real-time</p>
              ) : (
                transcripts.map((t, i) => (
                  <div key={i} className={`transcript-item ${t.type}`}>
                    <div className="transcript-label">{t.type === 'you' ? 'You' : remoteUser?.name}</div>
                    <div className="transcript-text">{t.text}</div>
                    {t.translated && (
                      <div className="transcript-translated">{t.translated}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="call-controls">
          <button
            className={`btn-control ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
          >
            <span>{isMuted ? '🔇' : '🎤'}</span>
            <small>{isMuted ? 'Unmute' : 'Mute'}</small>
          </button>

          <button className="btn-control btn-end-call" onClick={handleEndCall}>
            <span>&#9742;</span>
            <small>End</small>
          </button>

          <button className="btn-control" onClick={() => {}}>
            <span>🔊</span>
            <small>Speaker</small>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Call;
