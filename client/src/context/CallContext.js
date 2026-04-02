import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

const CallContext = createContext();

export function useCall() {
  return useContext(CallContext);
}

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

  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const remoteUserRef = useRef(null);
  const callStateRef = useRef('idle');
  const socketRef = useRef(null);
  const userRef = useRef(null);
  const callParamsRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { userRef.current = user; }, [user]);

  const addDebug = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
    setDebugLog(prev => [...prev.slice(-30), `${time}: ${msg}`]);
  }, []);

  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ===== TTS AUDIO PLAYBACK =====
  const speakWithTTS = useCallback((text, lang) => {
    addDebug(`TTS: "${text.substring(0, 40)}..." in ${lang}`);

    try {
      window.speechSynthesis.cancel();

      // Chrome bug: need delay after cancel
      setTimeout(() => {
        try {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = getLangCode(lang);
          utterance.rate = 1.0;
          utterance.volume = 1.0;

          const voices = window.speechSynthesis.getVoices();
          const targetLang = getLangCode(lang);
          const match = voices.find(v => v.lang === targetLang) ||
                        voices.find(v => v.lang.startsWith(lang)) ||
                        voices.find(v => v.lang.startsWith(lang.split('-')[0]));
          if (match) {
            utterance.voice = match;
            addDebug(`TTS voice: ${match.name}`);
          } else {
            addDebug(`TTS: no voice for ${lang}, default (${voices.length} available)`);
          }

          utterance.onstart = () => addDebug('TTS: SPEAKING...');
          utterance.onend = () => { addDebug('TTS: done'); setIsSpeaking(false); };
          utterance.onerror = (e) => { addDebug(`TTS ERROR: ${e.error}`); setIsSpeaking(false); };

          setTimeout(() => setIsSpeaking(false), 30000);

          window.speechSynthesis.speak(utterance);

          // Chrome stuck workaround
          setTimeout(() => {
            if (window.speechSynthesis.paused) window.speechSynthesis.resume();
          }, 100);
        } catch (err) {
          addDebug(`TTS fail: ${err.message}`);
          setIsSpeaking(false);
        }
      }, 150);
    } catch (err) {
      addDebug(`TTS fail: ${err.message}`);
      setIsSpeaking(false);
    }
  }, [addDebug]);

  const playTranslatedAudio = useCallback((text, lang, audioBase64) => {
    if (!text) return;
    setIsSpeaking(true);

    if (audioBase64) {
      try {
        const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
        audio.volume = 1.0;
        audio.onended = () => { setIsSpeaking(false); addDebug('Cloned voice done'); };
        audio.onerror = () => speakWithTTS(text, lang);
        audio.play().catch(() => speakWithTTS(text, lang));
        setIsVoiceCloned(true);
        return;
      } catch (e) { /* fallthrough */ }
    }
    speakWithTTS(text, lang);
  }, [speakWithTTS, addDebug]);

  // ===== SPEECH RECOGNITION (NO WebRTC - mic is FREE) =====
  const startSpeechRecognition = useCallback((myLang, targetLang, remoteId) => {
    addDebug(`START RECOGNITION: ${myLang} → ${targetLang}, to=${remoteId}`);
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addDebug('ERROR: SpeechRecognition not supported!');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      addDebug(`MIC ON: ${myLang}`);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (!text) return;

        addDebug(`HEARD: "${text}"`);

        setTranscripts(prev => [...prev, {
          type: 'you', text, lang: myLang, timestamp: Date.now()
        }]);

        const sock = socketRef.current;
        if (sock && sock.connected) {
          sock.emit('translate-text', {
            text, fromLang: myLang, toLang: targetLang, to: remoteId
          });
          addDebug(`SENT to ${remoteId}`);
        } else {
          addDebug('ERROR: Socket disconnected!');
        }
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        // Normal - just no speech detected yet
      } else {
        addDebug(`MIC ERROR: ${e.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (callStateRef.current === 'in-call') {
        setTimeout(() => {
          if (callStateRef.current === 'in-call' && recognitionRef.current) {
            try {
              recognition.start();
            } catch (e) {
              addDebug(`RESTART FAIL: ${e.message}`);
            }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      addDebug('recognition.start() OK');
    } catch (e) {
      addDebug(`recognition.start() FAIL: ${e.message}`);
    }
  }, [addDebug]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Manual text send for testing
  const sendTestMessage = useCallback((text) => {
    const params = callParamsRef.current;
    const sock = socketRef.current;
    if (!params || !sock) {
      addDebug('Cannot send - no params/socket');
      return;
    }
    addDebug(`MANUAL: "${text}" to ${params.remoteId}`);
    sock.emit('translate-text', {
      text, fromLang: params.myLang, toLang: params.remoteLang, to: params.remoteId
    });
    setTranscripts(prev => [...prev, {
      type: 'you', text, lang: params.myLang, timestamp: Date.now()
    }]);
  }, [addDebug]);

  // ===== CALL ACTIONS (No WebRTC - just Socket.IO signaling) =====

  const callUser = useCallback(async (contact) => {
    if (!socket || !user) return;

    const remote = { userId: contact.userId, name: contact.name, language: contact.language };
    setRemoteUser(remote);
    remoteUserRef.current = remote;
    setCallState('calling');
    callStateRef.current = 'calling';
    setTranscripts([]);
    setDebugLog([]);
    setIsVoiceCloned(false);

    addDebug(`CALLING ${contact.name} (${contact.userId})`);
    addDebug(`My lang: ${user.language}, Remote lang: ${contact.language}`);

    socket.emit('call-user', {
      to: contact.userId,
      from: user.id,
      callerName: user.name,
      offer: { type: 'voice-translate' }, // No WebRTC offer needed
      callerLang: user.language
    });
  }, [socket, user, addDebug]);

  const acceptCall = useCallback(async (callData) => {
    if (!socket || !user) return;

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

    addDebug(`ACCEPTED from ${callData.callerName}`);
    addDebug(`My lang: ${user.language}, Caller lang: ${callData.callerLang}`);

    socket.emit('call-accepted', {
      to: callData.from,
      answer: { type: 'voice-translate' }, // No WebRTC answer needed
      accepterLang: user.language,
      accepterName: user.name
    });

    startTimer();

    // Start listening - NO mic conflict since no getUserMedia!
    addDebug('Starting mic (no WebRTC = no conflict)...');
    startSpeechRecognition(user.language, callData.callerLang, callData.from);
  }, [socket, user, startTimer, startSpeechRecognition, addDebug]);

  const rejectCall = useCallback((callData) => {
    if (socket) socket.emit('call-rejected', { to: callData.from });
    setCallState('idle');
    callStateRef.current = 'idle';
    setRemoteUser(null);
    remoteUserRef.current = null;
  }, [socket]);

  const endCall = useCallback(() => {
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
    if (recognitionRef.current) {
      if (isMuted) {
        // Unmute - restart recognition
        const params = callParamsRef.current;
        if (params) {
          startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
        }
        setIsMuted(false);
      } else {
        // Mute - stop recognition
        stopSpeechRecognition();
        setIsMuted(true);
      }
    }
  }, [isMuted, startSpeechRecognition, stopSpeechRecognition]);

  // ===== SOCKET EVENTS =====
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

  useEffect(() => {
    if (!socket) return;

    // Caller (A) gets call accepted
    const onCallAccepted = ({ accepterLang, accepterName }) => {
      addDebugRef.current(`CALL ACCEPTED by ${accepterName} (${accepterLang})`);

      setCallState('in-call');
      callStateRef.current = 'in-call';
      startTimerRef.current();

      const currentRemote = remoteUserRef.current;
      if (currentRemote) {
        const updated = { ...currentRemote, language: accepterLang };
        if (accepterName) updated.name = accepterName;
        setRemoteUser(updated);
        remoteUserRef.current = updated;

        const currentUser = userRef.current;
        const myLang = currentUser?.language || 'en';
        addDebugRef.current(`Starting mic: ${myLang} → ${accepterLang}`);
        startSpeechRecognitionRef.current(myLang, accepterLang, currentRemote.userId);
      }
    };

    // Receive translation from remote
    const onTextTranslated = ({ original, translated, fromLang, toLang, audio, voiceCloned: vc }) => {
      addDebugRef.current(`RECEIVED: "${original}" → "${translated}"`);

      setTranscripts(prev => [...prev, {
        type: 'remote', text: original, translated,
        fromLang, toLang, voiceCloned: !!vc, timestamp: Date.now()
      }]);

      // PLAY the translated voice!
      playTranslatedAudioRef.current(translated, toLang, audio || null);
    };

    const onTranslationSent = ({ original, translated }) => {
      addDebugRef.current(`CONFIRMED: "${original}" → "${translated}"`);
      setTranscripts(prev => {
        const updated = [...prev];
        const lastYou = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (lastYou) lastYou.translated = translated;
        return [...updated];
      });
    };

    const onCallRejected = () => endCallRef.current();
    const onCallEnded = () => endCallRef.current();
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
    socket.on('text-translated', onTextTranslated);
    socket.on('translation-sent', onTranslationSent);
    socket.on('call-failed', onCallFailed);

    return () => {
      socket.off('call-accepted', onCallAccepted);
      socket.off('call-rejected', onCallRejected);
      socket.off('call-ended', onCallEnded);
      socket.off('text-translated', onTextTranslated);
      socket.off('translation-sent', onTranslationSent);
      socket.off('call-failed', onCallFailed);
    };
  }, [socket]);

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
    </CallContext.Provider>
  );
}
