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

  // Stats for debugging
  const [myId] = useState(Math.random().toString(36).substring(7));

  const myVideo = useRef();
  const remoteVideo = useRef();
  const connectionRef = useRef();
  const channelRef = useRef();

  // Keep track of match state in a ref to avoid stale closure issues in callbacks
  const isMatchedRef = useRef(false);

  // 1. Initialize Media Stream
  useEffect(() => {
    setStatusText('Requesting camera/mic...');
    navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: true
    })
      .then((currentStream) => {
        setStream(currentStream);
        if (myVideo.current) myVideo.current.srcObject = currentStream;
        setStatusText('Finding match...');
      })
      .catch(err => {
        console.error("Error accessing media devices:", err);
        setStatusText('Error: Camera/Mic access denied.');
      });
  }, []);

  // 2. Persistent Supabase Channel
  useEffect(() => {
    if (!stream) return;

    const channel = supabase.channel('lobby', {
      config: { presence: { key: myId } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log('Presence update:', state);

        if (!isMatchedRef.current) {
          // Find potential partners who are ALSO not matched
          // Note: In a production app, you'd store "isSearching" in presence metadata
          const availablePartners = Object.keys(state).filter(id => {
            const presence = state[id][0];
            return id !== myId && !presence.partnerId;
          });

          if (availablePartners.length > 0) {
            // Sort to ensure both sides pick the same partner
            availablePartners.sort();
            const partnerId = availablePartners[0];
            const initiator = myId < partnerId;
            startWebRTC(partnerId, initiator);
          }
        }
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        if (payload.to === myId && connectionRef.current) {
          console.log('Received signal from', payload.from);
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
          console.log('Peer disconnected via broadcast');
          handleNext();
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to lobby');
          await channel.track({ online_at: new Date().toISOString(), partnerId: null });
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [stream]); // NO isMatched in dependency array!

  const startWebRTC = (partnerId, initiator) => {
    if (isMatchedRef.current) return;

    console.log(`Attempting match with ${partnerId}, initiator: ${initiator}`);
    isMatchedRef.current = true;
    setIsMatched(true);
    setPeerId(partnerId);
    setIsInitiator(initiator);
    setStatusText('Connecting to peer...');

    // Update presence to show we are busy
    channelRef.current.track({ online_at: new Date().toISOString(), partnerId });

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
      console.log('Sending signal to', partnerId);
      channelRef.current.send({
        type: 'broadcast',
        event: 'signal',
        payload: { to: partnerId, from: myId, signal: data }
      });
    });

    peer.on('stream', (remoteStream) => {
      console.log('Received remote stream');
      setRemoteStream(remoteStream);
      if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
      setStatusText('Connected');
    });

    peer.on('error', (err) => {
      console.error('WebRTC Peer Error:', err);
      handleNext();
    });

    peer.on('close', () => {
      console.log('Peer connection closed');
      handleNext();
    });

    connectionRef.current = peer;
  };

  const handleNext = () => {
    // Tell partner we are leaving
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
    setIsMatched(false);
    setRemoteStream(null);
    setIsGaming(false);
    setPeerId(null);
    setMessages([]);
    setStatusText('Finding match...');

    // Reset presence to available
    if (channelRef.current) {
      channelRef.current.track({ online_at: new Date().toISOString(), partnerId: null });
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
              {isMatched ? 'Establishing Secure Connection...' : 'Searching for strangers...'}
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
              <p>Welcome! Once matched, you can chat here.</p>
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
            placeholder={isMatched ? "Type a message..." : "Waiting for match..."}
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
