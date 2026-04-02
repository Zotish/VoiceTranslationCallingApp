import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

const CallContext = createContext();

export function useCall() {
  return useContext(CallContext);
}

const LANG_MAP = {
  'bn': 'bn-IN', 'zh': 'zh-CN', 'hi': 'hi-IN', 'en': 'en-US',
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
  const [debugLog, setDebugLog] = useState([]);

  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const remoteUserRef = useRef(null);
  const callStateRef = useRef('idle');
  const socketRef = useRef(null);
  const userRef = useRef(null);
  const callParamsRef = useRef(null);
  const processedResultsRef = useRef(0);

  // TTS Queue - prevents cancel storm
  const ttsQueueRef = useRef([]);
  const isTTSPlayingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { userRef.current = user; }, [user]);

  const addDebug = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
    setDebugLog(prev => [...prev.slice(-40), `${time}: ${msg}`]);
  }, []);

  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ===== TTS QUEUE SYSTEM - plays one at a time, no canceling =====
  const processNextTTS = useCallback(() => {
    if (isTTSPlayingRef.current || ttsQueueRef.current.length === 0) return;

    const { text, lang } = ttsQueueRef.current.shift();
    isTTSPlayingRef.current = true;
    setIsSpeaking(true);

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const langCode = getLangCode(lang);
      utterance.lang = langCode;
      utterance.rate = 1.0;
      utterance.volume = 1.0;

      // Find best matching voice
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.lang === langCode) ||
                    voices.find(v => v.lang.startsWith(lang + '-')) ||
                    voices.find(v => v.lang.startsWith(lang + '_')) ||
                    voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));

      if (match) {
        utterance.voice = match;
        addDebug(`TTS voice: ${match.name} (${match.lang})`);
      } else {
        addDebug(`TTS: no ${lang} voice, using default`);
      }

      utterance.onstart = () => addDebug(`TTS PLAYING: "${text.substring(0, 30)}..."`);

      utterance.onend = () => {
        addDebug('TTS: finished');
        isTTSPlayingRef.current = false;
        setIsSpeaking(false);
        // Play next in queue
        processNextTTS();
      };

      utterance.onerror = (e) => {
        addDebug(`TTS ERROR: ${e.error}`);
        isTTSPlayingRef.current = false;
        setIsSpeaking(false);
        processNextTTS();
      };

      window.speechSynthesis.speak(utterance);

      // Chrome stuck fix
      setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 200);

      // Safety timeout - if TTS hangs for 15s, move on
      setTimeout(() => {
        if (isTTSPlayingRef.current) {
          addDebug('TTS: timeout, moving on');
          window.speechSynthesis.cancel();
          isTTSPlayingRef.current = false;
          setIsSpeaking(false);
          processNextTTS();
        }
      }, 15000);

    } catch (err) {
      addDebug(`TTS fail: ${err.message}`);
      isTTSPlayingRef.current = false;
      setIsSpeaking(false);
      processNextTTS();
    }
  }, [addDebug]);

  const queueTTS = useCallback((text, lang) => {
    if (!text || !text.trim()) return;
    addDebug(`QUEUE TTS: "${text.substring(0, 40)}" (${lang})`);
    ttsQueueRef.current.push({ text, lang });
    processNextTTS();
  }, [addDebug, processNextTTS]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback((myLang, targetLang, remoteId) => {
    addDebug(`START MIC: ${myLang} → ${targetLang}, remote=${remoteId}`);
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addDebug('ERROR: SpeechRecognition not supported!');
      return;
    }

    // Stop existing
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // ONLY final results - no duplicates!
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    // Track which results we already processed
    processedResultsRef.current = 0;

    recognition.onstart = () => {
      setIsListening(true);
      addDebug(`MIC ON: ${myLang}`);
    };

    recognition.onresult = (event) => {
      // Process ONLY new results we haven't seen
      for (let i = processedResultsRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          processedResultsRef.current = i + 1;

          if (!text || text.length < 2) continue; // Skip tiny fragments

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
            addDebug('ERROR: Socket not connected!');
          }
        }
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        addDebug(`MIC ERROR: ${e.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (callStateRef.current === 'in-call') {
        // Reset result counter on restart
        processedResultsRef.current = 0;
        setTimeout(() => {
          if (callStateRef.current === 'in-call' && recognitionRef.current) {
            try {
              recognition.start();
            } catch (e) {
              addDebug(`MIC RESTART FAIL: ${e.message}`);
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

  // Manual text send
  const sendTestMessage = useCallback((text) => {
    const params = callParamsRef.current;
    const sock = socketRef.current;
    if (!params || !sock) {
      addDebug('Cannot send - no active call');
      return;
    }
    addDebug(`MANUAL SEND: "${text}"`);
    sock.emit('translate-text', {
      text, fromLang: params.myLang, toLang: params.remoteLang, to: params.remoteId
    });
    setTranscripts(prev => [...prev, {
      type: 'you', text, lang: params.myLang, timestamp: Date.now()
    }]);
  }, [addDebug]);

  // ===== CALL ACTIONS =====
  const callUser = useCallback((contact) => {
    if (!socket || !user) return;

    const remote = { userId: contact.userId, name: contact.name, language: contact.language };
    setRemoteUser(remote);
    remoteUserRef.current = remote;
    setCallState('calling');
    callStateRef.current = 'calling';
    setTranscripts([]);
    setDebugLog([]);
    ttsQueueRef.current = [];
    isTTSPlayingRef.current = false;

    addDebug(`CALLING ${contact.name} (${contact.userId})`);
    addDebug(`My: ${user.language}, Remote: ${contact.language}`);

    socket.emit('call-user', {
      to: contact.userId,
      from: user.id,
      callerName: user.name,
      offer: { type: 'voice-translate' },
      callerLang: user.language
    });
  }, [socket, user, addDebug]);

  const acceptCall = useCallback((callData) => {
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
    ttsQueueRef.current = [];
    isTTSPlayingRef.current = false;

    addDebug(`ACCEPTED from ${callData.callerName}`);
    addDebug(`My: ${user.language}, Caller: ${callData.callerLang}`);

    socket.emit('call-accepted', {
      to: callData.from,
      answer: { type: 'voice-translate' },
      accepterLang: user.language,
      accepterName: user.name
    });

    startTimer();
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
    ttsQueueRef.current = [];
    isTTSPlayingRef.current = false;

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
  }, [socket, stopTimer, stopSpeechRecognition]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      const params = callParamsRef.current;
      if (params) {
        startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
      }
      setIsMuted(false);
    } else {
      stopSpeechRecognition();
      setIsMuted(true);
    }
  }, [isMuted, startSpeechRecognition, stopSpeechRecognition]);

  // ===== SOCKET EVENT HANDLERS =====
  const queueTTSRef = useRef(queueTTS);
  useEffect(() => { queueTTSRef.current = queueTTS; }, [queueTTS]);

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

    // CALLER receives call-accepted
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
      } else {
        addDebugRef.current('ERROR: No remote user set!');
      }
    };

    // RECEIVE translated text from other person
    const onTextTranslated = ({ original, translated, toLang, audio }) => {
      addDebugRef.current(`RECEIVED: "${original}" → "${translated}" (${toLang})`);

      setTranscripts(prev => [...prev, {
        type: 'remote', text: original, translated,
        toLang, timestamp: Date.now()
      }]);

      // Queue TTS - will play in order, no canceling!
      queueTTSRef.current(translated, toLang);
    };

    // Confirm my sent translation
    const onTranslationSent = ({ original, translated }) => {
      addDebugRef.current(`CONFIRMED: "${original}" → "${translated}"`);
      setTranscripts(prev => {
        const updated = [...prev];
        const match = [...updated].reverse().find(t => t.type === 'you' && t.text === original);
        if (match) match.translated = translated;
        return [...updated];
      });
    };

    const onCallRejected = () => {
      addDebugRef.current('CALL REJECTED');
      endCallRef.current();
    };

    const onCallEnded = () => {
      addDebugRef.current('CALL ENDED by remote');
      endCallRef.current();
    };

    const onCallFailed = ({ message }) => {
      addDebugRef.current(`CALL FAILED: ${message}`);
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

  // Load TTS voices early
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        console.log(`Loaded ${voices.length} TTS voices`);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const value = {
    callState, remoteUser, callDuration, transcripts,
    isMuted, isSpeaking, isListening, debugLog,
    callUser, acceptCall, rejectCall, endCall, toggleMute,
    sendTestMessage, setRemoteUser, setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}
