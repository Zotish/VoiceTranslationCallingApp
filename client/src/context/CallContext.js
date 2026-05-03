import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import * as api from '../services/api';

const CallContext = createContext();

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

const LANG_MAP = {
  bn: 'bn-IN', zh: 'zh-CN', hi: 'hi-IN', en: 'en-US',
  es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
  ko: 'ko-KR', ar: 'ar-SA', pt: 'pt-BR', ru: 'ru-RU',
  tr: 'tr-TR', th: 'th-TH', vi: 'vi-VN', it: 'it-IT',
  ms: 'ms-MY', id: 'id-ID', ur: 'ur-PK', ta: 'ta-IN'
};

function getLangCode(lang) {
  return LANG_MAP[lang] || lang;
}

export function useCall() {
  return useContext(CallContext);
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
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');

  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const callDurationRef = useRef(0);
  const remoteUserRef = useRef(null);
  const callStateRef = useRef('idle');
  const socketRef = useRef(null);
  const userRef = useRef(null);
  const callParamsRef = useRef(null);
  const callMetaRef = useRef(null);
  const processedResultsRef = useRef(0);
  const ttsQueueRef = useRef([]);
  const isTTSPlayingRef = useRef(false);
  const translationAudioElementRef = useRef(null);
  const comfortNoiseRef = useRef(null);
  const recognitionRestartTimeoutRef = useRef(null);
  const recognitionWatchdogIntervalRef = useRef(null);
  const recognitionStartLockRef = useRef(false);

  // ... rest of the state ...

  const startComfortNoise = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const ctx = new AudioContext();
      
      // Create a 1-second buffer of absolute silence
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      
      // Connect to destination but at zero volume just in case
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();

      comfortNoiseRef.current = { ctx, source };
      addDebug('Silent comfort noise active (keeping connection alive)');
    } catch (err) {
      console.warn('Comfort noise failed:', err);
    }
  }, [addDebug]);

  const stopComfortNoise = useCallback(() => {
    if (comfortNoiseRef.current) {
      try {
        comfortNoiseRef.current.source.stop();
        comfortNoiseRef.current.ctx.close();
      } catch (err) {
        // ignore
      }
      comfortNoiseRef.current = null;
    }
  }, []);
  const speechDispatchStateRef = useRef({
    silenceTimer: null,
    lastSentNormalized: ''
  });

  useEffect(() => { callDurationRef.current = callDuration; }, [callDuration]);
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { userRef.current = user; }, [user]);

  const addDebug = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    setDebugLog(prev => [...prev.slice(-59), `${time}: ${msg}`]);
    console.log(`[call] ${msg}`);
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCallDuration(0);
    timerRef.current = setInterval(() => setCallDuration(prev => prev + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSpeechDispatchTimer = useCallback(() => {
    if (speechDispatchStateRef.current.silenceTimer) {
      window.clearTimeout(speechDispatchStateRef.current.silenceTimer);
      speechDispatchStateRef.current.silenceTimer = null;
    }
  }, []);

  const clearRecognitionRestartTimer = useCallback(() => {
    if (recognitionRestartTimeoutRef.current) {
      window.clearTimeout(recognitionRestartTimeoutRef.current);
      recognitionRestartTimeoutRef.current = null;
    }
  }, []);

  const normalizeTranscript = useCallback((text) => (
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ), []);

  const splitTranslationChunks = useCallback((text) => {
    const cleaned = String(text || '').trim();
    if (!cleaned) return [];

    const sentenceParts = cleaned
      .split(/(?<=[.!?,;:।!?])/u)
      .map(part => part.trim())
      .filter(Boolean);

    const sourceParts = sentenceParts.length > 0 ? sentenceParts : [cleaned];
    const chunks = [];

    sourceParts.forEach((part) => {
      if (part.length <= 120) {
        chunks.push(part);
        return;
      }

      const words = part.split(/\s+/);
      let current = '';

      words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (next.length > 120 && current) {
          chunks.push(current);
          current = word;
        } else {
          current = next;
        }
      });

      if (current) chunks.push(current);
    });

    return chunks;
  }, []);

  const fallbackBrowserTTS = useCallback((text, lang, onDone) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getLangCode(lang);
      utterance.rate = 1;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.lang === utterance.lang) ||
        voices.find(v => v.lang.toLowerCase().startsWith(String(lang).toLowerCase()));
      if (match) utterance.voice = match;

      utterance.onend = onDone;
      utterance.onerror = onDone;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      addDebug(`Browser TTS failed: ${err.message}`);
      onDone();
    }
  }, [addDebug]);

  const setTranslationAudioElement = useCallback((element) => {
    translationAudioElementRef.current = element || null;
  }, []);

  const unlockTranslationAudio = useCallback(async () => {
    const element = translationAudioElementRef.current;
    if (!element) return;

    try {
      element.muted = true;
      element.src = '';
      const maybePromise = element.play();
      if (maybePromise?.then) {
        await maybePromise;
      }
      element.pause();
      element.currentTime = 0;
      element.muted = false;
      addDebug('Translation audio unlocked');
    } catch (err) {
      addDebug(`Translation audio unlock skipped: ${err.message}`);
    }
  }, [addDebug]);

  const processNextTTS = useCallback(() => {
    if (isTTSPlayingRef.current || ttsQueueRef.current.length === 0) return;

    const { text, lang, audioBase64 } = ttsQueueRef.current.shift();
    isTTSPlayingRef.current = true;
    setIsSpeaking(true);

    const finish = () => {
      isTTSPlayingRef.current = false;
      setIsSpeaking(false);
      window.setTimeout(() => processNextTTS(), 100);
    };

    if (audioBase64) {
      try {
        const element = translationAudioElementRef.current;
        if (!element) {
          throw new Error('translation audio element not ready');
        }

        element.pause();
        element.currentTime = 0;
        element.src = `data:audio/mpeg;base64,${audioBase64}`;
        element.volume = 1;
        element.onended = finish;
        element.onerror = () => fallbackBrowserTTS(text, lang, finish);

        element.play()
          .then(() => addDebug(`Playing translated audio (${lang})`))
          .catch((err) => {
            addDebug(`Translated audio autoplay blocked: ${err.message}`);
            fallbackBrowserTTS(text, lang, finish);
          });
      } catch (err) {
        addDebug(`Server audio playback failed: ${err.message}`);
        fallbackBrowserTTS(text, lang, finish);
      }
    } else {
      fallbackBrowserTTS(text, lang, finish);
    }

    window.setTimeout(() => {
      if (isTTSPlayingRef.current) {
        window.speechSynthesis.cancel();
        finish();
      }
    }, 15000);
  }, [addDebug, fallbackBrowserTTS]);

  const queueTTS = useCallback((text, lang, audioBase64) => {
    if (!text || !text.trim()) return;
    ttsQueueRef.current.push({ text, lang, audioBase64 });
    processNextTTS();
  }, [processNextTTS]);

  const dispatchTranslation = useCallback((text, myLang, targetLang, remoteId, { force = false } = {}) => {
    const normalized = normalizeTranscript(text);
    if (!normalized || normalized.length < 2) return false;

    if (!force && normalized === speechDispatchStateRef.current.lastSentNormalized) {
      return false;
    }

    const chunks = splitTranslationChunks(text);
    if (chunks.length === 0) return false;

    speechDispatchStateRef.current.lastSentNormalized = normalized;
    clearSpeechDispatchTimer();

    setTranscripts(prev => [...prev, {
      type: 'you',
      text,
      lang: myLang,
      timestamp: Date.now()
    }]);

    chunks.forEach((chunk) => {
      socketRef.current?.emit('translate-text', {
        text: chunk,
        fromLang: myLang,
        toLang: targetLang,
        to: remoteId
      });
    });

    addDebug(`Translation sent in ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}`);
    return true;
  }, [addDebug, clearSpeechDispatchTimer, normalizeTranscript, splitTranslationChunks]);

  const scheduleSpeechDispatch = useCallback((text, myLang, targetLang, remoteId) => {
    clearSpeechDispatchTimer();
    if (!text || !text.trim()) return;

    speechDispatchStateRef.current.silenceTimer = window.setTimeout(() => {
      dispatchTranslation(text, myLang, targetLang, remoteId);
    }, 1500); // Increased from 850ms to 1.5s for more natural speech
  }, [clearSpeechDispatchTimer, dispatchTranslation]);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    localStreamRef.current = stream;
    setLocalStream(stream);
    setConnectionStatus('media-ready');
    stream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });
    addDebug(`Local microphone ready (${stream.getAudioTracks().length} audio track)`);
    return stream;
  }, [addDebug, isMuted]);

  const cleanupMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
  }, []);

  const cleanupPeerConnection = useCallback(() => {
    pendingCandidatesRef.current = [];

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }, []);

  const flushPendingCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) return;

    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        addDebug(`Failed to add queued ICE candidate: ${err.message}`);
      }
    }
  }, [addDebug]);

  const createPeerConnection = useCallback(async (remoteId) => {
    cleanupPeerConnection();

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteMedia = new MediaStream();
    peerConnectionRef.current = pc;
    remoteStreamRef.current = remoteMedia;
    setRemoteStream(remoteMedia);
    setConnectionStatus('connecting');

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && remoteId) {
        socketRef.current.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      addDebug(`Remote track received: ${event.track.kind}`);
      
      // If we want to mute original, disable the track at the source level
      if (callStateRef.current === 'in-call' || callStateRef.current === 'connecting') {
          // We can't easily check muteOriginal state here without a ref, 
          // but the <audio muted={muteOriginal}> handles the volume.
      }

      // Use the first stream provided, or create one if missing
      const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      
      // Update remote stream state with a new reference to ensure re-render
      setRemoteStream(new MediaStream(stream.getTracks()));
      setConnectionStatus('connected-media');
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionStatus(state);
      addDebug(`Peer connection state: ${state}`);

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        // Don't immediately stop listening, let the watchdog try to recover
        // unless it's a permanent failure
        if (state === 'failed' || state === 'closed') {
          setIsListening(false);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      addDebug(`ICE state: ${pc.iceConnectionState}`);
    };

    const stream = await ensureLocalStream();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    return pc;
  }, [addDebug, cleanupPeerConnection, ensureLocalStream]);

  const stopSpeechRecognition = useCallback(() => {
    clearRecognitionRestartTimer();
    clearSpeechDispatchTimer();
    recognitionStartLockRef.current = false;

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearRecognitionRestartTimer, clearSpeechDispatchTimer]);

  const startSpeechRecognition = useCallback(async (myLang, targetLang, remoteId) => {
    if (recognitionStartLockRef.current) return;
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      addDebug('Speech recognition is not supported in this browser');
      return;
    }

    // Detect if we are on a mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) addDebug('Mobile device detected - applying speech optimizations');

    // On mobile, the WebRTC audio track often conflicts with SpeechRecognition.
    // If we are on mobile, we FORCE DISABLE the WebRTC mic track to let STT work.
    if (isMobile && localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
        addDebug('Mobile Mic Liberation: WebRTC mic track disabled to allow translation');
    }

    setSpeechSupported(true);
    clearRecognitionRestartTimer();
    recognitionStartLockRef.current = true;

    try {
      const stream = await ensureLocalStream();
      
      // MOBILE MIC HANDSHAKE:
      // On Android, if WebRTC is active, SpeechRecognition often fails to start.
      // We briefly disable the audio track to "release" the lock and let the OS share it.
      if (isMobile && stream) {
        stream.getAudioTracks().forEach(track => { track.enabled = false; });
        addDebug('Mobile Mic Handshake: Releasing WebRTC track briefly...');
      }

      // Force AudioContext resume for mobile
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const tempCtx = new AudioContext();
        if (tempCtx.state === 'suspended') await tempCtx.resume();
      }
      
      // Wait a tiny bit for the OS to register the track release
      if (isMobile) await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      recognitionStartLockRef.current = false;
      addDebug(`Microphone unavailable for translation: ${err.message}`);
      return;
    }

    stopSpeechRecognition();
    recognitionStartLockRef.current = true;

    const recognition = new SpeechRecognition();
    // MOBILE OPTIMIZATION: On some Androids, continuous:true is the cause of the lock.
    // If it's mobile, we use continuous:false which is much more stable.
    recognition.continuous = !isMobile; 
    recognition.interimResults = true;
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    processedResultsRef.current = 0;

    recognition.onstart = () => {
      recognitionStartLockRef.current = false;
      setIsListening(true);
      addDebug(`Speech recognition active: ${myLang} -> ${targetLang}`);
      
      // RE-ENABLE WebRTC track after recognition has successfully started
      if (isMobile && localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => { 
          if (!isMuted) track.enabled = true; 
        });
        addDebug('Mobile Mic Handshake: WebRTC track re-enabled');
      }
    };

    recognition.onresult = (event) => {
      // If we are currently playing a translation, ignore results to prevent echo loop
      if (isSpeaking) return;

      let latestInterim = '';

      for (let i = processedResultsRef.current; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim();
        if (!text || text.length < 2) continue;

        if (result.isFinal) {
          processedResultsRef.current = i + 1;
          dispatchTranslation(text, myLang, targetLang, remoteId);
          latestInterim = '';
          setInterimTranscript('');
        } else {
          latestInterim = text;
          setInterimTranscript(text);
        }
      }

      if (latestInterim) {
        scheduleSpeechDispatch(latestInterim, myLang, targetLang, remoteId);
      }
    };

    recognition.onerror = (event) => {
      recognitionStartLockRef.current = false;

      if (event.error !== 'aborted') {
        addDebug(`Speech recognition error: ${event.error}`);
      }

      if (callStateRef.current === 'in-call' && !isMuted) {
        clearRecognitionRestartTimer();
        // Faster restart for mobile on errors
        const delay = isMobile ? 300 : (event.error === 'no-speech' ? 400 : 900);
        recognitionRestartTimeoutRef.current = window.setTimeout(() => {
          const params = callParamsRef.current;
          if (!params || callStateRef.current !== 'in-call' || isMuted) return;
          startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
        }, delay);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      recognitionStartLockRef.current = false;
      setIsListening(false);

      if (callStateRef.current === 'in-call' && !isMuted) {
        clearRecognitionRestartTimer();
        // Very aggressive restart for mobile when recognition ends naturally
        const delay = isMobile ? 100 : 500;
        recognitionRestartTimeoutRef.current = window.setTimeout(() => {
          const params = callParamsRef.current;
          if (!params || callStateRef.current !== 'in-call' || isMuted) return;
          addDebug('Auto-restarting speech recognition (end-of-session)');
          startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
        }, delay);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      recognitionStartLockRef.current = false;
      addDebug(`Speech recognition start failed: ${err.message}`);
    }
  }, [
    addDebug,
    clearRecognitionRestartTimer,
    dispatchTranslation,
    ensureLocalStream,
    isMuted,
    scheduleSpeechDispatch,
    stopSpeechRecognition
  ]);

  const logCompletedCall = useCallback(async () => {
    const remote = remoteUserRef.current;
    const currentUser = userRef.current;
    const meta = callMetaRef.current;

    if (!remote || !currentUser || !meta || meta.logged || meta.connected !== true) {
      return;
    }

    meta.logged = true;

    const isIncoming = (meta.type || 'outgoing') === 'incoming';

    try {
      await api.logCall({
        callerId: isIncoming ? remote.userId : currentUser.id,
        callerName: isIncoming ? remote.name : currentUser.name,
        calleeId: isIncoming ? currentUser.id : remote.userId,
        calleeName: isIncoming ? currentUser.name : remote.name,
        duration: callDurationRef.current,
        fromLang: isIncoming ? remote.language : currentUser.language,
        toLang: isIncoming ? currentUser.language : remote.language,
        type: meta.type || 'outgoing'
      });
    } catch (err) {
      addDebug(`Call log failed: ${err.response?.data?.error || err.message}`);
    }
  }, [addDebug]);

  const resetCallState = useCallback(({ keepDebug = false } = {}) => {
    stopTimer();
    stopSpeechRecognition();
    stopComfortNoise();
    window.speechSynthesis.cancel();
    ttsQueueRef.current = [];
    isTTSPlayingRef.current = false;
    clearSpeechDispatchTimer();
    clearRecognitionRestartTimer();
    speechDispatchStateRef.current.lastSentNormalized = '';
    cleanupPeerConnection();
    cleanupMedia();

    setCallState('idle');
    setRemoteUser(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsSpeaking(false);
    setIsListening(false);
    setConnectionStatus('idle');
    setLocalStream(null);
    setRemoteStream(null);
    if (!keepDebug) setDebugLog([]);

    remoteUserRef.current = null;
    callStateRef.current = 'idle';
    callParamsRef.current = null;
    callMetaRef.current = null;
  }, [cleanupMedia, cleanupPeerConnection, clearRecognitionRestartTimer, clearSpeechDispatchTimer, stopSpeechRecognition, stopTimer, stopComfortNoise]);

  const endCall = useCallback(async ({ notifyRemote = true } = {}) => {
    await logCompletedCall();

    const remote = remoteUserRef.current;
    if (notifyRemote && socketRef.current && remote) {
      socketRef.current.emit('call-ended', { to: remote.userId });
    }

    resetCallState({ keepDebug: false });
  }, [logCompletedCall, resetCallState]);

  const callUser = useCallback(async (contact) => {
    if (!socketRef.current || !userRef.current) return;

    try {
      const remote = { userId: contact.userId, name: contact.name, language: contact.language };
      setRemoteUser(remote);
      remoteUserRef.current = remote;
      setCallState('calling');
      setTranscripts([]);
      setDebugLog([]);
      setConnectionStatus('preparing-media');
      callMetaRef.current = { type: 'outgoing', logged: false, connected: false };
      ttsQueueRef.current = [];
      isTTSPlayingRef.current = false;
      await unlockTranslationAudio();
      startComfortNoise();

      const pc = await createPeerConnection(contact.userId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      socketRef.current.emit('call-user', {
        to: contact.userId,
        from: userRef.current.id,
        callerName: userRef.current.name,
        offer: pc.localDescription,
        callerLang: userRef.current.language
      });

      addDebug(`Calling ${contact.name} with live audio + translation`);
    } catch (err) {
      addDebug(`Call start failed: ${err.message}`);
      alert(`Could not start the call: ${err.message}`);
      resetCallState();
    }
  }, [addDebug, createPeerConnection, resetCallState, unlockTranslationAudio, startComfortNoise]);

  const acceptCall = useCallback(async (callData) => {
    if (!socketRef.current || !userRef.current) return;

    try {
      const remote = {
        userId: callData.from,
        name: callData.callerName,
        language: callData.callerLang
      };

      setRemoteUser(remote);
      remoteUserRef.current = remote;
      setCallState('connecting');
      setTranscripts([]);
      setDebugLog([]);
      setConnectionStatus('accepting');
      callMetaRef.current = { type: 'incoming', logged: false, connected: true };
      ttsQueueRef.current = [];
      isTTSPlayingRef.current = false;
      await unlockTranslationAudio();
      startComfortNoise();

      const pc = await createPeerConnection(callData.from);
      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
      await flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit('call-accepted', {
        to: callData.from,
        answer: pc.localDescription,
        accepterLang: userRef.current.language,
        accepterName: userRef.current.name
      });

      setCallState('in-call');
      callStateRef.current = 'in-call';
      startTimer();
      startSpeechRecognition(userRef.current.language, callData.callerLang, callData.from);
      addDebug(`Accepted call from ${callData.callerName}`);
    } catch (err) {
      addDebug(`Accept call failed: ${err.message}`);
      alert(`Could not accept the call: ${err.message}`);
      resetCallState();
    }
  }, [addDebug, createPeerConnection, flushPendingCandidates, resetCallState, startSpeechRecognition, startTimer, unlockTranslationAudio, startComfortNoise]);

  const rejectCall = useCallback((callData) => {
    if (socketRef.current) {
      socketRef.current.emit('call-rejected', { to: callData.from });
    }
    resetCallState();
  }, [resetCallState]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });
    }

    if (nextMuted) {
      stopSpeechRecognition();
    } else {
      const params = callParamsRef.current;
      if (params && callStateRef.current === 'in-call') {
        startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
      }
    }

    setIsMuted(nextMuted);
  }, [isMuted, startSpeechRecognition, stopSpeechRecognition]);

  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onCallAccepted = async ({ answer, accepterLang, accepterName }) => {
      try {
        const pc = peerConnectionRef.current;
        if (!pc) {
          addDebug('Call accepted but peer connection is missing');
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingCandidates();

        setCallState('in-call');
        callStateRef.current = 'in-call';
        startTimer();

        const currentRemote = remoteUserRef.current;
        if (currentRemote) {
          const updated = {
            ...currentRemote,
            language: accepterLang || currentRemote.language,
            name: accepterName || currentRemote.name
          };
          setRemoteUser(updated);
          remoteUserRef.current = updated;
          if (callMetaRef.current) callMetaRef.current.connected = true;

          const currentUser = userRef.current;
          startSpeechRecognition(currentUser?.language || 'en', updated.language, updated.userId);
        }

        addDebug(`Call accepted by ${accepterName || 'remote user'}`);
      } catch (err) {
        addDebug(`Failed to finish call setup: ${err.message}`);
        endCall({ notifyRemote: false });
      }
    };

    const onIceCandidate = async ({ candidate }) => {
      if (!candidate) return;
      const rtcCandidate = new RTCIceCandidate(candidate);
      const pc = peerConnectionRef.current;

      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(rtcCandidate);
        return;
      }

      try {
        await pc.addIceCandidate(rtcCandidate);
      } catch (err) {
        addDebug(`ICE candidate add failed: ${err.message}`);
      }
    };

    const onTextTranslated = ({ original, translated, toLang, audio, voiceSource }) => {
      addDebug(`Translated text received (${toLang}) via ${voiceSource || 'unknown'}${audio ? ' with audio' : ' without audio'}`);
      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        toLang,
        timestamp: Date.now()
      }]);
      queueTTS(translated, toLang, audio || null);
    };

    const onTranslationSent = ({ original, translated, voiceSource }) => {
      setTranscripts(prev => {
        const next = [...prev];
        const match = [...next].reverse().find(item => item.type === 'you' && item.text === original);
        if (match) {
          match.translated = translated;
          match.voiceSource = voiceSource;
        }
        return [...next];
      });
    };

    const onCallRejected = () => {
      addDebug('Call rejected');
      resetCallState();
    };

    const onCallEnded = () => {
      addDebug('Call ended by remote user');
      endCall({ notifyRemote: false });
    };

    const onCallFailed = ({ message }) => {
      addDebug(`Call failed: ${message}`);
      alert(message);
      resetCallState();
    };

    const onTranslationError = ({ message }) => {
      addDebug(`⚠️ Translation Error from Server: ${message}`);
    };

    socket.on('call-accepted', onCallAccepted);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('call-rejected', onCallRejected);
    socket.on('call-ended', onCallEnded);
    socket.on('text-translated', onTextTranslated);
    socket.on('translation-sent', onTranslationSent);
    socket.on('call-failed', onCallFailed);
    socket.on('translation-error', onTranslationError);

    return () => {
      socket.off('call-accepted', onCallAccepted);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('call-rejected', onCallRejected);
      socket.off('call-ended', onCallEnded);
      socket.off('text-translated', onTextTranslated);
      socket.off('translation-sent', onTranslationSent);
      socket.off('call-failed', onCallFailed);
      socket.off('translation-error', onTranslationError);
    };
  }, [addDebug, endCall, flushPendingCandidates, queueTTS, resetCallState, socket, startSpeechRecognition, startTimer]);

  useEffect(() => () => {
    cleanupPeerConnection();
    cleanupMedia();
  }, [cleanupMedia, cleanupPeerConnection]);

  useEffect(() => {
    if (callState !== 'in-call' || isMuted) {
      if (recognitionWatchdogIntervalRef.current) {
        window.clearInterval(recognitionWatchdogIntervalRef.current);
        recognitionWatchdogIntervalRef.current = null;
      }
      return undefined;
    }

    recognitionWatchdogIntervalRef.current = window.setInterval(() => {
      const params = callParamsRef.current;
      if (!params || recognitionRef.current || recognitionStartLockRef.current || isListening) return;

      addDebug('Translation watchdog restarting speech recognition');
      startSpeechRecognition(params.myLang, params.remoteLang, params.remoteId);
    }, 4000); // Increased from 2500ms to 4000ms

    return () => {
      if (recognitionWatchdogIntervalRef.current) {
        window.clearInterval(recognitionWatchdogIntervalRef.current);
        recognitionWatchdogIntervalRef.current = null;
      }
    };
  }, [addDebug, callState, isListening, isMuted, startSpeechRecognition]);

  const value = {
    callState,
    remoteUser,
    callDuration,
    transcripts,
    isMuted,
    isSpeaking,
    isListening,
    debugLog,
    localStream,
    remoteStream,
    connectionStatus,
    speechSupported,
    interimTranscript,
    callUser,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    sendTestMessage: (text) => {
      const params = callParamsRef.current;
      if (!params || !socketRef.current?.connected) {
        addDebug('Cannot send test text without an active call');
        return;
      }

      socketRef.current.emit('translate-text', {
        text,
        fromLang: params.myLang,
        toLang: params.remoteLang,
        to: params.remoteId
      });

      setTranscripts(prev => [...prev, {
        type: 'you',
        text,
        lang: params.myLang,
        timestamp: Date.now()
      }]);
    },
    setTranslationAudioElement,
    setRemoteUser,
    setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}
