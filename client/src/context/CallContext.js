import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

const CallContext = createContext();

export function useCall() {
  return useContext(CallContext);
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export function CallProvider({ children }) {
  const { socket } = useSocket();
  const { user } = useAuth();

  const [callState, setCallState] = useState('idle'); // idle, calling, ringing, in-call
  const [remoteUser, setRemoteUser] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcripts, setTranscripts] = useState([]);
  const [isMuted, setIsMuted] = useState(false);

  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  // Start call timer
  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Speech Recognition setup
  const startSpeechRecognition = useCallback((lang, remoteLang, remoteId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = lang === 'bn' ? 'bn-BD' : lang === 'zh' ? 'zh-CN' : lang === 'hi' ? 'hi-IN' : lang;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript;
        setTranscripts(prev => [...prev, { type: 'you', text, lang }]);

        // Send for translation
        if (socket) {
          socket.emit('translate-text', {
            text,
            fromLang: lang,
            toLang: remoteLang,
            to: remoteId
          });
        }
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') {
        console.error('Speech recognition error:', e.error);
      }
    };

    recognition.onend = () => {
      // Restart if still in call
      if (callState === 'in-call') {
        try { recognition.start(); } catch (e) { /* ignore */ }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
    }
  }, [socket, callState]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      recognitionRef.current = null;
    }
  }, []);

  // Text-to-speech: speak translated text
  const speakText = useCallback((text, lang) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'bn' ? 'bn-BD' : lang === 'zh' ? 'zh-CN' : lang === 'hi' ? 'hi-IN' : lang;
    utterance.rate = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((remoteId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      remoteStream.current = event.streams[0];
      // Play remote audio
      const audio = document.getElementById('remote-audio');
      if (audio) {
        audio.srcObject = event.streams[0];
      }
    };

    peerConnection.current = pc;
    return pc;
  }, [socket]);

  // Get local audio stream
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.current = stream;
      return stream;
    } catch (err) {
      console.error('Failed to get local stream:', err);
      throw err;
    }
  }, []);

  // Initiate call
  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    try {
      setRemoteUser(contact);
      setCallState('calling');
      setTranscripts([]);

      const stream = await getLocalStream();
      const pc = createPeerConnection(contact.userId);

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call-user', {
        to: contact.userId,
        from: user.id,
        callerName: user.name,
        offer,
        callerLang: user.language
      });
    } catch (err) {
      console.error('Call failed:', err);
      setCallState('idle');
    }
  }, [socket, user, getLocalStream, createPeerConnection]);

  // Accept incoming call
  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

    try {
      setCallState('in-call');

      const stream = await getLocalStream();
      const pc = createPeerConnection(callData.from);

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('call-accepted', {
        to: callData.from,
        answer,
        accepterLang: user.language
      });

      startTimer();
      startSpeechRecognition(user.language, callData.callerLang, callData.from);
    } catch (err) {
      console.error('Failed to accept call:', err);
      setCallState('idle');
    }
  }, [socket, user, getLocalStream, createPeerConnection, startTimer, startSpeechRecognition]);

  // Reject call
  const rejectCall = useCallback((callData) => {
    if (socket) {
      socket.emit('call-rejected', { to: callData.from });
    }
    setCallState('idle');
    setRemoteUser(null);
  }, [socket]);

  // End call
  const endCall = useCallback(() => {
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    stopTimer();
    stopSpeechRecognition();
    window.speechSynthesis.cancel();

    if (socket && remoteUser) {
      socket.emit('call-ended', { to: remoteUser.userId });
    }

    setCallState('idle');
    setRemoteUser(null);
    setIsMuted(false);
  }, [socket, remoteUser, stopTimer, stopSpeechRecognition]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('call-accepted', async ({ answer, accepterLang }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
        setCallState('in-call');
        startTimer();
        if (user && remoteUser) {
          startSpeechRecognition(user.language, accepterLang, remoteUser.userId);
        }
      } catch (err) {
        console.error('Error handling call accepted:', err);
      }
    });

    socket.on('call-rejected', () => {
      endCall();
    });

    socket.on('call-ended', () => {
      endCall();
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    // Receive translated text from server
    socket.on('text-translated', ({ original, translated, fromLang, toLang }) => {
      setTranscripts(prev => [...prev, { type: 'remote', text: original, translated, fromLang, toLang }]);
      // Speak the translated text in user's language
      speakText(translated, toLang);
    });

    socket.on('translation-sent', ({ original, translated }) => {
      // Update our transcript with translation
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = updated.filter(t => t.type === 'you').pop();
        if (lastYou && lastYou.text === original) {
          lastYou.translated = translated;
        }
        return [...updated];
      });
    });

    socket.on('call-failed', ({ message }) => {
      alert(message);
      setCallState('idle');
      setRemoteUser(null);
    });

    return () => {
      socket.off('call-accepted');
      socket.off('call-rejected');
      socket.off('call-ended');
      socket.off('ice-candidate');
      socket.off('text-translated');
      socket.off('translation-sent');
      socket.off('call-failed');
    };
  }, [socket, user, remoteUser, endCall, startTimer, startSpeechRecognition, speakText]);

  const value = {
    callState,
    remoteUser,
    callDuration,
    transcripts,
    isMuted,
    callUser,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    setRemoteUser,
    setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio id="remote-audio" autoPlay />
    </CallContext.Provider>
  );
}
