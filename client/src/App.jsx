import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

// Standard STUN & Free TURN servers for NAT traversal
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    }
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
  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);
  const peerIdRef = useRef(null);
  const peerIceQueue = useRef([]);

  // 1. Initialize Local Media
  useEffect(() => {
    setStatusText('Allow Camera/Mic access...');
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: true
    })
      .then((currentStream) => {
        setStream(currentStream);
        setStatusText('Searching for peer...');
      })
      .catch(err => {
        console.error("Camera error:", err);
        setStatusText('Error: Please allow camera/mic access.');
      });
  }, []);

  // 2. React stream binding - securely link media streams to video elements
  useEffect(() => {
    if (myVideo.current && stream) {
      if (myVideo.current.srcObject !== stream) {
        myVideo.current.srcObject = stream;
        myVideo.current.onloadedmetadata = () => {
          myVideo.current.play().catch(e => console.error("Local play err:", e));
        };
      }
    }
  }, [stream]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) {
      if (remoteVideo.current.srcObject !== remoteStream) {
        remoteVideo.current.srcObject = remoteStream;
        remoteVideo.current.onloadedmetadata = () => {
          remoteVideo.current.play().catch(e => console.error("Remote play err:", e));
        };
        // fallback robust play
        remoteVideo.current.play().catch(e => console.log("Remote play err2:", e));
      }
    } else if (remoteVideo.current && !remoteStream) {
      remoteVideo.current.srcObject = null;
    }
  }, [remoteStream, isMatched]);

  // 3. Setup Native WebRTC & Supabase Signaling
  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId } }
    });
    channelRef.current = channel;

    const attemptMatch = (state) => {
      if (isMatchedRef.current || isRequestingRef.current) return;
      const availablePartners = Object.keys(state).filter(id => {
        const presence = state[id][0];
        return id !== myId && !presence.partnerId && presence.isReady;
      });

      if (availablePartners.length > 0) {
        const partnerId = availablePartners[Math.floor(Math.random() * availablePartners.length)];
        console.log('Sending match request to', partnerId);
        isRequestingRef.current = partnerId;
        channel.send({
          type: 'broadcast',
          event: 'match_request',
          payload: { from: myId, to: partnerId }
        });

        setTimeout(() => {
          if (!isMatchedRef.current && isRequestingRef.current === partnerId) {
            console.log('Match request timed out');
            isRequestingRef.current = false;
            if (channelRef.current) {
              attemptMatch(channelRef.current.presenceState());
            }
          }
        }, 4000); // 4s timeout for slow network signaling
      }
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        attemptMatch(state);
      })
      // Matchmaking Handshake
      .on('broadcast', { event: 'match_request' }, async ({ payload }) => {
        if (payload.to === myId) {
          if (isMatchedRef.current) {
            // Already matched. Reject instantly.
            channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
            return;
          }

          if (isRequestingRef.current) {
            if (isRequestingRef.current === payload.from) {
              if (myId < payload.from) {
                console.log("Crossed requests, I am smaller ID -> initiator");
                return; // Ignore, wait for their accept
              } else {
                console.log("Crossed requests, I am larger ID -> yield to receiver");
                isRequestingRef.current = false; // Yield
              }
            } else {
              console.log("I requested someone else, rejecting this third-party request");
              channel.send({ type: 'broadcast', event: 'match_reject', payload: { from: myId, to: payload.from } });
              return;
            }
          }

          console.log('Accepting match request from', payload.from);
          isMatchedRef.current = true;
          isRequestingRef.current = false;
          peerIdRef.current = payload.from;

          // INSTANTLY update presence to tell the world we are strictly busy
          channel.track({ isReady: false, partnerId: payload.from, joinedAt: Date.now() });

          channel.send({
            type: 'broadcast',
            event: 'match_accept',
            payload: { from: myId, to: payload.from }
          });
          // I received request -> I am NOT initiator
          await setupPeerConnection(payload.from, false);
        }
      })
      .on('broadcast', { event: 'match_reject' }, ({ payload }) => {
        if (payload.to === myId && isRequestingRef.current === payload.from && !isMatchedRef.current) {
          console.log("Match request was rejected by", payload.from);
          isRequestingRef.current = false; // Free up to ask someone else
          if (channelRef.current) attemptMatch(channelRef.current.presenceState());
        }
      })
      .on('broadcast', { event: 'match_accept' }, async ({ payload }) => {
        if (payload.to === myId && isRequestingRef.current === payload.from && !isMatchedRef.current) {
          console.log('Match accepted by', payload.from);
          isMatchedRef.current = true;
          isRequestingRef.current = false;
          peerIdRef.current = payload.from;

          // INSTANTLY update presence to tell the world we are strictly busy
          channel.track({ isReady: false, partnerId: payload.from, joinedAt: Date.now() });

          // I sent request and it was accepted -> I AM initiator
          await setupPeerConnection(payload.from, true);
        }
      })
      // WebRTC Signaling (Secure to peerIdRef.current only)
      .on('broadcast', { event: 'webrtc_offer' }, async ({ payload }) => {
        if (payload.to === myId && payload.from === peerIdRef.current && peerConnectionRef.current) {
          console.log("Received Offer");
          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer));

            // Process queued ICE candidates
            peerIceQueue.current.forEach(async candidate => {
              try { await peerConnectionRef.current.addIceCandidate(candidate); } catch (err) { }
            });
            peerIceQueue.current = [];

            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);
            channel.send({
              type: 'broadcast',
              event: 'webrtc_answer',
              payload: { from: myId, to: payload.from, answer }
            });
          } catch (err) { console.error("Error handling offer:", err); }
        }
      })
      .on('broadcast', { event: 'webrtc_answer' }, async ({ payload }) => {
        if (payload.to === myId && payload.from === peerIdRef.current && peerConnectionRef.current) {
          console.log("Received Answer");
          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));

            // Process queued ICE candidates
            peerIceQueue.current.forEach(async candidate => {
              try { await peerConnectionRef.current.addIceCandidate(candidate); } catch (err) { }
            });
            peerIceQueue.current = [];

          } catch (err) { console.error("Error handling answer:", err); }
        }
      })
      .on('broadcast', { event: 'webrtc_ice' }, async ({ payload }) => {
        if (payload.to === myId && payload.from === peerIdRef.current && peerConnectionRef.current) {
          try {
            if (payload.candidate) {
              const rtcCandidate = new RTCIceCandidate(payload.candidate);
              if (peerConnectionRef.current.remoteDescription && peerConnectionRef.current.remoteDescription.type) {
                await peerConnectionRef.current.addIceCandidate(rtcCandidate);
              } else {
                peerIceQueue.current.push(rtcCandidate);
              }
            }
          } catch (err) { console.error("Error adding ICE:", err); }
        }
      })
      // Chat & Game Events
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload.to === myId) setMessages((prev) => [...prev, { text: payload.message, sent: false }]);
      })
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        if (payload.to === myId && payload.type === 'start_game') setIsGaming(true);
      })
      .on('broadcast', { event: 'disconnect' }, ({ payload }) => {
        if (payload.to === myId) handleNext();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
        }
      });

    return () => { channel.unsubscribe(); };
  }, [stream]);

  const setupPeerConnection = async (partnerId, isInit) => {
    console.log(`Setting up Native WebRTC. Initiator: ${isInit}`);
    setIsMatched(true);
    setPeerId(partnerId);
    peerIdRef.current = partnerId;
    setIsInitiator(isInit);
    setStatusText('Found match! Connecting...');
    peerIceQueue.current = []; // clear queue

    // Update presence
    // We are busy, so isReady is strictly false
    channelRef.current.track({ isReady: false, partnerId, joinedAt: Date.now() });

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // Add local tracks
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
      setStatusText('Matched & Connected');
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc_ice',
          payload: { to: partnerId, from: myId, candidate: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        console.log("ICE Connection disconnected/failed");
        handleNext();
      }
    };

    // Strict WebRTC fallback timeout: If connection isn't established in 12 seconds, drop it
    const connectionTimeout = setTimeout(() => {
      if (pc.connectionState !== 'connected' && pc.connectionState !== 'completed') {
        console.log("WebRTC Connection timed out. Dropping dead partner.");
        handleNext();
      }
    }, 12000);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' || pc.connectionState === 'completed') {
        clearTimeout(connectionTimeout); // Successfully connected, cancel timeout
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log("WebRTC Connection frozen or failed");
        handleNext();
      }
    };

    // If initiator, create and send Offer
    if (isInit) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channelRef.current.send({
          type: 'broadcast',
          event: 'webrtc_offer',
          payload: { to: partnerId, from: myId, offer }
        });
      } catch (err) {
        console.error("Error creating offer:", err);
        handleNext();
      }
    }
  };

  const handleNext = () => {
    // If we are completely idle and user clicks next, try to match manually
    if (!isMatchedRef.current && !isRequestingRef.current) {
      if (channelRef.current) attemptMatch(channelRef.current.presenceState());
      return;
    }

    if (peerIdRef.current && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'disconnect',
        payload: { to: peerIdRef.current }
      });
    }

    if (peerConnectionRef.current) {
      // Clear event listeners before closing to prevent cascading handleNext calls
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    isMatchedRef.current = false;
    isRequestingRef.current = false;
    setIsMatched(false);
    setRemoteStream(null);
    setIsGaming(false);
    setPeerId(null);
    peerIdRef.current = null;
    setMessages([]);
    peerIceQueue.current = [];
    setStatusText('Searching for peer...');

    if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
    if (channelRef.current) {
      channelRef.current.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'chat',
        payload: { to: peerId, message: inputText }
      });
      setMessages((prev) => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  const startGame = () => {
    if (isMatched && peerId) {
      setIsGaming(true);
      channelRef.current.send({
        type: 'broadcast',
        event: 'game',
        payload: { to: peerId, type: 'start_game' }
      });
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoEnabled;
        setVideoEnabled(!videoEnabled);
      }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioEnabled;
        setAudioEnabled(!audioEnabled);
      }
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
