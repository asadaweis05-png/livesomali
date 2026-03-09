import React, { useState, useEffect, useRef } from 'react';
import Peer from 'simple-peer';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';
import { supabase } from './supabase';

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

  // Unique session ID for this tab
  const [myId] = useState(Math.random().toString(36).substring(7));

  const myVideo = useRef();
  const remoteVideo = useRef();
  const connectionRef = useRef();
  const channelRef = useRef();
  const isMatchedRef = useRef(false);
  const isRequestingRef = useRef(false);

  // 1. Initialize Media Stream
  useEffect(() => {
    setStatusText('Allow Camera/Mic access...');
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: true
    })
      .then((currentStream) => {
        setStream(currentStream);
        if (myVideo.current) myVideo.current.srcObject = currentStream;
        setStatusText('Searching for peer...');
      })
      .catch(err => {
        console.error("Camera error:", err);
        setStatusText('Error: Please enable camera/mic.');
      });
  }, []);

  // 2. Setup Persistent Supabase Channel
  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId } }
    });

    const attemptMatch = (state) => {
      if (isMatchedRef.current || isRequestingRef.current) return;
      const availablePartners = Object.keys(state).filter(id => {
        const presence = state[id][0];
        return id !== myId && !presence.partnerId && presence.isReady;
      });

      if (availablePartners.length > 0) {
        const partnerId = availablePartners[Math.floor(Math.random() * availablePartners.length)];
        console.log('Sending match request to', partnerId);
        isRequestingRef.current = true;
        channel.send({
          type: 'broadcast',
          event: 'match_request',
          payload: { from: myId, to: partnerId }
        });

        setTimeout(() => {
          if (!isMatchedRef.current) {
            console.log('Match request timed out');
            isRequestingRef.current = false;
            if (channelRef.current) {
              attemptMatch(channelRef.current.presenceState());
            }
          }
        }, 3000);
      }
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log('Presence update:', state);
        attemptMatch(state);
      })
      .on('broadcast', { event: 'match_request' }, ({ payload }) => {
        if (payload.to === myId && !isMatchedRef.current) {
          console.log('Received match request from', payload.from);
          isMatchedRef.current = true;
          channel.send({
            type: 'broadcast',
            event: 'match_accept',
            payload: { from: myId, to: payload.from }
          });
          startWebRTC(payload.from, false);
        }
      })
      .on('broadcast', { event: 'match_accept' }, ({ payload }) => {
        if (payload.to === myId && isRequestingRef.current && !isMatchedRef.current) {
          console.log('Match accepted by', payload.from);
          isMatchedRef.current = true;
          startWebRTC(payload.from, true);
        }
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        if (payload.to === myId && connectionRef.current) {
          console.log('Signal received from', payload.from);
          connectionRef.current.signal(payload.signal);
        }
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload.to === myId) {
          setMessages((prev) => [...prev, { text: payload.message, sent: false }]);
        }
      })
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        if (payload.to === myId && payload.type === 'start_game') {
          setIsGaming(true);
        }
      })
      .on('broadcast', { event: 'disconnect' }, ({ payload }) => {
        if (payload.to === myId) {
          console.log('Peer left match');
          handleNext();
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to Supabase lobby');
          await channel.track({ isReady: true, partnerId: null, joinedAt: Date.now() });
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [stream]);

  const startWebRTC = (partnerId, initiator) => {
    if (isMatchedRef.current && initiator) return; // Already matched

    console.log(`Setting up Peer. Initiator: ${initiator}, Target: ${partnerId}`);
    isMatchedRef.current = true;
    setIsMatched(true);
    setPeerId(partnerId);
    setIsInitiator(initiator);
    setStatusText('Found match! Connecting...');

    // Mark ourselves as BUSY immediately
    channelRef.current.track({ isReady: true, partnerId, joinedAt: Date.now() });

    const peer = new Peer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      }
    });

    peer.on('signal', (data) => {
      console.log('Broadcasting signal to partner');
      channelRef.current.send({
        type: 'broadcast',
        event: 'signal',
        payload: { to: partnerId, from: myId, signal: data }
      });
    });

    peer.on('stream', (remoteStream) => {
      console.log('Establishing live video...');
      setRemoteStream(remoteStream);
      if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
      setStatusText('Matched & Connected');
    });

    peer.on('error', (err) => {
      console.warn('Connection failed, finding new match...', err);
      handleNext();
    });

    connectionRef.current = peer;
  };

  const handleNext = () => {
    if (peerId && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'disconnect',
        payload: { to: peerId }
      });
    }

    if (connectionRef.current) {
      connectionRef.current.destroy();
      connectionRef.current = null;
    }

    isMatchedRef.current = false;
    isRequestingRef.current = false;
    setIsMatched(false);
    setRemoteStream(null);
    setIsGaming(false);
    setPeerId(null);
    setMessages([]);
    setStatusText('Searching for peer...');

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
          {remoteStream ? (
            <video playsInline ref={remoteVideo} autoPlay />
          ) : (
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
