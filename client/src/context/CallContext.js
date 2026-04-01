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
  // Plays cloned voice (base64 mp3) OR falls back to browser TTS

  const processAudioQueue = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    const item = audioQueueRef.current.shift();
    isPlayingRef.current = true;
    setIsSpeaking(true);

    // Mute raw WebRTC audio during playback
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = 0;
    }

    if (item.audioBase64) {
      // PLAY CLONED VOICE (ElevenLabs mp3)
      playClonedAudio(item.audioBase64).then(() => {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        processAudioQueue();
      }).catch(() => {
        // Fallback to browser TTS if audio fails
        playBrowserTTS(item.text, item.lang).then(() => {
          isPlayingRef.current = false;
          setIsSpeaking(false);
          processAudioQueue();
        });
      });
    } else {
      // FALLBACK: Browser TTS (generic voice)
      playBrowserTTS(item.text, item.lang).then(() => {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        processAudioQueue();
      });
    }
  }, []);

  // Play base64 mp3 audio (cloned voice from ElevenLabs)
  const playClonedAudio = useCallback((base64Audio) => {
    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
        audio.volume = 1.0;
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }, []);

  // Fallback: Browser TTS
  const playBrowserTTS = useCallback((text, lang) => {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getLangCode(lang);
      utterance.rate = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const targetLang = getLangCode(lang);
      const match = voices.find(v => v.lang === targetLang) ||
                    voices.find(v => v.lang.startsWith(lang));
      if (match) utterance.voice = match;

      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  // Queue audio for playback
  const queueAudio = useCallback((text, lang, audioBase64) => {
    audioQueueRef.current.push({ text, lang, audioBase64 });
    if (audioBase64) setIsVoiceCloned(true);
    processAudioQueue();
  }, [processAudioQueue]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((lang, remoteLang, remoteId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getLangCode(lang);

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        setTranscripts(prev => [...prev, { type: 'you', text, lang, timestamp: Date.now() }]);

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
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('Speech recognition error:', e.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
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
      setRemoteUser(contact);
      setCallState('calling');
      setTranscripts([]);
      setIsVoiceCloned(false);
      audioQueueRef.current = [];

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

  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

    try {
      setCallState('in-call');
      setIsVoiceCloned(false);
      audioQueueRef.current = [];

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

  const rejectCall = useCallback((callData) => {
    if (socket) socket.emit('call-rejected', { to: callData.from });
    setCallState('idle');
    setRemoteUser(null);
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

    if (socket && remoteUser) {
      socket.emit('call-ended', { to: remoteUser.userId });
    }

    setCallState('idle');
    setRemoteUser(null);
    setIsMuted(false);
    setIsSpeaking(false);
    setIsListening(false);
    setIsVoiceCloned(false);
  }, [socket, remoteUser, stopTimer, stopSpeechRecognition]);

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

    socket.on('call-rejected', () => endCall());
    socket.on('call-ended', () => endCall());

    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    // RECEIVE translated text + optional cloned voice audio
    socket.on('text-translated', ({ original, translated, fromLang, toLang, audio, voiceCloned }) => {
      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        fromLang,
        toLang,
        voiceCloned: !!voiceCloned,
        timestamp: Date.now()
      }]);

      // Queue audio: cloned voice if available, otherwise browser TTS
      queueAudio(translated, toLang, audio || null);
    });

    socket.on('translation-sent', ({ original, translated }) => {
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) lastYou.translated = translated;
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
  }, [socket, user, remoteUser, endCall, startTimer, startSpeechRecognition, queueAudio]);

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
