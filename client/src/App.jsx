import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

// Working STUN & TURN servers for NAT traversal
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65b92f6aae6e0753b1e8',
      credential: '5V960yrLjJBfYGkl',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b92f6aae6e0753b1e8',
      credential: '5V960yrLjJBfYGkl',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65b92f6aae6e0753b1e8',
      credential: '5V960yrLjJBfYGkl',
    },
    {
      urls: 'turn:a.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65b92f6aae6e0753b1e8',
      credential: '5V960yrLjJBfYGkl',
    },
  ]
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

  const [myId] = useState(Math.random().toString(36).substring(7));

  const myVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peerConnectionRef = useRef(null);
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const peerIdRef = useRef(null);
  const peerIceQueue = useRef([]);
  const connectionTimeoutRef = useRef(null);

  // Keep stream ref in sync so callbacks always have latest
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // 1. Initialize Local Media
  useEffect(() => {
    setStatusText('Allow Camera/Mic access...');
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((currentStream) => {
        setStream(currentStream);
        setStatusText('Searching for peer...');
      })
      .catch(err => {
        console.error("Camera error:", err);
        setStatusText('Error: Please allow camera/mic access.');
      });
  }, []);

  // 2. Bind local stream to video element
  useEffect(() => {
    if (myVideo.current && stream) {
      myVideo.current.srcObject = stream;
      myVideo.current.onloadedmetadata = () => {
        myVideo.current.play().catch(() => { });
      };
    }
  }, [stream]);

  // 3. Bind remote stream to video element
  useEffect(() => {
    if (remoteVideo.current && remoteStream) {
      remoteVideo.current.srcObject = remoteStream;
      remoteVideo.current.onloadedmetadata = () => {
        remoteVideo.current.play().catch(() => { });
      };
      remoteVideo.current.play().catch(() => { });
    } else if (remoteVideo.current && !remoteStream) {
      remoteVideo.current.srcObject = null;
    }
  }, [remoteStream]);

  // ---- Core Functions (defined at component level for proper scoping) ----

  const cleanupConnection = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }, []);

  const resetToLobby = useCallback(() => {
    cleanupConnection();
    isMatchedRef.current = false;
    isRequestingRef.current = false;
    peerIdRef.current = null;
    peerIceQueue.current = [];
    setIsMatched(false);
    setRemoteStream(null);
    setIsGaming(false);
    setPeerId(null);
    setMessages([]);
    setStatusText('Searching for peer...');
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    // Re-advertise as available
    if (channelRef.current) {
      channelRef.current.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
    }
  }, [cleanupConnection]);

  const handleNext = useCallback(() => {
    // Notify partner we are leaving
    if (peerIdRef.current && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast', event: 'disconnect',
        payload: { to: peerIdRef.current }
      });
    }
    resetToLobby();
  }, [resetToLobby]);

  const setupPeerConnection = useCallback((partnerId, isInit) => {
    console.log(`Setting up WebRTC. Initiator: ${isInit}, Partner: ${partnerId}`);
    setIsMatched(true);
    setPeerId(partnerId);
    peerIdRef.current = partnerId;
    setIsInitiator(isInit);
    setStatusText('Found match! Connecting...');
    peerIceQueue.current = [];

    // Mark ourselves as busy
    if (channelRef.current) {
      channelRef.current.track({ isReady: false, partnerId, joinedAt: Date.now() });
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // Add local tracks
    const currentStream = streamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
    }

    // Receive remote tracks
    pc.ontrack = (event) => {
      console.log("Got remote track:", event.track.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
      setStatusText('Matched & Connected');
    };

    // Send ICE candidates to partner
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast', event: 'webrtc_ice',
          payload: { to: partnerId, from: myId, candidate: event.candidate.toJSON() }
        });
      }
    };

    // Only drop on permanent failure, NOT on transient "disconnected"
    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.log("ICE permanently failed");
        handleNext();
      }
    };

    // Connection timeout: 15 seconds to establish
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = setTimeout(() => {
      if (pc === peerConnectionRef.current && pc.connectionState !== 'connected') {
        console.log("Connection timed out after 15s");
        handleNext();
      }
    }, 15000);

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === 'connected') {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      }
      if (pc.connectionState === 'failed') {
        console.log("Connection permanently failed");
        handleNext();
      }
    };

    // Initiator creates and sends the offer
    if (isInit) {
      // Small delay to ensure the non-initiator has their PC ready
      setTimeout(async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast', event: 'webrtc_offer',
              payload: { to: partnerId, from: myId, offer: pc.localDescription.toJSON() }
            });
            console.log("Offer sent to", partnerId);
          }
        } catch (err) {
          console.error("Error creating offer:", err);
          handleNext();
        }
      }, 500);
    }
  }, [myId, handleNext]);

  // 4. Supabase Channel & Signaling
  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    const attemptMatch = (state) => {
      if (isMatchedRef.current || isRequestingRef.current) return;
      const available = Object.keys(state).filter(id => {
        const p = state[id]?.[0];
        return id !== myId && p && p.isReady && !p.partnerId;
      });

      if (available.length > 0) {
        const partnerId = available[Math.floor(Math.random() * available.length)];
        console.log('Requesting match with', partnerId);
        isRequestingRef.current = partnerId;
        channel.send({
          type: 'broadcast', event: 'match_request',
          payload: { from: myId, to: partnerId }
        });

        // Timeout: if no response in 5s, retry
        setTimeout(() => {
          if (!isMatchedRef.current && isRequestingRef.current === partnerId) {
            console.log('Match request timed out, retrying...');
            isRequestingRef.current = false;
            attemptMatch(channel.presenceState());
          }
        }, 5000);
      }
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        attemptMatch(channel.presenceState());
      })

      // --- Matchmaking ---
      .on('broadcast', { event: 'match_request' }, ({ payload }) => {
        if (payload.to !== myId) return;

        if (isMatchedRef.current) {
          channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
          return;
        }

        if (isRequestingRef.current) {
          if (isRequestingRef.current === payload.from) {
            // Crossed requests: lower ID wins as initiator
            if (myId < payload.from) {
              return; // I'm initiator, wait for their accept
            } else {
              isRequestingRef.current = false; // I yield
            }
          } else {
            // I'm requesting someone else, reject this
            channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
            return;
          }
        }

        console.log('Accepting request from', payload.from);
        isMatchedRef.current = true;
        isRequestingRef.current = false;
        peerIdRef.current = payload.from;
        channel.track({ isReady: false, partnerId: payload.from, joinedAt: Date.now() });
        channel.send({ type: 'broadcast', event: 'match_accept', payload: { from: myId, to: payload.from } });
        setupPeerConnection(payload.from, false); // Receiver = NOT initiator
      })

      .on('broadcast', { event: 'match_accept' }, ({ payload }) => {
        if (payload.to !== myId || payload.from !== isRequestingRef.current || isMatchedRef.current) return;
        console.log('Match accepted by', payload.from);
        isMatchedRef.current = true;
        isRequestingRef.current = false;
        peerIdRef.current = payload.from;
        channel.track({ isReady: false, partnerId: payload.from, joinedAt: Date.now() });
        setupPeerConnection(payload.from, true); // Requester = IS initiator
      })

      .on('broadcast', { event: 'match_reject' }, ({ payload }) => {
        if (payload.to !== myId || isMatchedRef.current) return;
        if (isRequestingRef.current === payload.from) {
          console.log('Request rejected by', payload.from);
          isRequestingRef.current = false;
          attemptMatch(channel.presenceState());
        }
      })

      // --- WebRTC Signaling ---
      .on('broadcast', { event: 'webrtc_offer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current) return;
        if (!peerConnectionRef.current) return;
        console.log("Received offer");
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          channel.send({
            type: 'broadcast', event: 'webrtc_answer',
            payload: { from: myId, to: payload.from, answer: peerConnectionRef.current.localDescription.toJSON() }
          });
          console.log("Answer sent");
          // Flush queued ICE candidates
          const queue = [...peerIceQueue.current];
          peerIceQueue.current = [];
          for (const c of queue) {
            try { await peerConnectionRef.current.addIceCandidate(c); } catch (e) { }
          }
        } catch (err) { console.error("Offer error:", err); }
      })

      .on('broadcast', { event: 'webrtc_answer' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current) return;
        if (!peerConnectionRef.current) return;
        console.log("Received answer");
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
          // Flush queued ICE candidates
          const queue = [...peerIceQueue.current];
          peerIceQueue.current = [];
          for (const c of queue) {
            try { await peerConnectionRef.current.addIceCandidate(c); } catch (e) { }
          }
        } catch (err) { console.error("Answer error:", err); }
      })

      .on('broadcast', { event: 'webrtc_ice' }, async ({ payload }) => {
        if (payload.to !== myId || payload.from !== peerIdRef.current) return;
        if (!peerConnectionRef.current) return;
        try {
          const candidate = new RTCIceCandidate(payload.candidate);
          if (peerConnectionRef.current.remoteDescription && peerConnectionRef.current.remoteDescription.type) {
            await peerConnectionRef.current.addIceCandidate(candidate);
          } else {
            peerIceQueue.current.push(candidate);
          }
        } catch (err) { console.error("ICE error:", err); }
      })

      // --- Chat, Game, Disconnect ---
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
        if (status === 'SUBSCRIBED') {
          await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
        }
      });

    return () => { channel.unsubscribe(); };
  }, [stream, myId, setupPeerConnection, resetToLobby]);

  // ---- UI Handlers ----
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
      const track = stream.getVideoTracks()[0];
      if (track) { track.enabled = !videoEnabled; setVideoEnabled(!videoEnabled); }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const track = stream.getAudioTracks()[0];
      if (track) { track.enabled = !audioEnabled; setAudioEnabled(!audioEnabled); }
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
        <button className="btn btn-primary" onClick={handleNext} style={{ background: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)' }}>
          <SkipForward size={20} /> Next
        </button>
      </div>
    </div>
  );
}

export default App;
