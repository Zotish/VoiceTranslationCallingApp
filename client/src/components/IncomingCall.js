import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useCall } from '../context/CallContext';

function IncomingCall() {
  const { socket } = useSocket();
  const { acceptCall, rejectCall, setRemoteUser, callState } = useCall();
  const [incomingData, setIncomingData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const handleIncoming = (data) => {
      setIncomingData(data);
      setRemoteUser({
        userId: data.from,
        name: data.callerName,
        language: data.callerLang
      });
    };

    socket.on('incoming-call', handleIncoming);

    return () => {
      socket.off('incoming-call', handleIncoming);
    };
  }, [socket, setRemoteUser]);

  if (!incomingData || callState === 'in-call') return null;

  const handleAccept = () => {
    acceptCall(incomingData);
    setIncomingData(null);
    navigate('/call');
  };

  const handleReject = () => {
    rejectCall(incomingData);
    setIncomingData(null);
  };

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-modal">
        <div className="incoming-pulse" />
        <div className="incoming-avatar">
          {incomingData.callerName?.[0]?.toUpperCase() || '?'}
        </div>
        <h2>{incomingData.callerName}</h2>
        <p>Incoming voice call...</p>

        <div className="incoming-actions">
          <button className="btn-incoming btn-reject" onClick={handleReject}>
            Decline
          </button>
          <button className="btn-incoming btn-accept" onClick={handleAccept}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

export default IncomingCall;
