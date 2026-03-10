import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw, Users, Globe, Play } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.apple.com:19302' },
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
  iceTransportPolicy: 'all',
};

// Helper to limit bitrate to 500kbps and prefer VP8 for max compatibility/speed
function mungeSdp(sdp) {
  let lines = sdp.split('\r\n');
  const bitrate = 500; // kbps

  // 1. Force VP8 by moving it to the front of the payload list
  let videoMLine = lines.findIndex(line => line.startsWith('m=video'));
  if (videoMLine !== -1) {
    let parts = lines[videoMLine].split(' ');
    // Look for VP8 payload type (usually 96 or 100+)
    let vp8Index = lines.findIndex(line => line.includes('a=rtpmap') && line.includes('VP8/90000'));
    if (vp8Index !== -1) {
      let payloadType = lines[vp8Index].split(':')[1].split(' ')[0];
      let payloads = parts.slice(3);
      payloads = payloads.filter(p => p !== payloadType);
      payloads.unshift(payloadType);
      parts = [...parts.slice(0, 3), ...payloads];
      lines[videoMLine] = parts.join(' ');
    }
  }

  // 2. Add bandwidth limit after each 'c=' line in video section
  let newSdp = [];
  let inVideo = false;
  for (let line of lines) {
    newSdp.push(line);
    if (line.startsWith('m=video')) inVideo = true;
    if (line.startsWith('m=audio')) inVideo = false;
    if (inVideo && line.startsWith('c=IN')) {
      newSdp.push(`b=AS:${bitrate}`);
      newSdp.push(`b=TIAS:${bitrate * 1000}`);
    }
  }
  return newSdp.join('\r\n');
}

