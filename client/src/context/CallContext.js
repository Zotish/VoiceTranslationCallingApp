import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import * as api from '../services/api';

const CallContext = createContext();

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
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
        const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
        audio.volume = 1;
        audio.onended = finish;
        audio.onerror = () => fallbackBrowserTTS(text, lang, finish);
        audio.play().catch(() => fallbackBrowserTTS(text, lang, finish));
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
      event.streams[0].getTracks().forEach(track => {
        remoteMedia.addTrack(track);
      });
      setRemoteStream(new MediaStream(remoteMedia.getTracks()));
      setConnectionStatus('connected-media');
      addDebug('Remote audio track received');
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnectionStatus(state);
      addDebug(`Peer connection state: ${state}`);

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        setIsListening(false);
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
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startSpeechRecognition = useCallback(async (myLang, targetLang, remoteId) => {
    callParamsRef.current = { myLang, remoteLang: targetLang, remoteId };

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      addDebug('Speech recognition is not supported in this browser');
      return;
    }

    setSpeechSupported(true);

    try {
      await ensureLocalStream();
    } catch (err) {
      addDebug(`Microphone unavailable for translation: ${err.message}`);
      return;
    }

    stopSpeechRecognition();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = getLangCode(myLang);
    recognition.maxAlternatives = 1;

    processedResultsRef.current = 0;
    let restartAttempts = 0;

    recognition.onstart = () => {
      setIsListening(true);
      restartAttempts = 0;
      addDebug(`Speech recognition active: ${myLang} -> ${targetLang}`);
    };

    recognition.onresult = (event) => {
      for (let i = processedResultsRef.current; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;

        processedResultsRef.current = i + 1;
        const text = result[0]?.transcript?.trim();
        if (!text || text.length < 2) continue;

        setTranscripts(prev => [...prev, {
          type: 'you',
          text,
          lang: myLang,
          timestamp: Date.now()
        }]);

        if (socketRef.current?.connected) {
          socketRef.current.emit('translate-text', {
            text,
            fromLang: myLang,
            toLang: targetLang,
            to: remoteId
          });
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        addDebug(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);

      if (callStateRef.current === 'in-call' && !isMuted && restartAttempts < 20) {
        restartAttempts += 1;
        window.setTimeout(() => {
          if (callStateRef.current !== 'in-call' || isMuted) return;
          try {
            recognition.start();
          } catch (err) {
            addDebug(`Speech recognition restart failed: ${err.message}`);
          }
        }, 500);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      addDebug(`Speech recognition start failed: ${err.message}`);
    }
  }, [addDebug, ensureLocalStream, isMuted, stopSpeechRecognition]);

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
    window.speechSynthesis.cancel();
    ttsQueueRef.current = [];
    isTTSPlayingRef.current = false;
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
  }, [cleanupMedia, cleanupPeerConnection, stopSpeechRecognition, stopTimer]);

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
  }, [addDebug, createPeerConnection, resetCallState]);

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
  }, [addDebug, createPeerConnection, flushPendingCandidates, resetCallState, startSpeechRecognition, startTimer]);

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

    const onTextTranslated = ({ original, translated, toLang, audio }) => {
      setTranscripts(prev => [...prev, {
        type: 'remote',
        text: original,
        translated,
        toLang,
        timestamp: Date.now()
      }]);
      queueTTS(translated, toLang, audio || null);
    };

    const onTranslationSent = ({ original, translated }) => {
      setTranscripts(prev => {
        const next = [...prev];
        const match = [...next].reverse().find(item => item.type === 'you' && item.text === original);
        if (match) match.translated = translated;
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

    socket.on('call-accepted', onCallAccepted);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('call-rejected', onCallRejected);
    socket.on('call-ended', onCallEnded);
    socket.on('text-translated', onTextTranslated);
    socket.on('translation-sent', onTranslationSent);
    socket.on('call-failed', onCallFailed);

    return () => {
      socket.off('call-accepted', onCallAccepted);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('call-rejected', onCallRejected);
      socket.off('call-ended', onCallEnded);
      socket.off('text-translated', onTextTranslated);
      socket.off('translation-sent', onTranslationSent);
      socket.off('call-failed', onCallFailed);
    };
  }, [addDebug, endCall, flushPendingCandidates, queueTTS, resetCallState, socket, startSpeechRecognition, startTimer]);

  useEffect(() => () => {
    cleanupPeerConnection();
    cleanupMedia();
  }, [cleanupMedia, cleanupPeerConnection]);

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
    setRemoteUser,
    setCallState
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}
