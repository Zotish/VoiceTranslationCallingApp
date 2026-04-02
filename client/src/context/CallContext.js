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
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const LANG_MAP = {
  'bn': 'bn-BD', 'zh': 'zh-CN', 'hi': 'hi-IN', 'en': 'en-US',
  'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'ja': 'ja-JP',
  'ko': 'ko-KR', 'ar': 'ar-SA', 'pt': 'pt-BR', 'ru': 'ru-RU',
  'tr': 'tr-TR', 'th': 'th-TH', 'vi': 'vi-VN', 'it': 'it-IT',
  'ms': 'ms-MY', 'id': 'id-ID', 'ur': 'ur-PK', 'ta': 'ta-IN'
};

function getLangCode(lang) {
  return LANG_MAP[lang] || lang;
}

export function CallProvider({ children }) {
  const { socket } = useSocket();
  const { user } = useAuth();

  const [callState, setCallState] = useState('idle');
  const [remoteUser, setRemoteUser] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [transcripts, setTranscripts] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceCloned, setIsVoiceCloned] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteAudioRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const remoteUserRef = useRef(null);
  const callStateRef = useRef('idle');
  const socketRef = useRef(null);
  // Store call params for speech recognition
  const callParamsRef = useRef(null); // { myLang, remoteLang, remoteId }

  const userRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { userRef.current = user; }, [user]);

  const addDebug = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[DEBUG ${time}] ${msg}`);
    setDebugLog(prev => [...prev.slice(-20), `${time}: ${msg}`]);
  }, []);

  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ===== AUDIO PLAYBACK =====
  const speakWithTTS = useCallback((text, lang) => {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getLangCode(lang);
      utterance.rate = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const targetLang = getLangCode(lang);
      const match = voices.find(v => v.lang === targetLang) ||
                    voices.find(v => v.lang.startsWith(lang));
      if (match) utterance.voice = match;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setTimeout(() => setIsSpeaking(false), 20000);

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('TTS failed:', err);
      setIsSpeaking(false);
    }
  }, []);

  const playTranslatedAudio = useCallback((text, lang, audioBase64) => {
    if (!text) return;
    setIsSpeaking(true);

    if (audioBase64) {
      try {
        const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
        audio.volume = 1.0;
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => speakWithTTS(text, lang);
        audio.play().catch(() => speakWithTTS(text, lang));
        setIsVoiceCloned(true);
        return;
      } catch (e) { /* fallthrough */ }
    }
    speakWithTTS(text, lang);
  }, [speakWithTTS]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((myLang, targetLang, remoteId) => {
    addDebug(`startSpeechRecognition: ${myLang} → ${targetLang}, remote=${remoteId}`);

    // Store params
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addDebug('ERROR: SpeechRecognition not supported!');
      return;
    }

    // Stop existing
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      addDebug(`MIC ACTIVE: listening in ${myLang}`);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        addDebug(`RECOGNIZED: "${text}"`);

        setTranscripts(prev => [...prev, {
          type: 'you', text, lang: myLang, timestamp: Date.now()
        }]);

        // Use socketRef to always get latest socket
        const currentSocket = socketRef.current;
        if (currentSocket && currentSocket.connected) {
          currentSocket.emit('translate-text', {
            text,
            fromLang: myLang,
            toLang: targetLang,
            to: remoteId
          });
          addDebug(`EMITTED to ${remoteId}: "${text}" (${myLang}→${targetLang})`);
        } else {
          addDebug('ERROR: Socket not connected!');
        }
      }
    };

    recognition.onerror = (e) => {
      addDebug(`MIC ERROR: ${e.error}`);
    };

    recognition.onend = () => {
      setIsListening(false);
      addDebug('MIC STOPPED - auto-restarting...');
      if (callStateRef.current === 'in-call') {
        setTimeout(() => {
          if (callStateRef.current === 'in-call' && recognitionRef.current) {
            try {
              recognition.start();
              addDebug('MIC RESTARTED');
            } catch (e) {
              addDebug(`MIC RESTART FAILED: ${e.message}`);
            }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      addDebug('Recognition.start() called OK');
    } catch (e) {
      addDebug(`Recognition.start() FAILED: ${e.message}`);
    }
  }, [addDebug]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Manual send for testing
  const sendTestMessage = useCallback((text) => {
    const params = callParamsRef.current;
    const currentSocket = socketRef.current;
    if (!params || !currentSocket) {
      addDebug('Cannot send - no call params or socket');
      return;
    }
    addDebug(`MANUAL SEND: "${text}" to ${params.remoteId}`);
    currentSocket.emit('translate-text', {
      text,
      fromLang: params.myLang,
      toLang: params.remoteLang,
      to: params.remoteId
    });
    setTranscripts(prev => [...prev, {
      type: 'you', text, lang: params.myLang, timestamp: Date.now()
    }]);
  }, [addDebug]);

  // ===== WEBRTC =====
  const createPeerConnection = useCallback((remoteId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const audio = document.getElementById('remote-audio');
      if (audio) {
        audio.srcObject = event.streams[0];
        audio.volume = 0;
        remoteAudioRef.current = audio;
      }
    };

    pc.onconnectionstatechange = () => {
      addDebug(`WebRTC: ${pc.connectionState}`);
    };

    peerConnection.current = pc;
    return pc;
  }, [addDebug]);

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.current = stream;
    return stream;
  }, []);

  // ===== CALL ACTIONS =====
  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    try {
      const remote = { userId: contact.userId, name: contact.name, language: contact.language };
      setRemoteUser(remote);
      remoteUserRef.current = remote;
      setCallState('calling');
      callStateRef.current = 'calling';
      setTranscripts([]);
      setDebugLog([]);
      setIsVoiceCloned(false);

      addDebug(`CALLING: ${contact.name} (${contact.userId})`);

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
      addDebug(`CALL FAILED: ${err.message}`);
      setCallState('idle');
      callStateRef.current = 'idle';
    }
  }, [socket, user, getLocalStream, createPeerConnection, addDebug]);

  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

    try {
      const remote = {
        userId: callData.from,
        name: callData.callerName,
        language: callData.callerLang
      };
      setRemoteUser(remote);
      remoteUserRef.current = remote;
      setCallState('in-call');
      callStateRef.current = 'in-call';
      setTranscripts([]);
      setDebugLog([]);
      setIsVoiceCloned(false);

      addDebug(`ACCEPTING call from ${callData.callerName}`);
      addDebug(`My lang: ${user.language}, Caller lang: ${callData.callerLang}`);
      addDebug(`Remote ID: ${callData.from}`);

      const stream = await getLocalStream();
      addDebug('Got mic stream');

      const pc = createPeerConnection(callData.from);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('call-accepted', {
        to: callData.from,
        answer,
        accepterLang: user.language,
        accepterName: user.name
      });
      addDebug('Sent call-accepted');

      startTimer();

      // Start speech recognition for callee
      addDebug('Starting speech recognition...');
      startSpeechRecognition(user.language, callData.callerLang, callData.from);
    } catch (err) {
      addDebug(`ACCEPT FAILED: ${err.message}`);
      setCallState('idle');
      callStateRef.current = 'idle';
    }
  }, [socket, user, getLocalStream, createPeerConnection, startTimer, startSpeechRecognition, addDebug]);

  const rejectCall = useCallback((callData) => {
    if (socket) socket.emit('call-rejected', { to: callData.from });
    setCallState('idle');
    callStateRef.current = 'idle';
    setRemoteUser(null);
    remoteUserRef.current = null;
  }, [socket]);

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

    const remote = remoteUserRef.current;
    if (socket && remote) {
      socket.emit('call-ended', { to: remote.userId });
    }

    setCallState('idle');
    callStateRef.current = 'idle';
    setRemoteUser(null);
    remoteUserRef.current = null;
    callParamsRef.current = null;
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaking(false);
    setIsListening(false);
    setIsVoiceCloned(false);
  }, [socket, stopTimer, stopSpeechRecognition]);

  const toggleMute = useCallback(() => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // ===== SOCKET EVENTS - using refs to avoid stale closures =====
  const playTranslatedAudioRef = useRef(playTranslatedAudio);
  useEffect(() => { playTranslatedAudioRef.current = playTranslatedAudio; }, [playTranslatedAudio]);

  const addDebugRef = useRef(addDebug);
  useEffect(() => { addDebugRef.current = addDebug; }, [addDebug]);

  const endCallRef = useRef(endCall);
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  const startTimerRef = useRef(startTimer);
  useEffect(() => { startTimerRef.current = startTimer; }, [startTimer]);

  const startSpeechRecognitionRef = useRef(startSpeechRecognition);
  useEffect(() => { startSpeechRecognitionRef.current = startSpeechRecognition; }, [startSpeechRecognition]);

  // Setup socket listeners ONCE (no dependency changes)
  useEffect(() => {
    if (!socket) return;

    const onCallAccepted = async ({ answer, accepterLang, accepterName }) => {
      try {
        addDebugRef.current(`CALL ACCEPTED by ${accepterName} (lang: ${accepterLang})`);

        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
        }

        setCallState('in-call');
        callStateRef.current = 'in-call';
        startTimerRef.current();

        const currentRemote = remoteUserRef.current;
        if (currentRemote) {
          const updated = { ...currentRemote, language: accepterLang };
          if (accepterName) updated.name = accepterName;
          setRemoteUser(updated);
          remoteUserRef.current = updated;

          // Start speech recognition for caller (A)
          const currentUser = userRef.current;
          const myLang = currentUser?.language || 'en';
          addDebugRef.current(`Starting recognition: myLang=${myLang}, remoteLang=${accepterLang}, remoteId=${currentRemote.userId}`);
          startSpeechRecognitionRef.current(myLang, accepterLang, currentRemote.userId);
        }
      } catch (err) {
        addDebugRef.current(`CALL ACCEPTED ERROR: ${err.message}`);
      }
    };

    const onTextTranslated = ({ original, translated, fromLang, toLang, audio, voiceCloned: vc }) => {
      addDebugRef.current(`RECEIVED: "${original}" → "${translated}" (${toLang})`);

      setTranscripts(prev => [...prev, {
        type: 'remote', text: original, translated,
        fromLang, toLang, voiceCloned: !!vc, timestamp: Date.now()
      }]);

      playTranslatedAudioRef.current(translated, toLang, audio || null);
    };

    const onTranslationSent = ({ original, translated }) => {
      addDebugRef.current(`SENT OK: "${original}" → "${translated}"`);
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) lastYou.translated = translated;
        return [...updated];
      });
    };

    const onCallRejected = () => endCallRef.current();
    const onCallEnded = () => endCallRef.current();

    const onIceCandidate = async ({ candidate }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) { /* ignore */ }
    };

    const onCallFailed = ({ message }) => {
      alert(message);
      setCallState('idle');
      callStateRef.current = 'idle';
      setRemoteUser(null);
      remoteUserRef.current = null;
    };

    socket.on('call-accepted', onCallAccepted);
    socket.on('call-rejected', onCallRejected);
    socket.on('call-ended', onCallEnded);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('text-translated', onTextTranslated);
    socket.on('translation-sent', onTranslationSent);
    socket.on('call-failed', onCallFailed);

    return () => {
      socket.off('call-accepted', onCallAccepted);
      socket.off('call-rejected', onCallRejected);
      socket.off('call-ended', onCallEnded);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('text-translated', onTextTranslated);
      socket.off('translation-sent', onTranslationSent);
      socket.off('call-failed', onCallFailed);
    };
  }, [socket]); // Only depends on socket - very stable

  // Load TTS voices
  useEffect(() => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }, []);

  const value = {
    callState, remoteUser, callDuration, transcripts,
    isMuted, isSpeaking, isListening, isVoiceCloned, debugLog,
    callUser, acceptCall, rejectCall, endCall, toggleMute,
    sendTestMessage, setRemoteUser, setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio id="remote-audio" autoPlay />
    </CallContext.Provider>
  );
}
