import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

// STUN + TURN servers for reliable NAT traversal across all networks & countries
// TURN servers act as relay when direct P2P fails (mobile data, symmetric NATs, firewalls)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Free Metered TURN relay servers — works across all networks/countries
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65b092de10874e403307',
      credential: '5d9M0e/EfiCfGxRr',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b092de10874e403307',
      credential: '5d9M0e/EfiCfGxRr',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65b092de10874e403307',
      credential: '5d9M0e/EfiCfGxRr',
    },
    {
      urls: 'turns:a.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65b092de10874e403307',
      credential: '5d9M0e/EfiCfGxRr',
    },
  ],
  iceCandidatePoolSize: 10,
};

// Robust camera/mic initialization with retry and fallback
async function getMediaStream() {
  // Helper to stop all tracks on a stream
  const stopTracks = (s) => { if (s) s.getTracks().forEach(t => t.stop()); };

  // Attempt 1: Video + Audio
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return { stream: s, mode: 'full' };
  } catch (err1) {
    console.warn('[Media] Full media failed:', err1.name, err1.message);

    // If device is in use, wait and retry once
    if (err1.name === 'NotReadableError' || err1.name === 'AbortError') {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        return { stream: s, mode: 'full' };
      } catch (err2) {
        console.warn('[Media] Retry full failed:', err2.name);
      }
    }

    // Attempt 2: Video only (mic might be blocked)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      return { stream: s, mode: 'video-only' };
    } catch (err3) {
      console.warn('[Media] Video-only failed:', err3.name);
    }

    // Attempt 3: Audio only (camera might be blocked/missing)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream: s, mode: 'audio-only' };
    } catch (err4) {
      console.warn('[Media] Audio-only failed:', err4.name);
    }

    // All attempts failed
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
  const [mediaMode, setMediaMode] = useState('full'); // 'full' | 'video-only' | 'audio-only'

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
  const disconnectGraceRef = useRef(null);

  // State refs (accessible from closures without stale values)
  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const peerIdRef = useRef(null);

  // Keep stream ref in sync
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // 1. Get camera/mic with robust retry and fallback
  const initMedia = useCallback(async () => {
    setMediaError(null);
    setStatusText('Allow Camera/Mic access...');

    // Stop any existing tracks first to release the camera lock
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      setStream(null);
      // Give browser time to release camera
      await new Promise(r => setTimeout(r, 500));
    }

    try {
      const result = await getMediaStream();
      setStream(result.stream);
      setMediaMode(result.mode);
      setMediaError(null);

      if (result.mode === 'video-only') {
        setStatusText('Connected (no mic) — Searching for peer...');
        setAudioEnabled(false);
      } else if (result.mode === 'audio-only') {
        setStatusText('Connected (no camera) — Searching for peer...');
        setVideoEnabled(false);
      } else {
        setStatusText('Searching for peer...');
      }
    } catch (err) {
      console.error('[Media] All attempts failed:', err);
      let errorMsg = 'Camera/mic error. ';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = 'Camera/mic blocked. Please allow access in browser settings. ';
      } else if (err.name === 'NotFoundError') {
        errorMsg = 'No camera/mic found. Please connect a camera. ';
      } else if (err.name === 'NotReadableError') {
        errorMsg = 'Camera is in use by another app. Close it and retry. ';
      }
      setMediaError(errorMsg);
      setStatusText(errorMsg);
    }
  }, []);

  useEffect(() => { initMedia(); }, [initMedia]);

  // 2. Bind local video — prevent freezing by handling play errors
  useEffect(() => {
    if (myVideo.current && stream) {
      const el = myVideo.current;
      el.srcObject = stream;
      // Use a slight delay to ensure the stream is ready
      const playTimeout = setTimeout(() => {
        el.play().catch((e) => {
          console.warn('[Video] Local play error, retrying:', e);
          // Retry after a moment
          setTimeout(() => el.play().catch(() => { }), 300);
        });
      }, 100);
      return () => clearTimeout(playTimeout);
    }
  }, [stream]);

  // 3. Bind remote video with freeze prevention
  useEffect(() => {
    const el = remoteVideo.current;
    if (!el) return;
    if (remoteStream) {
      el.srcObject = remoteStream;
      const playRemote = () => {
        el.play().catch((e) => {
          console.warn('[Video] Remote play error, retrying:', e);
          setTimeout(() => el.play().catch(() => { }), 300);
        });
      };
      el.onloadedmetadata = playRemote;
      // Also try immediately
      setTimeout(playRemote, 200);
    } else {
      el.srcObject = null;
    }
  }, [remoteStream]);

  // ============================================================
  // 4. MAIN EFFECT: Channel + Matchmaking + Signaling
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
      if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
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
        if (e.streams?.[0]) {
          setRemoteStream(e.streams[0]);

          // Ensure remote video plays — fix freeze
          if (remoteVideo.current) {
            remoteVideo.current.srcObject = e.streams[0];
            setTimeout(() => {
              if (remoteVideo.current) {
                remoteVideo.current.play().catch(() => { });
              }
            }, 200);
          }
        }
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

      // Handle ICE connection states with grace period for disconnects
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("[WebRTC] ICE state:", state);

        if (state === 'connected' || state === 'completed') {
          // Clear any grace period timer
          if (disconnectGraceRef.current) {
            clearTimeout(disconnectGraceRef.current);
            disconnectGraceRef.current = null;
          }
          setStatusText('Matched & Connected');
        }

        if (state === 'disconnected') {
          // Give 5 seconds grace period for network blips before dropping
          setStatusText('Reconnecting...');
          if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
          disconnectGraceRef.current = setTimeout(() => {
            if (pcRef.current && pcRef.current.iceConnectionState === 'disconnected') {
              console.log("[WebRTC] Disconnected for 5s, trying ICE restart");
              // Try ICE restart before giving up
              try {
                pcRef.current.restartIce();
              } catch (e) {
                console.warn("[WebRTC] ICE restart failed:", e);
                resetToLobby();
              }
            }
          }, 5000);
        }

        if (state === 'failed') {
          // Try ICE restart once before giving up
          console.log("[WebRTC] ICE failed, attempting restart");
          try {
            pc.restartIce();
            setStatusText('Connection lost, retrying...');
            // Give it 8 seconds to recover after restart
            setTimeout(() => {
              if (pcRef.current === pc && pc.iceConnectionState === 'failed') {
                console.log("[WebRTC] ICE still failed after restart, resetting");
                resetToLobby();
              }
            }, 8000);
          } catch (e) {
            console.warn("[WebRTC] ICE restart not possible:", e);
            resetToLobby();
          }
        }
      };

      // Connection timeout: 20s (longer for slow mobile networks)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (pc === pcRef.current && pc.connectionState !== 'connected') {
          console.log("[WebRTC] Timed out after 20s");
          resetToLobby();
        }
      }, 20000);

      pc.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", pc.connectionState);
        if (pc.connectionState === 'connected') {
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        }
        if (pc.connectionState === 'failed') {
          console.log("[WebRTC] Connection failed");
          // ICE handler will attempt restart, but if connection state itself says failed, reset
          if (pc.iceConnectionState === 'failed') {
            resetToLobby();
          }
        }
      };

      // Initiator creates offer after a small delay (wait for receiver to be ready)
      if (isInit) {
        setTimeout(async () => {
          try {
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
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
        }, 600);
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
        // Auto-reconnect on channel errors
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn("[Supabase] Channel error/timeout, will retry...");
          setStatusText('Connection lost, reconnecting...');
          setTimeout(() => {
            channel.subscribe();
          }, 2000);
        }
      });

    return () => {
      cleanup();
      channel.unsubscribe();
      window.__handleNext = null;
    };
  }, [stream]); // Only re-run when stream changes (once)

  // ---- UI event handlers ----
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
        {mediaMode !== 'full' && !mediaError && (
          <span style={{ marginLeft: 6, fontSize: '0.65rem', opacity: 0.7 }}>
            ({mediaMode === 'video-only' ? '🎥 no mic' : '🎙️ no cam'})
          </span>
        )}
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
          {/* Retry button if camera failed */}
          {mediaError && (
            <div className="video-off-overlay" style={{ flexDirection: 'column', gap: 12 }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', textAlign: 'center', padding: '0 20px', margin: 0 }}>
                {mediaError}
              </p>
              <button
                className="btn btn-primary"
                onClick={initMedia}
                style={{ fontSize: '0.8rem', padding: '8px 16px' }}
              >
                <RefreshCw size={16} /> Retry Camera
              </button>
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
