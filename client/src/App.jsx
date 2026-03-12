import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw, Users, Globe, Play } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';
import TicTacToe from './components/TicTacToe';
import Ludo from './components/Ludo';

const DEFAULT_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
};

// Replace with your actual deployed server URL
const SOCKET_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://livesomali-production.up.railway.app';

function mungeSdp(sdp) {
  // Bypassing SDP manipulation as it frequently breaks Safari and iOS WebRTC
  return sdp;
}

async function getMediaStream() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
  const [connectionType, setConnectionType] = useState(null);
  const [remoteNeedsPlay, setRemoteNeedsPlay] = useState(false);
  const [iceServersLoaded, setIceServersLoaded] = useState(false);
  const [activeGame, setActiveGame] = useState(null);


  const socketRef = useRef(null);
  const myVideo = useRef(null);
  const remoteVideo = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceQueueRef = useRef([]);
  const timeoutRef = useRef(null);
  const isMatchedRef = useRef(false);
  const peerIdRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  useEffect(() => {
    fetch(`${SOCKET_URL}/api/get-turn-credentials`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          console.log('Successfully fetched dynamic TURN/STUN credentials');
          iceServersRef.current = {
            ...DEFAULT_ICE_SERVERS,
            iceServers: data
          };
        }
      })
      .catch(err => console.error('Failed to load TURN credentials, falling back to STUN.', err))
      .finally(() => setIceServersLoaded(true));
  }, []);

  useEffect(() => { streamRef.current = stream; }, [stream]);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    setIsMatched(false);
    isMatchedRef.current = false;
    setPeerId(null);
    peerIdRef.current = null;
    setConnectionType(null);
    setRemoteNeedsPlay(false);
    setIsGaming(false);
    setActiveGame(null);
    setMessages([]);
    iceQueueRef.current = [];
  }, []);

  const findMatch = useCallback(() => {
    cleanup();
    if (socketRef.current?.connected) {
      setStatusText('Searching for a stranger...');
      socketRef.current.emit('find_match');
    } else {
      setStatusText('Connecting to server...');
    }
  }, [cleanup]);

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
      findMatch();
    } catch (err) {
      setMediaError('Media blocked. Using text-only.');
      setStatusText('Searching (No Camera)...');
      setStream({ getTracks: () => [] });
      findMatch();
    }
  }, [findMatch]);

  useEffect(() => { initMedia(); }, [initMedia]);

  useEffect(() => {
    if (myVideo.current && stream && stream.getVideoTracks().length > 0) {
      myVideo.current.srcObject = stream;
      myVideo.current.play().catch(() => { });
    }
  }, [stream]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) {
      remoteVideo.current.srcObject = remoteStream;
      remoteVideo.current.play()
        .then(() => setRemoteNeedsPlay(false))
        .catch(() => setRemoteNeedsPlay(true));
    } else if (remoteVideo.current) {
      remoteVideo.current.srcObject = null;
    }
  }, [remoteStream]);

  // Socket.io Setup
  useEffect(() => {
    if (!iceServersLoaded) return;

    const socket = io(SOCKET_URL, {
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      transports: ['polling', 'websocket'], // Try polling first for better initial connectivity
      timeout: 20000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to signaling server');
      if (streamRef.current) findMatch();
    });

    socket.on('connect_error', (err) => {
      console.error('Socket Connection Error:', err);
      // Check if it's a transport error or a specific browser block
      const detail = err.description ? `${err.message} (${err.description})` : err.message;
      setStatusText(`Server unreachable: ${detail}`);
    });

    socket.on('match_found', ({ peerId, initiator }) => {
      console.log('Match found with', peerId, 'initiator:', initiator);
      setIsMatched(true);
      isMatchedRef.current = true;
      setPeerId(peerId);
      peerIdRef.current = peerId;
      setIsInitiator(initiator);
      setStatusText('Bridging networks...');
      setupPC(peerId, initiator);
    });

    socket.on('signal', async ({ signal, peerId: fromId }) => {
      if (fromId !== peerIdRef.current || !pcRef.current) return;

      const pc = pcRef.current;
      try {
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current.emit('signal', { peerId: fromId, signal: pc.localDescription.toJSON() });

          const queue = [...iceQueueRef.current];
          iceQueueRef.current = [];
          for (const c of queue) await pc.addIceCandidate(c).catch(console.error);
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));

          const queue = [...iceQueueRef.current];
          iceQueueRef.current = [];
          for (const c of queue) await pc.addIceCandidate(c).catch(console.error);
        } else if (signal.candidate) {
          const c = new RTCIceCandidate(signal);
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(c).catch(console.error);
          } else {
            iceQueueRef.current.push(c);
          }
        }
      } catch (err) {
        console.error('Signal Error:', err);
      }
    });

    socket.on('receive_message', ({ message }) => {
      setMessages(prev => [...prev, { text: message, sent: false }]);
    });

    socket.on('peer_disconnected', () => {
      console.log('Peer disconnected');
      findMatch();
    });
    socket.on('disconnect', () => {
      setStatusText('Disconnected. Retrying...');
    });

    return () => socket.disconnect();
  }, [findMatch, iceServersLoaded]);

  function setupPC(partnerId, isInit) {
    const pc = new RTCPeerConnection(iceServersRef.current);
    pcRef.current = pc;

    const s = streamRef.current;
    if (s && s.getTracks && s.getTracks().length > 0) {
      s.getTracks().forEach(t => pc.addTrack(t, s));
    } else {
      // Critical WebRTC Fallback: If no local camera is available, explicitly request the receiver's video
      // If we don't do this, WebRTC will not negotiate 'm=video' sections, and you will never receive their stream.
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.ontrack = (e) => {
      console.log('Track received:', e.track.kind);
      if (e.streams && e.streams[0]) {
        setRemoteStream(e.streams[0]);
        // Force direct DOM binding to prevent React state cycle delays causing black screens
        if (remoteVideo.current) {
          if (remoteVideo.current.srcObject !== e.streams[0]) {
            remoteVideo.current.srcObject = e.streams[0];
          }
          remoteVideo.current.play().catch(err => {
            console.error('Auto-play blocked:', err);
            setRemoteNeedsPlay(true);
          });
        }
      }
      setStatusText('Global Bridge Active');
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('signal', { peerId: partnerId, signal: e.candidate.toJSON() });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setStatusText('Securely Connected');
      }
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
        setTimeout(() => { if (pc.iceConnectionState === 'failed') findMatch(); }, 10000);
      }
    };

    timeoutRef.current = setTimeout(() => { if (pc.connectionState !== 'connected') findMatch(); }, 25000);

    if (isInit) {
      // Remove artificial timeouts to prevent signaling delays
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current.emit('signal', { peerId: partnerId, signal: pc.localDescription.toJSON() });
        } catch (err) {
          findMatch();
        }
      })();
    }
  }

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId) {
      socketRef.current.emit('send_message', inputText);
      setMessages(prev => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  return (
    <div className={`app ${activeGame === 'ludo' ? 'ludo-mode' : ''}`}>
      <div className="status-badge">
        <div className={isMatched ? '' : 'pulse'}></div>
        {statusText}
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
            <div className="video-off-overlay" onClick={() => { remoteVideo.current.play(); setRemoteNeedsPlay(false); }} style={{ background: 'rgba(0,0,0,0.8)', cursor: 'pointer' }}>
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
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.8rem' }}>LIVE GAMES</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={isMatched ? () => setActiveGame('ludo') : undefined} disabled={!isMatched}><Gamepad2 size={16} /> Play Ludo Star</button>
          <button className="btn btn-primary btn-sm" style={{ width: '100%', background: 'rgba(255,255,255,0.1)', borderColor: 'transparent' }} onClick={isMatched ? () => setActiveGame('ttt') : undefined} disabled={!isMatched}><Gamepad2 size={16} /> Tic Tac Toe</button>
        </div>
      </div>

      {activeGame === 'ttt' && <TicTacToe socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}
      {activeGame === 'ludo' && <Ludo socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}

      <div className="controls glass">
        <button className={`btn ${audioEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { if (stream?.getAudioTracks) { stream.getAudioTracks()[0].enabled = !audioEnabled; setAudioEnabled(!audioEnabled); } }} style={{ padding: '12px' }}>{audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className={`btn ${videoEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { if (stream?.getVideoTracks) { stream.getVideoTracks()[0].enabled = !videoEnabled; setVideoEnabled(!videoEnabled); } }} style={{ padding: '12px' }}>{videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button>
        <button className="btn btn-primary" onClick={findMatch} style={{ background: 'linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%)', padding: '12px 24px' }}><SkipForward size={20} /> Next</button>
      </div>
    </div>
  );
}

export default App;
