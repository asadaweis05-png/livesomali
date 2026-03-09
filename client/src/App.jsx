import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

// Reliable Google STUN servers for NAT traversal
// NOTE: For cross-network mobile connections, add real TURN server credentials
// Get free ones at: https://dashboard.metered.ca/signup?tool=turnserver
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

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

  // Stable ID that never changes
  const myIdRef = useRef(Math.random().toString(36).substring(7));
  const myId = myIdRef.current;

  // Refs for DOM and WebRTC
  const myVideo = useRef(null);
  const remoteVideo = useRef(null);
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const iceQueueRef = useRef([]);
  const timeoutRef = useRef(null);

  // State refs (accessible from closures without stale values)
  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const peerIdRef = useRef(null);

  // Keep stream ref in sync
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // 1. Get camera/mic
  useEffect(() => {
    setStatusText('Allow Camera/Mic access...');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => { setStream(s); setStatusText('Searching for peer...'); })
      .catch(err => {
        console.error("Camera error:", err);
        setStatusText('Error: Please allow camera/mic access.');
      });
  }, []);

  // 2. Bind local video
  useEffect(() => {
    if (myVideo.current && stream) {
      myVideo.current.srcObject = stream;
      myVideo.current.onloadedmetadata = () => myVideo.current.play().catch(() => { });
    }
  }, [stream]);

  // 3. Bind remote video
  useEffect(() => {
    const el = remoteVideo.current;
    if (!el) return;
    if (remoteStream) {
      el.srcObject = remoteStream;
      el.onloadedmetadata = () => el.play().catch(() => { });
      el.play().catch(() => { });
    } else {
      el.srcObject = null;
    }
  }, [remoteStream]);

  // ============================================================
  // 4. MAIN EFFECT: Channel + Matchmaking + Signaling
  //    ALL logic lives inside this single useEffect so there
  //    are ZERO closure/scope issues. Nothing is useCallback.
  // ============================================================
  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    // ---- Helper: cleanup current WebRTC connection ----
    function cleanup() {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (pcRef.current) {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.close();
        pcRef.current = null;
      }
    }

    // ---- Helper: reset to lobby state ----
    function resetToLobby() {
      cleanup();
      isMatchedRef.current = false;
      isRequestingRef.current = false;
      peerIdRef.current = null;
      iceQueueRef.current = [];
      setIsMatched(false);
      setRemoteStream(null);
      setIsGaming(false);
      setPeerId(null);
      setMessages([]);
      setStatusText('Searching for peer...');
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
      // After resetting, try to match again
      setTimeout(() => attemptMatch(channel.presenceState()), 500);
    }

    // ---- Helper: skip / next ----
    function handleNext() {
      if (peerIdRef.current) {
        channel.send({ type: 'broadcast', event: 'disconnect', payload: { to: peerIdRef.current } });
      }
      resetToLobby();
    }
    // Expose handleNext for the button
    window.__handleNext = handleNext;

    // ---- Helper: create WebRTC peer connection ----
    function setupPC(partnerId, isInit) {
      console.log(`[WebRTC] Setup. Initiator=${isInit}, Partner=${partnerId}`);
      setIsMatched(true);
      setPeerId(partnerId);
      peerIdRef.current = partnerId;
      setIsInitiator(isInit);
      setStatusText('Found match! Connecting...');
      iceQueueRef.current = [];

      channel.track({ isReady: false, partnerId, joinedAt: Date.now() });

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Add local tracks
      const s = streamRef.current;
      if (s) s.getTracks().forEach(t => pc.addTrack(t, s));

      // Receive remote tracks
      pc.ontrack = (e) => {
        console.log("[WebRTC] Got remote track:", e.track.kind);
        if (e.streams?.[0]) setRemoteStream(e.streams[0]);
        setStatusText('Matched & Connected');
      };

      // Send ICE candidates
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channel.send({
            type: 'broadcast', event: 'webrtc_ice',
            payload: { to: partnerId, from: myId, candidate: e.candidate.toJSON() }
          });
        }
      };

      // Only drop on permanent failure
      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') resetToLobby();
      };

      // Connection timeout: 15s
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (pc === pcRef.current && pc.connectionState !== 'connected') {
          console.log("[WebRTC] Timed out after 15s");
          resetToLobby();
        }
      }, 15000);

      pc.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", pc.connectionState);
        if (pc.connectionState === 'connected') {
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        }
        if (pc.connectionState === 'failed') {
          console.log("[WebRTC] Connection failed");
          resetToLobby();
        }
      };

      // Initiator creates offer after a small delay (wait for receiver to be ready)
      if (isInit) {
        setTimeout(async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({
              type: 'broadcast', event: 'webrtc_offer',
              payload: { to: partnerId, from: myId, offer: pc.localDescription.toJSON() }
            });
            console.log("[Signal] Offer sent");
          } catch (err) {
            console.error("[Signal] Offer error:", err);
            resetToLobby();
          }
        }, 500);
      }
    }

    // ---- Matchmaking ----
    function attemptMatch(state) {
      if (isMatchedRef.current || isRequestingRef.current) return;
      const available = Object.keys(state).filter(id => {
        const p = state[id]?.[0];
        return id !== myId && p?.isReady && !p?.partnerId;
      });
      if (available.length === 0) return;

      const partnerId = available[Math.floor(Math.random() * available.length)];
      console.log("[Match] Requesting:", partnerId);
      isRequestingRef.current = partnerId;
      channel.send({ type: 'broadcast', event: 'match_request', payload: { from: myId, to: partnerId } });

      setTimeout(() => {
        if (!isMatchedRef.current && isRequestingRef.current === partnerId) {
          console.log("[Match] Request timed out");
          isRequestingRef.current = false;
          attemptMatch(channel.presenceState());
        }
      }, 5000);
    }

    // ---- Channel listeners ----
    channel
      .on('presence', { event: 'sync' }, () => attemptMatch(channel.presenceState()))

      .on('broadcast', { event: 'match_request' }, ({ payload }) => {
        if (payload.to !== myId) return;
        if (isMatchedRef.current) {
          channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
          return;
        }
        if (isRequestingRef.current) {
          if (isRequestingRef.current === payload.from) {
            // Crossed requests: lower ID is initiator
            if (myId < payload.from) return; // wait for their accept
            isRequestingRef.current = false; // yield
          } else {
            channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
            return;
          }
        }
        console.log("[Match] Accepting:", payload.from);
        isMatchedRef.current = true;
        isRequestingRef.current = false;
        // CRITICAL: Tell the sender we accepted so they create their offer
        channel.send({ type: 'broadcast', event: 'match_accept', payload: { from: myId, to: payload.from } });
        setupPC(payload.from, false);
      })

      .on('broadcast', { event: 'match_accept' }, ({ payload }) => {
        if (payload.to !== myId || payload.from !== isRequestingRef.current || isMatchedRef.current) return;
        console.log("[Match] Accepted by:", payload.from);
        isMatchedRef.current = true;
        isRequestingRef.current = false;
        setupPC(payload.from, true);
      })

      .on('broadcast', { event: 'match_reject' }, ({ payload }) => {
        if (payload.to !== myId || isMatchedRef.current) return;
        if (isRequestingRef.current === payload.from) {
          console.log("[Match] Rejected by:", payload.from);
          isRequestingRef.current = false;
          attemptMatch(channel.presenceState());
        }
      })

      // ---- WebRTC Signaling ----
      .on('broadcast', { event: 'webrtc_offer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        console.log("[Signal] Got offer");
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          channel.send({
            type: 'broadcast', event: 'webrtc_answer',
            payload: { from: myId, to: payload.from, answer: pcRef.current.localDescription.toJSON() }
          });
          console.log("[Signal] Answer sent");
          // Flush ICE queue
          const q = [...iceQueueRef.current]; iceQueueRef.current = [];
          for (const c of q) { try { await pcRef.current.addIceCandidate(c); } catch (e) { } }
        } catch (err) { console.error("[Signal] Offer handling error:", err); }
      })

      .on('broadcast', { event: 'webrtc_answer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        console.log("[Signal] Got answer");
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
          const q = [...iceQueueRef.current]; iceQueueRef.current = [];
          for (const c of q) { try { await pcRef.current.addIceCandidate(c); } catch (e) { } }
        } catch (err) { console.error("[Signal] Answer handling error:", err); }
      })

      .on('broadcast', { event: 'webrtc_ice' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current || !pcRef.current) return;
        try {
          const c = new RTCIceCandidate(payload.candidate);
          if (pcRef.current.remoteDescription?.type) {
            await pcRef.current.addIceCandidate(c);
          } else {
            iceQueueRef.current.push(c);
          }
        } catch (err) { console.error("[Signal] ICE error:", err); }
      })

      // ---- Chat, Game, Disconnect ----
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload.to === myId) setMessages(prev => [...prev, { text: payload.message, sent: false }]);
      })
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        if (payload.to === myId && payload.type === 'start_game') setIsGaming(true);
      })
      .on('broadcast', { event: 'disconnect' }, ({ payload }) => {
        if (payload.to === myId) resetToLobby();
      })
      .subscribe(async (status) => {
        console.log("[Supabase] Channel status:", status);
        if (status === 'SUBSCRIBED') {
          await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
          console.log("[Supabase] Tracking presence. My ID:", myId);
        }
      });

    return () => {
      cleanup();
      channel.unsubscribe();
      window.__handleNext = null;
    };
  }, [stream]); // Only re-run when stream changes (once)

  // ---- UI event handlers (use window.__handleNext to avoid scope issues) ----
  const onClickNext = () => {
    if (window.__handleNext) window.__handleNext();
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast', event: 'chat',
        payload: { to: peerId, message: inputText }
      });
      setMessages(prev => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  const startGame = () => {
    if (isMatched && peerId && channelRef.current) {
      setIsGaming(true);
      channelRef.current.send({
        type: 'broadcast', event: 'game',
        payload: { to: peerId, type: 'start_game' }
      });
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const t = stream.getVideoTracks()[0];
      if (t) { t.enabled = !videoEnabled; setVideoEnabled(!videoEnabled); }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const t = stream.getAudioTracks()[0];
      if (t) { t.enabled = !audioEnabled; setAudioEnabled(!audioEnabled); }
    }
  };

  return (
    <div className="app">
      <div className="status-badge">
        <div className={isMatched ? '' : 'pulse'}></div>
        {statusText}
      </div>

      <div className="video-container">
        <div className="video-wrapper glass">
          <video playsInline muted ref={myVideo} autoPlay />
          <div className="video-label">You</div>
          {!videoEnabled && (
            <div className="video-off-overlay">
              <VideoOff size={48} color="rgba(255,255,255,0.1)" />
            </div>
          )}
        </div>
        <div className="video-wrapper glass">
          <video
            playsInline
            ref={remoteVideo}
            autoPlay
            style={{ display: remoteStream ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {!remoteStream && (
            <div className="video-placeholder">
              {isMatched ? 'Establishing Secure Connection...' : 'Waiting for a stranger to join...'}
            </div>
          )}
          <div className="video-label">Stranger</div>
        </div>
      </div>

      <div className="chat-panel glass">
        <div className="chat-messages">
          {messages.length === 0 && !isMatched && (
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
              <Info size={24} style={{ marginBottom: '8px' }} />
              <p>Match with someone to start chatting!</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.sent ? 'sent' : 'received'}`}>
              {msg.text}
            </div>
          ))}
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input
            type="text"
            placeholder={isMatched ? "Type a message..." : "Waiting..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={!isMatched}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '8px' }} disabled={!isMatched}>
            <MessageCircle size={18} />
          </button>
        </form>
      </div>

      <div className="game-panel glass">
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Live Games</h4>
        <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }} onClick={isMatched ? startGame : undefined} disabled={!isMatched}>
          <Gamepad2 size={16} /> Tic Tac Toe
        </button>
      </div>

      {isGaming && isMatched && (
        <TicTacToe
          channel={channelRef.current}
          peerId={peerId}
          isInitiator={isInitiator}
          onDispose={() => setIsGaming(false)}
        />
      )}

      <div className="controls glass">
        <button className={`btn ${audioEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={toggleAudio}>
          {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
        <button className={`btn ${videoEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={toggleVideo}>
          {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        <button className="btn btn-primary" onClick={onClickNext} style={{ background: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)' }}>
          <SkipForward size={20} /> Next
        </button>
      </div>
    </div>
  );
}

export default App;
