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

  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);
  const remoteAudioRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  // Store remote info in refs so socket handlers always have latest values
  const remoteUserRef = useRef(null);
  const remoteLangRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => {
    remoteUserRef.current = remoteUser;
  }, [remoteUser]);

  // Start/stop call timer
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

  // ===== AUDIO PLAYBACK ENGINE =====

  // Play base64 mp3 audio (cloned voice from ElevenLabs)
  const playClonedAudio = useCallback((base64Audio) => {
    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
        audio.volume = 1.0;
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Audio playback failed'));
        // Timeout safety: if audio doesn't end in 30s, resolve anyway
        const timeout = setTimeout(() => resolve(), 30000);
        audio.onended = () => { clearTimeout(timeout); resolve(); };
        audio.play().catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }, []);

  // Fallback: Browser TTS
  const playBrowserTTS = useCallback((text, lang) => {
    return new Promise((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = getLangCode(lang);
        utterance.rate = 1.0;
        utterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const targetLang = getLangCode(lang);
        const match = voices.find(v => v.lang === targetLang) ||
                      voices.find(v => v.lang.startsWith(lang));
        if (match) utterance.voice = match;

        // Timeout safety: resolve after 15s max
        const timeout = setTimeout(() => resolve(), 15000);
        utterance.onend = () => { clearTimeout(timeout); resolve(); };
        utterance.onerror = () => { clearTimeout(timeout); resolve(); };
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error('TTS error:', err);
        resolve(); // Always resolve so queue continues
      }
    });
  }, []);

  const processAudioQueue = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    const item = audioQueueRef.current.shift();
    isPlayingRef.current = true;
    setIsSpeaking(true);

    // Mute raw WebRTC audio during playback
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = 0;
    }

    const finishPlaying = () => {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      // Continue processing queue
      if (audioQueueRef.current.length > 0) {
        setTimeout(() => processAudioQueue(), 100);
      }
    };

    if (item.audioBase64) {
      // PLAY CLONED VOICE (ElevenLabs mp3)
      playClonedAudio(item.audioBase64)
        .then(finishPlaying)
        .catch(() => {
          // Fallback to browser TTS if cloned audio fails
          console.warn('Cloned audio failed, falling back to TTS');
          playBrowserTTS(item.text, item.lang).then(finishPlaying);
        });
    } else {
      // Browser TTS fallback
      playBrowserTTS(item.text, item.lang).then(finishPlaying);
    }
  }, [playClonedAudio, playBrowserTTS]);

  // Queue audio for playback
  const queueAudio = useCallback((text, lang, audioBase64) => {
    if (!text) return;
    audioQueueRef.current.push({ text, lang, audioBase64 });
    if (audioBase64) setIsVoiceCloned(true);
    processAudioQueue();
  }, [processAudioQueue]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((myLang, targetLang, remoteId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser');
      return;
    }

    // Stop any existing recognition
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
      console.log(`🎤 Listening in ${myLang}, will translate to ${targetLang}, sending to ${remoteId}`);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        console.log(`📝 Recognized: "${text}" | ${myLang} → ${targetLang} | to: ${remoteId}`);

        setTranscripts(prev => [...prev, { type: 'you', text, lang: myLang, timestamp: Date.now() }]);

        if (socket) {
          socket.emit('translate-text', {
            text,
            fromLang: myLang,
            toLang: targetLang,
            to: remoteId
          });
        }
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('Speech recognition error:', e.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if call is still active
      try { recognition.start(); } catch (e) { /* ignore */ }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
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
      remoteStream.current = event.streams[0];
      const audio = document.getElementById('remote-audio');
      if (audio) {
        audio.srcObject = event.streams[0];
        audio.volume = 0; // MUTED - we play translated voice instead
        remoteAudioRef.current = audio;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC connection state:', pc.connectionState);
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

  // CALLER (A) initiates call
  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    try {
      setRemoteUser(contact);
      remoteUserRef.current = contact;
      setCallState('calling');
      setTranscripts([]);
      setIsVoiceCloned(false);
      audioQueueRef.current = [];
      isPlayingRef.current = false;

      const stream = await getLocalStream();
      const pc = createPeerConnection(contact.userId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log(`📞 Calling ${contact.name} (${contact.userId}), my lang: ${user.language}`);

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

  // CALLEE (B) accepts incoming call
  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

    try {
      // ✅ FIX: Set remoteUser for callee (B) too!
      const remoteInfo = {
        userId: callData.from,
        name: callData.callerName,
        language: callData.callerLang
      };
      setRemoteUser(remoteInfo);
      remoteUserRef.current = remoteInfo;
      remoteLangRef.current = callData.callerLang;

      setCallState('in-call');
      setTranscripts([]);
      setIsVoiceCloned(false);
      audioQueueRef.current = [];
      isPlayingRef.current = false;

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

      // B starts listening in B's language, translates to A's language
      console.log(`✅ Call accepted. My lang: ${user.language}, Caller lang: ${callData.callerLang}, Remote: ${callData.from}`);
      startSpeechRecognition(user.language, callData.callerLang, callData.from);
    } catch (err) {
      console.error('Failed to accept call:', err);
      setCallState('idle');
    }
  }, [socket, user, getLocalStream, createPeerConnection, startTimer, startSpeechRecognition]);

  const rejectCall = useCallback((callData) => {
    if (socket) socket.emit('call-rejected', { to: callData.from });
    setCallState('idle');
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
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    const remote = remoteUserRef.current;
    if (socket && remote) {
      socket.emit('call-ended', { to: remote.userId });
    }

    setCallState('idle');
    setRemoteUser(null);
    remoteUserRef.current = null;
    remoteLangRef.current = null;
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

  // ===== SOCKET EVENTS =====
  useEffect(() => {
    if (!socket) return;

    // CALLER (A) receives call acceptance from B
    const handleCallAccepted = async ({ answer, accepterLang, accepterName }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
        setCallState('in-call');
        startTimer();

        // Update remote user info with language
        const currentRemote = remoteUserRef.current;
        if (currentRemote) {
          const updated = { ...currentRemote, language: accepterLang };
          if (accepterName) updated.name = accepterName;
          setRemoteUser(updated);
          remoteUserRef.current = updated;
          remoteLangRef.current = accepterLang;
        }

        // A starts listening in A's language, translates to B's language
        if (user && currentRemote) {
          console.log(`✅ Call connected. My lang: ${user.language}, Remote lang: ${accepterLang}, Remote: ${currentRemote.userId}`);
          startSpeechRecognition(user.language, accepterLang, currentRemote.userId);
        }
      } catch (err) {
        console.error('Error handling call accepted:', err);
      }
    };

    const handleCallRejected = () => endCall();
    const handleCallEnded = () => endCall();

    const handleIceCandidate = async ({ candidate }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    };

    // RECEIVE translated text + optional cloned voice audio from remote
    const handleTextTranslated = ({ original, translated, fromLang, toLang, audio, voiceCloned: vc }) => {
      console.log(`🔊 Received translation: "${original}" → "${translated}" | audio: ${!!audio} | cloned: ${!!vc}`);

      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        fromLang,
        toLang,
        voiceCloned: !!vc,
        timestamp: Date.now()
      }]);

      // Queue audio: cloned voice if available, otherwise browser TTS
      queueAudio(translated, toLang, audio || null);
    };

    // Confirmation that YOUR speech was translated and sent
    const handleTranslationSent = ({ original, translated }) => {
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) lastYou.translated = translated;
        return [...updated];
      });
    };

    const handleCallFailed = ({ message }) => {
      alert(message);
      setCallState('idle');
      setRemoteUser(null);
      remoteUserRef.current = null;
    };

    socket.on('call-accepted', handleCallAccepted);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-ended', handleCallEnded);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('text-translated', handleTextTranslated);
    socket.on('translation-sent', handleTranslationSent);
    socket.on('call-failed', handleCallFailed);

    return () => {
      socket.off('call-accepted', handleCallAccepted);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-ended', handleCallEnded);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('text-translated', handleTextTranslated);
      socket.off('translation-sent', handleTranslationSent);
      socket.off('call-failed', handleCallFailed);
    };
  }, [socket, user, endCall, startTimer, startSpeechRecognition, queueAudio]);

  // Load browser voices
  useEffect(() => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }, []);

  const value = {
    callState, remoteUser, callDuration, transcripts,
    isMuted, isSpeaking, isListening, isVoiceCloned,
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
