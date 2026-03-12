import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw, Users, Globe, Play } from 'lucide-react';
import io from 'socket.io-client';
import * as nsfwjs from 'nsfwjs';
import * as faceapi from 'face-api.js';
import './App.css';
import TicTacToe from './components/TicTacToe';
import RPS from './components/RPS';
import { supabase } from './supabase';

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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [statusText, setStatusText] = useState('Dhisaya...');
  const [userName, setUserName] = useState(localStorage.getItem('ls_name') || '');
  const [remoteName, setRemoteName] = useState('');
  const [beautyFilter, setBeautyFilter] = useState('none');
  const [mediaError, setMediaError] = useState(null);
  const [connectionType, setConnectionType] = useState(null);
  const [remoteNeedsPlay, setRemoteNeedsPlay] = useState(false);
  const [iceServersLoaded, setIceServersLoaded] = useState(false);
  const [activeGame, setActiveGame] = useState(null);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);


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

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Isticmaale';
        setUserName(name);
        socketRef.current?.emit('set_name', name);
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Isticmaale';
        setUserName(name);
        socketRef.current?.emit('set_name', name);
      }
    });
    return () => subscription.unsubscribe();
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
    setStatusText('Fadlan ogolow kamarada/makarafoonka...');
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
      setMediaError('Kamaradu waa xiran tahay. Qoraal kaliya.');
      setStatusText('Raadinaya (Kamarad la\'aan)...');
      setStream({ getTracks: () => [] });
      findMatch();
    }
  }, [findMatch]);

  const modelRef = useRef(null);
  const faceModelLoaded = useRef(false);

  useEffect(() => {
    const loadModels = async () => {
      try {
        modelRef.current = await nsfwjs.load();
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights');
        faceModelLoaded.current = true;
        console.log('Moderation models loaded');
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    };
    loadModels();
  }, []);

  const checkModeration = useCallback(async () => {
    if (!stream || !myVideo.current || !modelRef.current) return;
    
    try {
      // Nudity Detection (Stricter Logic)
      const predictions = await modelRef.current.classify(myVideo.current);
      // We target 'Porn', 'Sexy', 'Hentai' with a lower threshold (0.5 instead of 0.7) for safety
      const isNude = predictions.some(p => 
        (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.5
      );
      
      if (isNude) {
        console.warn('NSFW Violation Detected:', predictions);
        setMediaError('Xayiraad: Nudity/Sexy laguma ogola!');
        setStatusText('La mamnuucay: Nudity');
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
        socketRef.current?.disconnect();
        alert('VIOLATION: Kontantigan laguma ogola barnaamijkan! Adiga waa lagu mamnuucay.');
        return;
      }

      // Face Detection
      if (faceModelLoaded.current) {
        const detections = await faceapi.detectAllFaces(myVideo.current, new faceapi.TinyFaceDetectorOptions());
        if (detections.length === 0 && videoEnabled) {
          setStatusText('Fadlan tus wajigaaga...');
        }
      }
    } catch (err) {
      console.error('Moderation error:', err);
    }
  }, [stream, videoEnabled]);

  useEffect(() => {
    const itv = setInterval(checkModeration, 3000);
    return () => clearInterval(itv);
  }, [checkModeration]);

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
      setStatusText(`Error: Serverka lama heli karo`);
    });

    socket.on('match_found', ({ peerId, initiator, peerName }) => {
      console.log('Match found with', peerId, 'initiator:', initiator);
      setIsMatched(true);
      isMatchedRef.current = true;
      setPeerId(peerId);
      peerIdRef.current = peerId;
      setIsInitiator(initiator);
      setRemoteName(peerName || 'Shisheeye');
      setStatusText('Iskuxidhaaya...');
      setupPC(peerId, initiator);
      
      // Share our name immediately
      socket.emit('set_name', userName);
    });

    socket.on('update_remote_name', (name) => setRemoteName(name));

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

    socket.on('peer_media_state', ({ audio, video }) => {
      setRemoteMuted(!audio);
      setRemoteVideoOff(!video);
    });

    socket.on('receive_friend_request', ({ fromName }) => {
      alert(`${fromName} wuxuu kuu soo diray codsi saaxiibtinimo!`);
    });

    socket.on('peer_disconnected', () => {
      console.log('Peer disconnected');
      setRemoteName('');
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
    <div className={`app ${activeGame ? 'vs-layout' : ''}`}>
      <div className="status-badge">
        <div className={isMatched ? '' : 'pulse'}></div>
        {statusText}
        {isMatched && connectionType && <span className="connection-pill"><Globe size={10} style={{ marginRight: 4 }} />{connectionType}</span>}
      </div>

      <div className="video-container">
        <div className="video-wrapper glass my-vid">
          <video playsInline muted ref={myVideo} autoPlay className={`f-${beautyFilter}`} />
          <div className="video-label">{userName || 'Adiga'}</div>
          {mediaError && <div className="video-off-overlay"><button className="btn btn-primary btn-sm" onClick={initMedia}><RefreshCw size={14} /> Mar kale</button></div>}
        </div>
        {!activeGame && <div className="vs-divider">VS</div>}
        <div className="video-wrapper glass peer-vid">
          <video playsInline ref={remoteVideo} autoPlay />
          {!remoteStream && <div className="video-placeholder">{isMatched ? 'Iskuxidhaaya...' : 'Sugaya...'}</div>}
          <div className="state-badge">
             {remoteMuted && <div className="badge-pill">Muted</div>}
             {remoteVideoOff && <div className="badge-pill">Off</div>}
          </div>
          {remoteNeedsPlay && (
            <div className="video-off-overlay" onClick={() => { remoteVideo.current.play(); setRemoteNeedsPlay(false); }} style={{ background: 'rgba(0,0,0,0.8)', cursor: 'pointer' }}>
              <button className="btn btn-primary"><Play size={20} /></button>
            </div>
          )}
          <div className="video-label">
            {remoteName || 'Shisheeye'}
            {isMatched && <button className="btn btn-sm" style={{ padding: '2px 6px', marginLeft: '5px', fontSize: '0.55rem', background: 'rgba(255,255,255,0.1)' }} onClick={() => socketRef.current?.emit('friend_request')}>+ Saaxiib</button>}
          </div>
        </div>
      </div>

      <div className={`chat-panel glass ${isChatOpen ? 'active' : ''}`}>
        <div className="chat-messages">
          {messages.length === 0 && !isMatched && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}><p>Ku dhufo qof!</p></div>}
          {messages.map((msg, i) => <div key={i} className={`message ${msg.sent ? 'sent' : 'received'}`}>{msg.text}</div>)}
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input type="text" placeholder="Farriin..." value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={!isMatched} />
          <button type="submit" className="btn btn-primary" disabled={!isMatched}><MessageCircle size={18} /></button>
        </form>
      </div>

      {!activeGame && (
        <div className="game-panel glass">
          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.7rem', opacity: 0.6 }}>CIYAARAHA</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: '0.75rem' }} onClick={isMatched ? () => setActiveGame('ttt') : undefined} disabled={!isMatched}><Gamepad2 size={14} /> Tic Tac Toe</button>
            <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', borderColor: 'transparent' }} onClick={isMatched ? () => setActiveGame('rps') : undefined} disabled={!isMatched}><Gamepad2 size={14} /> RPS</button>
          </div>
        </div>
      )}

      {activeGame === 'ttt' && <TicTacToe socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}
      {activeGame === 'rps' && <RPS socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}

      <div className="controls glass">
        <button className={`btn btn-circle ${audioEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { 
          if (stream?.getAudioTracks) { 
            const newState = !audioEnabled;
            stream.getAudioTracks()[0].enabled = newState; 
            setAudioEnabled(newState); 
            socketRef.current?.emit('media_state', { audio: newState, video: videoEnabled });
          } 
        }}>{audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</button>
        
        <button className={`btn btn-circle ${videoEnabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => { 
          if (stream?.getVideoTracks) { 
            const newState = !videoEnabled;
            stream.getVideoTracks()[0].enabled = newState; 
            setVideoEnabled(newState); 
            socketRef.current?.emit('media_state', { audio: audioEnabled, video: newState });
          } 
        }}>{videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button>
        
        <div className="filter-shelf">
          {['none', 'nuru', 'diirran', 'soft', 'tiktok'].map(f => (
            <button key={f} className={`filter-dot d-${f} ${beautyFilter === f ? 'active' : ''}`} onClick={() => setBeautyFilter(f)} />
          ))}
        </div>

        <button className="btn btn-next" onClick={findMatch}><SkipForward size={20} /> <span className="hide-mobile">XIGA</span></button>
      </div>

      <button className={`chat-toggle-floating ${isChatOpen ? 'active' : ''}`} onClick={() => setIsChatOpen(!isChatOpen)}>
        <MessageCircle size={22} />
      </button>

      <style>{`
        .app.vs-layout .video-container {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: row;
          gap: 40px;
          width: auto;
          z-index: 1000;
          padding: 0;
        }
        .vs-layout .video-wrapper {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: 3px solid var(--accent-primary);
          overflow: hidden;
          background: #000;
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
        }
        .vs-layout .video-label {
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 0.6rem;
          white-space: nowrap;
          background: none;
        }
        .vs-layout .video-wrapper video {
           object-fit: cover;
           width: 100%;
           height: 100%;
        }
        .vs-layout .state-badge, .vs-layout .controls { display: none; }
        .vs-layout .btn-next { display: none; }
        
        .chat-toggle-floating {
          position: fixed;
          bottom: 30px;
          left: 20px;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: none;
          background: var(--accent-primary);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          z-index: 100;
          transition: all 0.3s;
        }
        .chat-toggle-floating.active { background: #ff4d4d; transform: rotate(90deg); }
        
        video.f-tiktok {
          filter: brightness(1.15) contrast(1.05) saturate(1.25) blur(0.2px);
          box-shadow: inset 0 0 50px rgba(255,255,255,0.1);
        }
        .filter-shelf {
          display: flex;
          gap: 10px;
          background: rgba(255,255,255,0.05);
          padding: 8px 15px;
          border-radius: 50px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .filter-dot { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: 0.3s; }
        .filter-dot.active { border-color: #fff; transform: scale(1.3); }
        .d-none { background: #888; }
        .d-nuru { background: #fff7ed; box-shadow: 0 0 10px #fff7ed; }
        .d-diirran { background: #ff7e5f; box-shadow: 0 0 10px #ff7e5f; }
        .d-soft { background: #d8b4fe; box-shadow: 0 0 10px #d8b4fe; }
        .d-tiktok { background: linear-gradient(45deg, #00f2ea, #ff0050); border: 1px solid white; }

        .btn-circle { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 0 !important; }
        .btn-next { background: linear-gradient(90deg, #8b5cf6, #ec4899); padding: 12px 25px; border-radius: 50px; font-weight: 800; letter-spacing: 1px; }
        
        .vs-divider {
           position: absolute;
           left: 50%;
           top: 50%;
           transform: translate(-50%, -50%);
           font-size: 2rem;
           font-weight: 900;
           color: #fff;
           opacity: 0.2;
           z-index: 1;
        }

        @media (max-width: 600px) {
          .hide-mobile { display: none; }
          .video-container:not(.vs-layout) { padding: 10px; gap: 10px; }
          .video-wrapper:not(.vs-layout) { border-radius: 15px; }
        }
      `}</style>
    </div>
  );
}

export default App;
