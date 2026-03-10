import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw, Users, Globe } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

// GLOBAL ENTERPRISE-GRADE RELAY (OpenRelay)
// This configuration is specifically designed to bridge connections across different ISPs, countries, and NAT types (e.g., Cellular to WiFi).
const ICE_SERVERS = {
  iceServers: [
    // Standard Global STUN Servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.apple.com:19302' },

    // Enterprise TURN Relay (via OpenRelay community credentials)
    // These servers act as a universal bridge when direct P2P connection fails.
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: [
        'turns:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all', // Ensure all types (host, srflx, and relay) are allowed
};

async function getMediaStream() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return { stream: s, mode: 'full' };
  } catch (err1) {
    if (err1.name === 'NotReadableError' || err1.name === 'AbortError') {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        return { stream: s, mode: 'full' };
      } catch (err2) { }
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      return { stream: s, mode: 'video-only' };
    } catch (err3) { }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream: s, mode: 'audio-only' };
    } catch (err4) { }
    throw err1;
  }
}

function App() {
  const [stream, setStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isMatched, setIsMatched] = useState(false);
  const [peerId, setPeerId] = useState(null);
  const [isGaming, setIsGaming] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [statusText, setStatusText] = useState('Initializing...');
  const [mediaError, setMediaError] = useState(null);
  const [mediaMode, setMediaMode] = useState('full');
  const [onlineCount, setOnlineCount] = useState(0);
  const [connectionType, setConnectionType] = useState(null); // 'P2P' or 'Relay'

  const myIdRef = useRef(Math.random().toString(36).substring(7));
  const myId = myIdRef.current;

  const myVideo = useRef(null);
  const remoteVideo = useRef(null);
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const iceQueueRef = useRef([]);
  const timeoutRef = useRef(null);
  const disconnectGraceRef = useRef(null);
  const matchIntervalRef = useRef(null);

  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const peerIdRef = useRef(null);

  useEffect(() => { streamRef.current = stream; }, [stream]);

  const initMedia = useCallback(async () => {
    setMediaError(null);
    setStatusText('Allow Camera/Mic access...');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      setStream(null);
      await new Promise(r => setTimeout(r, 500));
    }
    try {
      const result = await getMediaStream();
      setStream(result.stream);
      setMediaMode(result.mode);
      setMediaError(null);
      if (result.mode === 'video-only') { setStatusText('Searching... (no mic)'); setAudioEnabled(false); }
      else if (result.mode === 'audio-only') { setStatusText('Searching... (no camera)'); setVideoEnabled(false); }
      else { setStatusText('Searching for peer...'); }
    } catch (err) {
      let errorMsg = 'Camera/mic error. ';
      if (err.name === 'NotAllowedError') errorMsg = 'Camera/mic blocked. ';
      else if (err.name === 'NotFoundError') errorMsg = 'No camera found. ';
      else if (err.name === 'NotReadableError') errorMsg = 'Camera in use. ';
      setMediaError(errorMsg);
      setStatusText(errorMsg);
      setStream({ getTracks: () => [] });
    }
  }, []);

  useEffect(() => { initMedia(); }, [initMedia]);

  useEffect(() => {
    if (myVideo.current && stream && stream.getVideoTracks().length > 0) {
      const el = myVideo.current;
      el.srcObject = stream;
      const playT = setTimeout(() => el.play().catch(() => { }), 100);
      return () => clearTimeout(playT);
    }
  }, [stream]);

  useEffect(() => {
    const el = remoteVideo.current;
    if (!el) return;
    if (remoteStream) {
      el.srcObject = remoteStream;
      const playR = () => el.play().catch(() => setTimeout(() => el.play().catch(() => { }), 300));
      el.onloadedmetadata = playR;
      setTimeout(playR, 200);
    } else { el.srcObject = null; }
  }, [remoteStream]);

  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    function cleanup() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
      if (pcRef.current) {
        pcRef.current.ontrack = null; pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null; pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.close(); pcRef.current = null;
      }
      setConnectionType(null);
    }

    function resetToLobby() {
      cleanup();
      isMatchedRef.current = false; isRequestingRef.current = false; peerIdRef.current = null;
      iceQueueRef.current = []; setIsMatched(false); setRemoteStream(null);
      setIsGaming(false); setPeerId(null); setMessages([]);
      setStatusText('Searching for peer...');
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
      setTimeout(() => attemptMatch(channel.presenceState()), 500);
    }

    function handleNext() {
      if (peerIdRef.current) channel.send({ type: 'broadcast', event: 'disconnect', payload: { to: peerIdRef.current } });
      resetToLobby();
    }
    window.__handleNext = handleNext;

    function setupPC(partnerId, isInit) {
      setIsMatched(true); setPeerId(partnerId); peerIdRef.current = partnerId;
      setIsInitiator(isInit); setStatusText('Bridging networks...');
      iceQueueRef.current = [];
      channel.track({ isReady: false, partnerId, joinedAt: Date.now() });

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const s = streamRef.current;
      if (s && s.getTracks) s.getTracks().forEach(t => pc.addTrack(t, s));

      pc.ontrack = (e) => {
        if (e.streams?.[0]) {
          setRemoteStream(e.streams[0]);
          if (remoteVideo.current) {
            remoteVideo.current.srcObject = e.streams[0];
            setTimeout(() => remoteVideo.current?.play().catch(() => { }), 200);
          }
        }
        setStatusText('Global Connection Established');
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          // Diagnostic logging to see if relay is working
          if (e.candidate.candidate.includes('relay')) {
            console.log('[WebRTC] RELAY candidate generated - Bridge active.');
            setConnectionType('Relay Bridge');
          } else if (e.candidate.candidate.includes('srflx')) {
            if (!connectionType) setConnectionType('Direct (NAT)');
          }

          channel.send({
            type: 'broadcast',
            event: 'webrtc_ice',
            payload: { to: partnerId, from: myId, candidate: e.candidate.toJSON() }
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("[WebRTC] ICE state:", state);
        if (state === 'connected' || state === 'completed') {
          if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
          setStatusText('Securely Connected');
        }
        if (state === 'disconnected') {
          setStatusText('Signal weak, retrying...');
          if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
          disconnectGraceRef.current = setTimeout(() => {
            if (pcRef.current?.iceConnectionState === 'disconnected') try { pcRef.current.restartIce(); } catch (e) { resetToLobby(); }
          }, 5000);
        }
        if (state === 'failed') {
          try { pc.restartIce(); setStatusText('Relaying connection...'); setTimeout(() => { if (pcRef.current === pc && pc.iceConnectionState === 'failed') resetToLobby(); }, 8000); }
          catch (e) { resetToLobby(); }
        }
      };

      timeoutRef.current = setTimeout(() => { if (pc === pcRef.current && pc.connectionState !== 'connected') resetToLobby(); }, 25000);

      if (isInit) {
        setTimeout(async () => {
          try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            channel.send({ type: 'broadcast', event: 'webrtc_offer', payload: { to: partnerId, from: myId, offer: pc.localDescription.toJSON() } });
          } catch (err) { resetToLobby(); }
        }, 800);
      }
    }

    function attemptMatch(state) {
      if (isMatchedRef.current || isRequestingRef.current) return;

      const allIds = Object.keys(state);
      setOnlineCount(allIds.length);

      const available = allIds
        .filter(id => {
          const presences = state[id];
          if (id === myId || !presences) return false;
          return presences.some(p => p.isReady && !p.partnerId);
        })
        .map(id => ({ id, joinedAt: state[id][0].joinedAt || 0 }))
        .sort((a, b) => a.joinedAt - b.joinedAt);

      if (available.length === 0) {
        if (allIds.length <= 1) setStatusText('Waiting (only you online)...');
        else setStatusText(`Searching among ${allIds.length} users...`);
        return;
      }

      const topFew = available.slice(0, 3);
      const partner = topFew[Math.floor(Math.random() * topFew.length)];

      isRequestingRef.current = partner.id;
      channel.send({ type: 'broadcast', event: 'match_request', payload: { from: myId, to: partner.id } });

      setTimeout(() => {
        if (!isMatchedRef.current && isRequestingRef.current === partner.id) {
          isRequestingRef.current = false;
          attemptMatch(channel.presenceState());
        }
      }, 7000);
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineCount(Object.keys(state).length);
        attemptMatch(state);
      })
      .on('broadcast', { event: 'match_request' }, ({ payload }) => {
        if (payload.to !== myId) return;
        if (isMatchedRef.current) { channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } }); return; }
        if (isRequestingRef.current) {
          if (isRequestingRef.current === payload.from) { if (myId < payload.from) return; isRequestingRef.current = false; }
          else { channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } }); return; }
        }
        isMatchedRef.current = true; isRequestingRef.current = false;
        channel.send({ type: 'broadcast', event: 'match_accept', payload: { from: myId, to: payload.from } });
        setupPC(payload.from, false);
      })
      .on('broadcast', { event: 'match_accept' }, ({ payload }) => {
        if (payload.to !== myId || payload.from !== isRequestingRef.current || isMatchedRef.current) return;
        isMatchedRef.current = true; isRequestingRef.current = false;
        setupPC(payload.from, true);
      })
      .on('broadcast', { event: 'match_reject' }, ({ payload }) => {
        if (payload.to !== myId || isMatchedRef.current) return;
        if (isRequestingRef.current === payload.from) { isRequestingRef.current = false; attemptMatch(channel.presenceState()); }
      })
      .on('broadcast', { event: 'webrtc_offer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          channel.send({ type: 'broadcast', event: 'webrtc_answer', payload: { from: myId, to: payload.from, answer: pcRef.current.localDescription.toJSON() } });
          const q = [...iceQueueRef.current]; iceQueueRef.current = [];
          for (const c of q) try { await pcRef.current.addIceCandidate(c); } catch (e) { }
        } catch (err) { }
      })
      .on('broadcast', { event: 'webrtc_answer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
          const q = [...iceQueueRef.current]; iceQueueRef.current = [];
          for (const c of q) try { await pcRef.current.addIceCandidate(c); } catch (e) { }
        } catch (err) { }
      })
      .on('broadcast', { event: 'webrtc_ice' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          const c = new RTCIceCandidate(payload.candidate);
          if (pcRef.current.remoteDescription?.type) await pcRef.current.addIceCandidate(c);
          else iceQueueRef.current.push(c);
        } catch (err) { }
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => { if (payload.to === myId) setMessages(prev => [...prev, { text: payload.message, sent: false }]); })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => channel.subscribe(), 2000);
      });

    matchIntervalRef.current = setInterval(() => {
      if (!isMatchedRef.current && !isRequestingRef.current) {
        attemptMatch(channel.presenceState());
      }
    }, 4000);

    return () => {
      cleanup();
      if (matchIntervalRef.current) clearInterval(matchIntervalRef.current);
      channel.unsubscribe();
      window.__handleNext = null;
    };
  }, [stream]);

  const onClickNext = () => { if (window.__handleNext) window.__handleNext(); };
  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId && channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'chat', payload: { to: peerId, message: inputText } });
      setMessages(prev => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };
  const toggleVideo = () => { if (stream?.getVideoTracks) { const t = stream.getVideoTracks()[0]; if (t) { t.enabled = !videoEnabled; setVideoEnabled(!videoEnabled); } } };
  const toggleAudio = () => { if (stream?.getAudioTracks) { const t = stream.getAudioTracks()[0]; if (t) { t.enabled = !audioEnabled; setAudioEnabled(!audioEnabled); } } };

  return (
    <div className="app">
      <div className="status-badge">
        <div className={isMatched ? '' : 'pulse'}></div>
        {statusText}
        {!isMatched && (
          <span className="online-count">
            <Users size={12} style={{ marginLeft: 8, marginRight: 4 }} />
            {onlineCount} online
          </span>
        )}
        {isMatched && connectionType && (
          <span className="connection-pill">
            <Globe size={10} style={{ marginRight: 4 }} />
            {connectionType}
          </span>
        )}
      </div>

      <div className="video-container">
        <div className="video-wrapper glass">
          <video playsInline muted ref={myVideo} autoPlay />
          <div className="video-label">You</div>
          {!videoEnabled && <div className="video-off-overlay"><VideoOff size={48} color="rgba(255,255,255,0.1)" /></div>}
          {mediaError && (
            <div className="video-off-overlay" style={{ flexDirection: 'column', gap: 12 }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', textAlign: 'center', padding: '0 20px' }}>{mediaError}</p>
              <button className="btn btn-primary" onClick={initMedia} style={{ fontSize: '0.8rem', padding: '8px 16px' }}><RefreshCw size={16} /> Retry Camera</button>
            </div>
          )}
        </div>
        <div className="video-wrapper glass">
          <video playsInline ref={remoteVideo} autoPlay style={{ display: remoteStream ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }} />
          {!remoteStream && <div className="video-placeholder">{isMatched ? 'Establishing Secure Tunnel...' : 'Universal Matching Active...'}</div>}
          <div className="video-label">Stranger</div>
        </div>
      </div>

      <div className="chat-panel glass">
        <div className="chat-messages">
          {messages.length === 0 && !isMatched && (
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}><Info size={24} style={{ marginBottom: '8px' }} /><p>Match with anyone, anywhere!</p></div>
          )}
          {messages.map((msg, i) => <div key={i} className={`message ${msg.sent ? 'sent' : 'received'}`}>{msg.text}</div>)}
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input type="text" placeholder={isMatched ? "Type a message..." : "Waiting..."} value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={!isMatched} />
          <button type="submit" className="btn btn-primary" style={{ padding: '8px' }} disabled={!isMatched}><MessageCircle size={18} /></button>
        </form>
      </div>

      <div className="game-panel glass">
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Global Lobby</h4>
        <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '10px' }}>All networks/countries allowed</div>
        <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }} onClick={isMatched ? () => setIsGaming(true) : undefined} disabled={!isMatched}><Gamepad2 size={16} /> Tic Tac Toe</button>
      </div>

      {isGaming && isMatched && <TicTacToe channel={channelRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setIsGaming(false)} />}

      <div className="controls glass">
        <button className={`btn ${audioEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={toggleAudio}>{audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className={`btn ${videoEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={toggleVideo}>{videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button>
        <button className="btn btn-primary" onClick={onClickNext} style={{ background: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)' }}><SkipForward size={20} /> Next</button>
      </div>
    </div>
  );
}

export default App;
