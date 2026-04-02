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
  const [debugInfo, setDebugInfo] = useState('');

  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteAudioRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const remoteUserRef = useRef(null);
  const callStateRef = useRef('idle');

  // Keep refs in sync
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ===== SIMPLE AUDIO PLAYBACK =====

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
      console.log(`TTS playing: "${text}" in ${lang}`);
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
        audio.onerror = () => {
          console.warn('Cloned audio failed, trying TTS...');
          speakWithTTS(text, lang);
        };
        audio.play().catch(() => speakWithTTS(text, lang));
        setIsVoiceCloned(true);
        return;
      } catch (e) {
        console.warn('Audio error:', e);
      }
    }

    speakWithTTS(text, lang);
  }, [speakWithTTS]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((myLang, targetLang, remoteId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
      setDebugInfo('Speech Recognition not supported in this browser');
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
      setDebugInfo(`Listening in ${myLang}...`);
      console.log(`🎤 STARTED: Listening in ${myLang}, translate to ${targetLang}, send to ${remoteId}`);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        console.log(`📝 RECOGNIZED: "${text}" → translating ${myLang}→${targetLang} → sending to ${remoteId}`);
        setDebugInfo(`Sent: "${text}"`);

        setTranscripts(prev => [...prev, {
          type: 'you', text, lang: myLang, timestamp: Date.now()
        }]);

        if (socket) {
          socket.emit('translate-text', {
            text,
            fromLang: myLang,
            toLang: targetLang,
            to: remoteId
          });
          console.log(`📤 EMITTED translate-text to ${remoteId}`);
        } else {
          console.error('❌ Socket is null! Cannot emit');
        }
      }
    };

    recognition.onerror = (e) => {
      console.log('Recognition error:', e.error);
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setDebugInfo(`Mic error: ${e.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if still in call
      if (callStateRef.current === 'in-call') {
        try {
          setTimeout(() => {
            if (callStateRef.current === 'in-call') {
              recognition.start();
            }
          }, 200);
        } catch (e) { /* ignore */ }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      console.log('🎤 Speech recognition started successfully');
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      setDebugInfo('Failed to start mic');
    }
  }, [socket]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // ===== WEBRTC =====
  const createPeerConnection = useCallback((remoteId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const audio = document.getElementById('remote-audio');
      if (audio) {
        audio.srcObject = event.streams[0];
        audio.volume = 0; // Muted - we play translated voice
        remoteAudioRef.current = audio;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC state:', pc.connectionState);
    };

    peerConnection.current = pc;
    return pc;
  }, [socket]);

  const getLocalStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.current = stream;
    return stream;
  }, []);

  // ===== CALL ACTIONS =====

  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    try {
      const remote = {
        userId: contact.userId,
        name: contact.name,
        language: contact.language
      };
      setRemoteUser(remote);
      remoteUserRef.current = remote;
      setCallState('calling');
      callStateRef.current = 'calling';
      setTranscripts([]);
      setIsVoiceCloned(false);

      const stream = await getLocalStream();
      const pc = createPeerConnection(contact.userId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log(`📞 CALLING: ${contact.name} (${contact.userId}), myLang: ${user.language}, remoteLang: ${contact.language}`);

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
      callStateRef.current = 'idle';
    }
  }, [socket, user, getLocalStream, createPeerConnection]);

  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

    try {
      // SET REMOTE USER for callee (B)
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
      setIsVoiceCloned(false);

      const stream = await getLocalStream();
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

      startTimer();

      console.log(`✅ ACCEPTED: myLang=${user.language}, callerLang=${callData.callerLang}, remoteId=${callData.from}`);
      // B listens in B's lang, translates to A's lang, sends to A
      startSpeechRecognition(user.language, callData.callerLang, callData.from);
    } catch (err) {
      console.error('Failed to accept call:', err);
      setCallState('idle');
      callStateRef.current = 'idle';
    }
  }, [socket, user, getLocalStream, createPeerConnection, startTimer, startSpeechRecognition]);

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
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaking(false);
    setIsListening(false);
    setIsVoiceCloned(false);
    setDebugInfo('');
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

  // ===== SOCKET EVENT HANDLERS =====
  useEffect(() => {
    if (!socket) return;

    // A receives call acceptance
    const onCallAccepted = async ({ answer, accepterLang, accepterName }) => {
      try {
        console.log(`✅ CALL ACCEPTED: accepterLang=${accepterLang}, accepterName=${accepterName}`);

        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
        }

        setCallState('in-call');
        callStateRef.current = 'in-call';
        startTimer();

        // Update remote user with their language
        const currentRemote = remoteUserRef.current;
        if (currentRemote) {
          const updated = { ...currentRemote, language: accepterLang };
          if (accepterName) updated.name = accepterName;
          setRemoteUser(updated);
          remoteUserRef.current = updated;

          // A listens in A's lang, translates to B's lang, sends to B
          if (user) {
            console.log(`🎤 STARTING RECOGNITION: myLang=${user.language}, remoteLang=${accepterLang}, remoteId=${currentRemote.userId}`);
            startSpeechRecognition(user.language, accepterLang, currentRemote.userId);
          }
        }
      } catch (err) {
        console.error('Error handling call accepted:', err);
      }
    };

    // RECEIVE TRANSLATION FROM REMOTE
    const onTextTranslated = ({ original, translated, fromLang, toLang, audio, voiceCloned: vc }) => {
      console.log(`🔊 RECEIVED TRANSLATION: "${original}" → "${translated}" | toLang=${toLang} | hasAudio=${!!audio}`);
      setDebugInfo(`Received: "${translated}"`);

      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        fromLang,
        toLang,
        voiceCloned: !!vc,
        timestamp: Date.now()
      }]);

      // PLAY THE TRANSLATED AUDIO
      playTranslatedAudio(translated, toLang, audio || null);
    };

    // Confirm YOUR translation was sent
    const onTranslationSent = ({ original, translated }) => {
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) lastYou.translated = translated;
        return [...updated];
      });
    };

    const onCallRejected = () => endCall();
    const onCallEnded = () => endCall();

    const onIceCandidate = async ({ candidate }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
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
  }, [socket, user, endCall, startTimer, startSpeechRecognition, playTranslatedAudio]);

  // Load browser TTS voices
  useEffect(() => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }, []);

  const value = {
    callState, remoteUser, callDuration, transcripts,
    isMuted, isSpeaking, isListening, isVoiceCloned, debugInfo,
    callUser, acceptCall, rejectCall, endCall, toggleMute,
    setRemoteUser, setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio id="remote-audio" autoPlay />
    </CallContext.Provider>
  );
}
