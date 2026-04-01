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

// Language code to BCP-47 mapping for Speech Recognition & TTS
const LANG_MAP = {
  'bn': 'bn-BD',
  'zh': 'zh-CN',
  'hi': 'hi-IN',
  'en': 'en-US',
  'es': 'es-ES',
  'fr': 'fr-FR',
  'de': 'de-DE',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'ar': 'ar-SA',
  'pt': 'pt-BR',
  'ru': 'ru-RU',
  'tr': 'tr-TR',
  'th': 'th-TH',
  'vi': 'vi-VN',
  'it': 'it-IT',
  'ms': 'ms-MY',
  'id': 'id-ID',
  'ur': 'ur-PK',
  'ta': 'ta-IN'
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
  const [voiceMode, setVoiceMode] = useState('voice'); // 'voice' = TTS only, 'both' = TTS + text

  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);
  const remoteAudioRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const isTTSSpeakingRef = useRef(false);

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

  // ===== TEXT-TO-SPEECH ENGINE =====
  // Queue-based TTS so translations play one after another, not overlapping
  const processQueue = useCallback(() => {
    if (isTTSSpeakingRef.current || ttsQueueRef.current.length === 0) return;

    const { text, lang } = ttsQueueRef.current.shift();
    isTTSSpeakingRef.current = true;
    setIsSpeaking(true);

    // Mute remote raw audio while TTS speaks (so no overlap)
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = 0;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLangCode(lang);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a voice that matches the language
    const voices = window.speechSynthesis.getVoices();
    const targetLang = getLangCode(lang);
    const matchingVoice = voices.find(v => v.lang === targetLang) ||
                          voices.find(v => v.lang.startsWith(lang));
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onend = () => {
      isTTSSpeakingRef.current = false;
      setIsSpeaking(false);
      // Keep remote audio muted - we only want translated voice
      processQueue(); // Process next in queue
    };

    utterance.onerror = () => {
      isTTSSpeakingRef.current = false;
      setIsSpeaking(false);
      processQueue();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const speakText = useCallback((text, lang) => {
    ttsQueueRef.current.push({ text, lang });
    processQueue();
  }, [processQueue]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((lang, remoteLang, remoteId) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getLangCode(lang);

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];

      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        setTranscripts(prev => [...prev, { type: 'you', text, lang, timestamp: Date.now() }]);

        // Send for translation to the other user
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
      // Auto-restart if still in call
      try {
        recognition.start();
      } catch (e) { /* ignore */ }
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
      // Connect remote audio but keep MUTED - we play TTS translation instead
      const audio = document.getElementById('remote-audio');
      if (audio) {
        audio.srcObject = event.streams[0];
        audio.volume = 0; // MUTED! We only play translated TTS voice
        remoteAudioRef.current = audio;
      }
    };

    peerConnection.current = pc;
    return pc;
  }, [socket]);

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

  // ===== CALL ACTIONS =====
  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    try {
      setRemoteUser(contact);
      setCallState('calling');
      setTranscripts([]);
      ttsQueueRef.current = [];

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
      ttsQueueRef.current = [];

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
    if (socket) {
      socket.emit('call-rejected', { to: callData.from });
    }
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
    ttsQueueRef.current = [];
    isTTSSpeakingRef.current = false;

    if (socket && remoteUser) {
      socket.emit('call-ended', { to: remoteUser.userId });
    }

    setCallState('idle');
    setRemoteUser(null);
    setIsMuted(false);
    setIsSpeaking(false);
    setIsListening(false);
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

    // RECEIVE translated text from remote user → SPEAK it in our language
    socket.on('text-translated', ({ original, translated, fromLang, toLang }) => {
      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        fromLang,
        toLang,
        timestamp: Date.now()
      }]);
      // 🔊 SPEAK the translated text in OUR language - this is the key feature!
      speakText(translated, toLang);
    });

    // Confirmation that our text was translated and sent to remote
    socket.on('translation-sent', ({ original, translated, fromLang, toLang }) => {
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) {
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

  // Load voices on mount (needed for some browsers)
  useEffect(() => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }, []);

  const value = {
    callState,
    remoteUser,
    callDuration,
    transcripts,
    isMuted,
    isSpeaking,
    isListening,
    voiceMode,
    setVoiceMode,
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