async function getMediaStream() {
  try {
    // Reduced resolution (320x240) for MUCH faster initial relay and working on 3G/4G
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return { stream: s, mode: 'full' };
  } catch (err1) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      return { stream: s, mode: 'video-only' };
    } catch (err2) { }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream: s, mode: 'audio-only' };
    } catch (err3) { }
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
  const [onlineCount, setOnlineCount] = useState(0);
  const [connectionType, setConnectionType] = useState(null);
  const [remoteNeedsPlay, setRemoteNeedsPlay] = useState(false);

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
      setMediaError(null);
      setStatusText('Searching for peer...');
    } catch (err) {
      setMediaError('Media blocked. Using text-only.');
      setStatusText('Searching (No Camera)...');
      setStream({ getTracks: () => [] });
    }
  }, []);

  useEffect(() => { initMedia(); }, [initMedia]);

  useEffect(() => {
    if (myVideo.current && stream && stream.getVideoTracks().length > 0) {
      myVideo.current.srcObject = stream;
      myVideo.current.play().catch(() => { });
    }
  }, [stream]);

  const playRemoteStream = useCallback(() => {
    if (remoteVideo.current && remoteStream) {
      remoteVideo.current.play()
        .then(() => setRemoteNeedsPlay(false))
        .catch(e => console.error("Play failed:", e));
    }
  }, [remoteStream]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) {
      remoteVideo.current.srcObject = remoteStream;
      remoteVideo.current.play()
        .then(() => setRemoteNeedsPlay(false))
        .catch(() => setRemoteNeedsPlay(true)); // Browser blocked auto-play
    } else if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
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
        pcRef.current.close();
        pcRef.current = null;
      }
      setConnectionType(null);
      setRemoteNeedsPlay(false);
    }

    function resetToLobby() {
      cleanup();
      isMatchedRef.current = false; isRequestingRef.current = false; peerIdRef.current = null;
      iceQueueRef.current = []; setIsMatched(false); setRemoteStream(null);
      setIsGaming(false); setPeerId(null); setMessages([]);
      setStatusText('Searching for peer...');
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
      channel.track({ isReady: false, partnerId, joinedAt: Date.now() });

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const s = streamRef.current;
      if (s && s.getTracks) s.getTracks().forEach(t => pc.addTrack(t, s));

      pc.ontrack = (e) => {
        if (e.streams?.[0]) setRemoteStream(e.streams[0]);
        setStatusText('Global Bridge Active');
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          if (e.candidate.candidate.includes('relay')) setConnectionType('Relay Bridge');
          else if (!connectionType) setConnectionType('Direct (P2P)');
          channel.send({ type: 'broadcast', event: 'webrtc_ice', payload: { to: partnerId, from: myId, candidate: e.candidate.toJSON() } });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatusText('Securely Connected');
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
          setTimeout(() => { if (pc.iceConnectionState === 'failed') resetToLobby(); }, 10000);
        }
      };

      timeoutRef.current = setTimeout(() => { if (pc.connectionState !== 'connected') resetToLobby(); }, 25000);

      if (isInit) {
        setTimeout(async () => {
          try {
            const offer = await pc.createOffer();
            const mungedOffer = mungeSdp(offer.sdp);
            await pc.setLocalDescription({ type: 'offer', sdp: mungedOffer });
            channel.send({ type: 'broadcast', event: 'webrtc_offer', payload: { to: partnerId, from: myId, offer: pc.localDescription.toJSON() } });
          } catch (err) { resetToLobby(); }
        }, 800);
      }
    }

    function attemptMatch(state) {
      if (isMatchedRef.current || isRequestingRef.current) return;
      const allIds = Object.keys(state);
      setOnlineCount(allIds.length);
      const available = allIds.filter(id => id !== myId && state[id].some(p => p.isReady && !p.partnerId))
        .map(id => ({ id, joinedAt: state[id][0].joinedAt || 0 })).sort((a, b) => a.joinedAt - b.joinedAt);

      if (available.length === 0) {
        setStatusText(allIds.length <= 1 ? 'Waiting (you are alone)...' : `Searching among ${allIds.length} users...`);
        return;
      }
      const partner = available.slice(0, 3)[Math.floor(Math.random() * Math.min(available.length, 3))];
      isRequestingRef.current = partner.id;
      channel.send({ type: 'broadcast', event: 'match_request', payload: { from: myId, to: partner.id } });
      setTimeout(() => { if (!isMatchedRef.current && isRequestingRef.current === partner.id) { isRequestingRef.current = false; attemptMatch(channel.presenceState()); } }, 7000);
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineCount(Object.keys(state).length);
        attemptMatch(state);
      })
      .on('broadcast', { event: 'match_request' }, ({ payload }) => {
        if (payload.to !== myId || isMatchedRef.current) { if (payload.to === myId) channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } }); return; }
        if (isRequestingRef.current && (isRequestingRef.current !== payload.from || myId < payload.from)) return;
        isMatchedRef.current = true; isRequestingRef.current = false;
        channel.send({ type: 'broadcast', event: 'match_accept', payload: { from: myId, to: payload.from } });
        setupPC(payload.from, false);
      })
      .on('broadcast', { event: 'match_accept' }, ({ payload }) => { if (payload.to === myId && payload.from === isRequestingRef.current && !isMatchedRef.current) { isMatchedRef.current = true; isRequestingRef.current = false; setupPC(payload.from, true); } })
      .on('broadcast', { event: 'match_reject' }, ({ payload }) => { if (payload.to === myId && isRequestingRef.current === payload.from) { isRequestingRef.current = false; attemptMatch(channel.presenceState()); } })
      .on('broadcast', { event: 'webrtc_offer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await pcRef.current.createAnswer();
          const mungedAnswer = mungeSdp(answer.sdp);
          await pcRef.current.setLocalDescription({ type: 'answer', sdp: mungedAnswer });
          channel.send({ type: 'broadcast', event: 'webrtc_answer', payload: { from: myId, to: payload.from, answer: pcRef.current.localDescription.toJSON() } });
          for (const c of iceQueueRef.current) try { await pcRef.current.addIceCandidate(c); } catch (e) { }
          iceQueueRef.current = [];
        } catch (err) { }
      })
      .on('broadcast', { event: 'webrtc_answer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
          for (const c of iceQueueRef.current) try { await pcRef.current.addIceCandidate(c); } catch (e) { }
          iceQueueRef.current = [];
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
      .on('broadcast', { event: 'disconnect' }, ({ payload }) => { if (payload.to === myId) resetToLobby(); })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => channel.subscribe(), 2000);
      });

    matchIntervalRef.current = setInterval(() => { if (!isMatchedRef.current && !isRequestingRef.current) attemptMatch(channel.presenceState()); }, 4000);
    return () => { cleanup(); clearInterval(matchIntervalRef.current); channel.unsubscribe(); };
  }, [stream]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId) {
      channelRef.current.send({ type: 'broadcast', event: 'chat', payload: { to: peerId, message: inputText } });
      setMessages(prev => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  return (
    <div className="app">
      <div className="status-badge">
        <div className={isMatched ? '' : 'pulse'}></div>
        {statusText}
        {!isMatched && <span className="online-count"><Users size={12} style={{ marginLeft: 8, marginRight: 4 }} />{onlineCount} online</span>}
        {isMatched && connectionType && <span className="connection-pill"><Globe size={10} style={{ marginRight: 4 }} />{connectionType}</span>}
      </div>

      <div className="video-container">
        <div className="video-wrapper glass">
          <video playsInline muted ref={myVideo} autoPlay />
          <div className="video-label">You</div>
          {!videoEnabled && <div className="video-off-overlay"><VideoOff size={48} color="rgba(255,255,255,0.1)" /></div>}
          {mediaError && <div className="video-off-overlay"><button className="btn btn-primary btn-sm" onClick={initMedia}><RefreshCw size={14} /> Retry Cam</button></div>}
        </div>
        <div className="video-wrapper glass">
          <video playsInline ref={remoteVideo} autoPlay />
          {!remoteStream && <div className="video-placeholder">{isMatched ? 'Opening Secure Tunnel...' : 'Waiting for a stranger...'}</div>}
          {remoteNeedsPlay && (
            <div className="video-off-overlay" onClick={playRemoteStream} style={{ background: 'rgba(0,0,0,0.8)', cursor: 'pointer' }}>
              <button className="btn btn-primary"><Play size={20} /> Tap to Start Video</button>
            </div>
          )}
          <div className="video-label">Stranger</div>
        </div>
      </div>

      <div className="chat-panel glass">
        <div className="chat-messages">
          {messages.length === 0 && !isMatched && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}><Info size={24} style={{ marginBottom: '8px' }} /><p>Match with anyone!</p></div>}
          {messages.map((msg, i) => <div key={i} className={`message ${msg.sent ? 'sent' : 'received'}`}>{msg.text}</div>)}
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input type="text" placeholder={isMatched ? "Say hi..." : "Waiting..."} value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={!isMatched} />
          <button type="submit" className="btn btn-primary" style={{ padding: '8px' }} disabled={!isMatched}><MessageCircle size={18} /></button>
        </form>
      </div>

      <div className="game-panel glass">
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.8rem' }}>GLOBAL BRIDGE ACTIVE</h4>
        <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={isMatched ? () => setIsGaming(true) : undefined} disabled={!isMatched}><Gamepad2 size={16} /> Play Game</button>
      </div>

      {isGaming && <TicTacToe channel={channelRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setIsGaming(false)} />}

      <div className="controls glass">
        <button className={`btn ${audioEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { if (stream?.getAudioTracks) { stream.getAudioTracks()[0].enabled = !audioEnabled; setAudioEnabled(!audioEnabled); } }} style={{ padding: '12px' }}>{audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className={`btn ${videoEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { if (stream?.getVideoTracks) { stream.getVideoTracks()[0].enabled = !videoEnabled; setVideoEnabled(!videoEnabled); } }} style={{ padding: '12px' }}>{videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button>
        <button className="btn btn-primary" onClick={() => window.__handleNext?.()} style={{ background: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)', padding: '12px 24px' }}><SkipForward size={20} /> Next</button>
      </div>
    </div>
  );
}

export default App;
