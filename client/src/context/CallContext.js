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

  // ===== TTS QUEUE SYSTEM =====
  // Server sends audio as base64 - just play it! No browser TTS needed.
  const processNextTTS = useCallback(() => {
    if (isTTSPlayingRef.current || ttsQueueRef.current.length === 0) return;

    const { text, lang, audioBase64 } = ttsQueueRef.current.shift();
    isTTSPlayingRef.current = true;
    setIsSpeaking(true);

    const finishTTS = () => {
      isTTSPlayingRef.current = false;
      setIsSpeaking(false);
      // Play next in queue
      setTimeout(() => processNextTTS(), 100);
    };

    if (audioBase64) {
      // SERVER AUDIO - most reliable! Works for ALL languages
      addDebug(`PLAYING SERVER AUDIO for: "${text.substring(0, 30)}..."`);
      try {
        const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
        audio.volume = 1.0;
        audio.onended = () => { addDebug('AUDIO: done ✅'); finishTTS(); };
        audio.onerror = (e) => {
          addDebug(`AUDIO ERROR: ${e.message || 'unknown'}, trying browser TTS...`);
          fallbackBrowserTTS(text, lang, finishTTS);
        };
        audio.play().catch((e) => {
          addDebug(`AUDIO PLAY FAIL: ${e.message}, trying browser TTS...`);
          fallbackBrowserTTS(text, lang, finishTTS);
        });
      } catch (err) {
        addDebug(`AUDIO FAIL: ${err.message}`);
        fallbackBrowserTTS(text, lang, finishTTS);
      }
    } else {
      // No server audio - fallback to browser TTS
      addDebug('No server audio, using browser TTS...');
      fallbackBrowserTTS(text, lang, finishTTS);
    }

    // Safety timeout
    setTimeout(() => {
      if (isTTSPlayingRef.current) {
        addDebug('TTS: timeout, skipping');
        window.speechSynthesis.cancel();
        finishTTS();
      }
    }, 15000);
  }, [addDebug]);

  // Browser TTS as last resort
  const fallbackBrowserTTS = useCallback((text, lang, onDone) => {
    try {
      const langCode = getLangCode(lang);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode;
      utterance.rate = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.lang === langCode) ||
                    voices.find(v => v.lang.startsWith(lang));
      if (match) utterance.voice = match;

      utterance.onend = onDone;
      utterance.onerror = onDone;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      addDebug(`Browser TTS fail: ${e.message}`);
      onDone();
    }
  }, [addDebug]);

  const queueTTS = useCallback((text, lang, audioBase64) => {
    if (!text || !text.trim()) return;
    addDebug(`QUEUE TTS: "${text.substring(0, 40)}" (${lang}) audio:${audioBase64 ? 'YES' : 'NO'}`);
    ttsQueueRef.current.push({ text, lang, audioBase64 });
    processNextTTS();
  }, [addDebug, processNextTTS]);

  // ===== REQUEST MIC PERMISSION (fixes mobile not-allowed error) =====
  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Got permission, now release the stream (we don't need it for WebRTC)
      stream.getTracks().forEach(track => track.stop());
      addDebug('MIC PERMISSION: granted');
      return true;
    } catch (err) {
      addDebug(`MIC PERMISSION DENIED: ${err.message}`);
      return false;
    }
  }, [addDebug]);

  // ===== SPEECH RECOGNITION =====
  const startSpeechRecognition = useCallback(async (myLang, targetLang, remoteId) => {
    addDebug(`START MIC: ${myLang} → ${targetLang}, remote=${remoteId}`);
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addDebug('ERROR: SpeechRecognition not supported!');
      return;
    }

    // Request mic permission FIRST (prevents not-allowed on mobile)
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      addDebug('Cannot start mic - permission denied');
      return;
    }

    // Stop existing
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) { /* */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    processedResultsRef.current = 0;
    let retryCount = 0;
    const MAX_RETRIES = 50; // Allow many retries during a call

    recognition.onstart = () => {
      setIsListening(true);
      retryCount = 0; // Reset on successful start
      addDebug(`MIC ON: ${myLang}`);
    };

    recognition.onresult = (event) => {
      for (let i = processedResultsRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          processedResultsRef.current = i + 1;

          if (!text || text.length < 2) continue;

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
      if (e.error === 'not-allowed') {
        addDebug('MIC: not-allowed - re-requesting permission...');
        // Re-request permission and retry
        requestMicPermission().then(ok => {
          if (ok && callStateRef.current === 'in-call') {
            setTimeout(() => {
              try { recognition.start(); } catch (err) { /* */ }
            }, 1000);
          }
        });
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        addDebug(`MIC ERROR: ${e.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (callStateRef.current === 'in-call' && retryCount < MAX_RETRIES) {
        processedResultsRef.current = 0;
        retryCount++;
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
  }, [addDebug, requestMicPermission]);

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

    // RECEIVE translated text + audio from other person
    const onTextTranslated = ({ original, translated, toLang, audio }) => {
      addDebugRef.current(`RECEIVED: "${original}" → "${translated}" (${toLang}) audio:${audio ? 'YES' : 'NO'}`);

      setTranscripts(prev => [...prev, {
        type: 'remote', text: original, translated,
        toLang, timestamp: Date.now()
      }]);

      // Queue TTS with server audio!
      queueTTSRef.current(translated, toLang, audio || null);
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
