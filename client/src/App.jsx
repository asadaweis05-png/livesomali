import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward, Info, RefreshCw, Users, Globe, Play, Heart, ThumbsUp, UserPlus, Settings, Star, Mail, User, X } from 'lucide-react';
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
  const [userCountry, setUserCountry] = useState({ name: '', code: '' });
  const [remoteCountry, setRemoteCountry] = useState({ name: '', code: '' });
  const [beautyFilter, setBeautyFilter] = useState('none');
  const [mediaError, setMediaError] = useState(null);
  const [connectionType, setConnectionType] = useState(null);
  const [remoteNeedsPlay, setRemoteNeedsPlay] = useState(false);
  const [iceServersLoaded, setIceServersLoaded] = useState(false);
  const [activeGame, setActiveGame] = useState(null);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);
  const [currentView, setCurrentView] = useState('chat'); // chat, games, messages, profile, favorites, settings
  const [reactions, setReactions] = useState([]); // {id, emoji, x, y}
  const [swipeStart, setSwipeStart] = useState(null);


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
      let name = 'Isticmaale';
      if (session?.user) {
        name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Isticmaale';
      }
      setUserName(name);
      
      // Fetch Country
      try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        const countryData = { name: data.country_name, code: data.country_code };
        setUserCountry(countryData);
        socketRef.current?.emit('set_identity', { name, country: countryData });
      } catch (e) {
        console.error('Country fetch failed', e);
        socketRef.current?.emit('set_identity', { name, country: { name: 'Unknown', code: '' } });
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
        (p.className === 'Porn' || p.className === 'Hentai' || p.className === 'Sexy') && p.probability > 0.7
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

  const sendReaction = (type) => {
    if (!isMatched || !peerId) return;
    const emojiMap = { love: '❤️', like: '👍', friend: '🤝' };
    const emoji = emojiMap[type];
    socketRef.current.emit('game_action', { type: 'reaction', emoji });
    addReaction(emoji);
  };

  const addReaction = (emoji) => {
    const id = Date.now();
    setReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10, y: 80 }]);
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  };

  useEffect(() => {
    const handleTouchStart = (e) => setSwipeStart(e.touches[0].clientX);
    const handleTouchEnd = (e) => {
      if (!swipeStart) return;
      const diff = swipeStart - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 100) findMatch();
      setSwipeStart(null);
    };
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [findMatch, swipeStart]);

  useEffect(() => {
    if (socketRef.current) {
      socketRef.current.on('game_action', (data) => {
        if (data.type === 'reaction') addReaction(data.emoji);
      });
    }
  }, [socketRef.current]);

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

    socket.on('match_found', ({ peerId, initiator, peerName, peerCountry }) => {
      console.log('Match found with', peerId, 'initiator:', initiator);
      setIsMatched(true);
      isMatchedRef.current = true;
      setPeerId(peerId);
      peerIdRef.current = peerId;
      setIsInitiator(initiator);
      setRemoteName(peerName || 'Shisheeye');
      setRemoteCountry(peerCountry || { name: '', code: '' });
      setStatusText('Iskuxidhaaya...');
      setupPC(peerId, initiator);
      
      // Share our identity and initial media state immediately
      socket.emit('set_identity', { name: userName, country: userCountry });
      socket.emit('media_state', { audio: audioEnabled, video: videoEnabled });
    });

    socket.on('update_remote_identity', ({ name, country }) => {
      if (name) setRemoteName(name);
      if (country) setRemoteCountry(country);
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

  const getFlagEmoji = (countryCode) => {
    if (!countryCode) return '';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched && peerId) {
      socketRef.current.emit('send_message', inputText);
      setMessages(prev => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'games':
        return (
          <div className="view-overlay glass animate-in">
            <button className="close-btn" onClick={() => setCurrentView('chat')}><X /></button>
            <h3>Games</h3>
            <div className="game-grid">
               <div className="game-card" onClick={() => { setActiveGame('ttt'); setCurrentView('chat'); }}>
                  <Gamepad2 size={40} />
                  <span>Tic Tac Toe</span>
               </div>
               <div className="game-card" onClick={() => { setActiveGame('rps'); setCurrentView('chat'); }}>
                  <Gamepad2 size={40} />
                  <span>RPS</span>
               </div>
            </div>
          </div>
        );
      case 'settings':
        return (
          <div className="view-overlay glass animate-in">
             <button className="close-btn" onClick={() => setCurrentView('chat')}><X /></button>
             <h3>Settings</h3>
             <div className="settings-list">
                <div className="settings-item"><span>Privacy Policy</span><Info size={18}/></div>
                <div className="settings-item"><span>User Preferences</span><Settings size={18}/></div>
                <div className="settings-item"><span>Language: Somali</span><Globe size={18}/></div>
             </div>
          </div>
        );
      case 'messages':
        return (
          <div className="view-overlay glass animate-in">
             <button className="close-btn" onClick={() => setCurrentView('chat')}><X /></button>
             <div className="view-header">
                <h3>Messages</h3>
             </div>
             <div className="view-empty">
                <Mail size={48} style={{ opacity: 0.3 }} />
                <p>You have no messages yet.</p>
             </div>
          </div>
        );
      case 'favorites':
        return (
          <div className="view-overlay glass animate-in">
             <button className="close-btn" onClick={() => setCurrentView('chat')}><X /></button>
             <div className="view-header">
                <h3>Favorites</h3>
             </div>
             <div className="fav-tabs">
                <button className="active">Favorites</button>
                <button>Favorited You</button>
             </div>
             <div className="view-empty">
                <Star size={48} style={{ opacity: 0.3 }} />
                <p>Your favorites list is empty.</p>
             </div>
          </div>
        );
      case 'profile':
        return (
          <div className="view-overlay glass animate-in">
             <button className="close-btn" onClick={() => setCurrentView('chat')}><X /></button>
             <div className="profile-container">
                <div className="profile-header">
                   <div className="profile-avatar">
                      <User size={60} />
                      <div className="avatar-edit">+</div>
                   </div>
                   <h2>{userName}</h2>
                   <p>@{userName.toLowerCase().replace(/\s/g, '')}</p>
                </div>
                <div className="profile-actions">
                   <button className="btn-p">Upload a Photo</button>
                   <button className="btn-p secondary">Edit Profile</button>
                </div>
             </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-container">
           <button className="home-logo-btn" onClick={() => { setCurrentView('chat'); setIsChatOpen(false); }}>
              <img src="https://i.ibb.co/LdqV8X9/logo.png" alt="Theqnew TV" />
              <div className="live-pill">LIVE</div>
           </button>
           <span className="logo-text">Theqnew TV</span>
        </div>
        <div className="header-status">
           <div className={isMatched ? 'status-dot online' : 'status-dot pulse'}></div>
           {statusText}
        </div>
      </header>

      <main className="main-content">
        <div className="video-viewport">
          <div className="video-grid-ome">
            <div className={`video-box local ${beautyFilter}`}>
              <video playsInline muted ref={myVideo} autoPlay style={{ transform: 'scaleX(1)' }} />
              <div className="video-label-ome">Adiga</div>
              
              <div className="local-media-controls">
                <button className={`media-btn ${audioEnabled ? 'active' : 'off'}`} onClick={() => {
                  if (stream?.getAudioTracks) {
                    const newState = !audioEnabled;
                    stream.getAudioTracks()[0].enabled = newState;
                    setAudioEnabled(newState);
                    socketRef.current?.emit('media_state', { audio: newState, video: videoEnabled });
                  }
                }}>
                  {audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
                <button className={`media-btn ${videoEnabled ? 'active' : 'off'}`} onClick={() => {
                  if (stream?.getVideoTracks) {
                    const newState = !videoEnabled;
                    stream.getVideoTracks()[0].enabled = newState;
                    setVideoEnabled(newState);
                    socketRef.current?.emit('media_state', { audio: audioEnabled, video: newState });
                  }
                }}>
                  {videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
              </div>

              {!videoEnabled && <div className="video-off-notice glass">Kamarada waa dansan tahay</div>}
              
              {reactions.map(r => (
                <div key={r.id} className="floating-emoji" style={{ left: `${r.x}%`, top: `${r.y}%` }}>{r.emoji}</div>
              ))}
            </div>

            <div className="video-box remote">
              <video playsInline ref={remoteVideo} autoPlay />
              {!remoteStream && (
                <div className="video-cta">
                   {!isMatched && (
                     <button className="btn-ome-start" onClick={findMatch}>
                        <Play size={32} />
                        <span>START RADAR</span>
                     </button>
                   )}
                   {isMatched && <div className="loader-ome"></div>}
                </div>
              )}
              <div className="video-label-ome">
                {remoteName} {remoteCountry.code && <span>{getFlagEmoji(remoteCountry.code)}</span>}
              </div>

              <div className="remote-status-indicators">
                {remoteMuted && <div className="status-pill warn"><MicOff size={12} /> Cabiran</div>}
                {remoteVideoOff && <div className="status-pill warn"><VideoOff size={12} /> Dansan</div>}
              </div>

              <div className="ome-controls-overlay">
                 {isMatched && (
                   <div className="reaction-bar">
                      <button onClick={() => sendReaction('love')}><Heart size={20} fill="#ff4d4d" color="#ff4d4d" /></button>
                      <button onClick={() => sendReaction('like')}><ThumbsUp size={20} fill="#4dabff" color="#4dabff" /></button>
                      <button onClick={() => socketRef.current?.emit('friend_request')}><UserPlus size={20} /></button>
                   </div>
                 )}
              </div>
            </div>
          </div>

          <div className={`ome-chat-drawer ${isChatOpen ? 'active' : ''}`}>
             <div className="ome-chat-header">
                <h3>Sheekaysi</h3>
                <button className="chat-close-btn" onClick={() => setIsChatOpen(false)}><X size={20} /></button>
             </div>
             <div className="ome-chat-messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`ome-msg ${msg.sent ? 'sent' : 'received'}`}>{msg.text}</div>
                ))}
             </div>
             <form className="ome-chat-input" onSubmit={sendMessage}>
                <input type="text" placeholder="Qor farriin..." value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={!isMatched} />
                <button type="submit"><SkipForward size={20} /></button>
             </form>
          </div>
        </div>

        {activeGame && (
          <div className="game-overlay-ome animate-in">
             <button className="close-btn" onClick={() => setActiveGame(null)}><X /></button>
             {activeGame === 'ttt' && <TicTacToe socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}
             {activeGame === 'rps' && <RPS socket={socketRef.current} peerId={peerId} isInitiator={isInitiator} onDispose={() => setActiveGame(null)} />}
          </div>
        )}

        {renderView()}
      </main>

      <nav className="bottom-nav">
        <button className={currentView === 'chat' ? 'active' : ''} onClick={() => { setCurrentView('chat'); setIsChatOpen(false); }}>
          <MessageCircle size={24} />
          <span>Chat</span>
        </button>
        <button onClick={() => setIsChatOpen(!isChatOpen)} className={`nav-chat-btn ${isChatOpen ? 'active' : ''}`}>
          <img src="https://image2url.com/r2/default/images/1773292582841-f5fb7cbb-311d-4bbc-8261-d9c6c6510101.png" alt="Chat" className="nav-logo-icon" />
          <span>Inbox</span>
        </button>
        <button className={currentView === 'games' ? 'active' : ''} onClick={() => setCurrentView('games')}>
          <Gamepad2 size={24} />
          <span>Games</span>
        </button>
        <button className={currentView === 'profile' ? 'active' : ''} onClick={() => setCurrentView('profile')}>
          <User size={24} />
          <span>Profile</span>
        </button>
        <button className={currentView === 'settings' ? 'active' : ''} onClick={() => setCurrentView('settings')}>
          <Settings size={24} />
          <span>Rules</span>
        </button>
      </nav>

      <style>{`
        .app { display: flex; flex-direction: column; height: 100vh; background: #000; overflow: hidden; }
        .app-header { height: 70px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: #111; border-bottom: 1px solid #222; z-index: 100; }
        .home-logo-btn { width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--accent-primary); padding: 0; background: #000; cursor: pointer; position: relative; overflow: visible; margin-right: 15px; display: flex; align-items: center; justify-content: center; }
        .home-logo-btn img { width: 32px; height: 32px; object-fit: contain; }
        .live-pill { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #ff4d4d; color: #fff; font-size: 0.5rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; box-shadow: 0 0 10px rgba(255,77,77,0.5); }
        .app-logo { display: none; }
        .logo-text { font-weight: 800; font-size: 1.2rem; color: #fff; }
        .header-status { font-size: 0.8rem; color: #888; display: flex; align-items: center; gap: 8px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
        
        .main-content { flex: 1; position: relative; overflow: hidden; }
        .video-viewport { height: 100%; position: relative; }
        .video-grid-ome { display: grid; grid-template-rows: 1fr 1fr; height: 100%; background: #000; }
        
        @media (min-width: 900px) {
           .video-grid-ome { grid-template-rows: 1fr; grid-template-columns: 1fr 1fr; }
        }

        .video-box { position: relative; overflow: hidden; background: #111; border: 1px solid #222; }
        .video-box video { width: 100%; height: 100%; object-fit: cover; }
        .video-label-ome { position: absolute; bottom: 20px; left: 20px; background: rgba(0,0,0,0.6); padding: 5px 12px; border-radius: 6px; font-size: 0.8rem; color: #fff; z-index: 10; }
        
        .btn-ome-start { display: flex; flex-direction: column; align-items: center; gap: 15px; background: none; border: none; color: #fff; cursor: pointer; transition: 0.3s; }
        .btn-ome-start:hover { transform: scale(1.1); color: var(--accent-primary); }
        .video-cta { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 20; background: rgba(0,0,0,0.4); }
        
        .bottom-nav { height: 70px; display: flex; background: #111; border-top: 1px solid #222; }
        .bottom-nav button { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: none; border: none; color: #666; cursor: pointer; transition: 0.3s; }
        .bottom-nav button.active { color: var(--accent-primary); }
        .bottom-nav button span { font-size: 0.65rem; text-transform: uppercase; font-weight: 700; }

        .reaction-bar { display: flex; gap: 15px; background: rgba(0,0,0,0.4); padding: 8px 15px; border-radius: 100px; backdrop-filter: blur(10px); }
        .ome-controls-overlay { position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 30; }
        
        .floating-emoji { position: absolute; font-size: 2rem; pointer-events: none; animation: floatUp 2s ease-out forwards; z-index: 100; }
        @keyframes floatUp { from { transform: translateY(0) scale(0.5); opacity: 1; } to { transform: translateY(-150px) scale(1.5); opacity: 0; } }

        .nav-logo-icon { width: 28px; height: 28px; object-fit: contain; filter: grayscale(1) brightness(1.5); transition: 0.3s; }
        .active .nav-logo-icon { filter: none; }
        .ome-chat-header { display: flex; align-items: center; justify-content: space-between; padding: 15px 20px; border-bottom: 1px solid #222; }
        .ome-chat-header h3 { margin: 0; font-size: 0.9rem; color: var(--accent-primary); }
        .chat-close-btn { background: none; border: none; color: #888; cursor: pointer; }

        .ome-chat-drawer { position: absolute; right: 0; top: 0; bottom: 0; width: 300px; background: rgba(0,0,0,0.9); backdrop-filter: blur(20px); border-left: 1px solid #333; transform: translateX(100%); transition: 0.3s; z-index: 50; display: flex; flex-direction: column; }
        .ome-chat-drawer.active { transform: translateX(0); }
        .ome-chat-messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .ome-chat-input { padding: 15px; display: flex; gap: 10px; border-top: 1px solid #222; }
        .ome-chat-input input { flex: 1; background: #222; border: none; border-radius: 8px; padding: 10px; color: #fff; outline: none; }
        
        .local-media-controls { position: absolute; top: 15px; right: 15px; display: flex; gap: 10px; z-index: 40; }
        .media-btn { width: 38px; height: 38px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); color: #fff; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; }
        .media-btn.active { color: var(--accent-primary); border-color: var(--accent-primary); box-shadow: 0 0 15px rgba(0,212,255,0.3); }
        .media-btn.off { color: #ff4d4d; border-color: #ff4d4d; }
        .media-btn:hover { background: rgba(255,255,255,0.1); transform: scale(1.1); }

        .video-off-notice { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); color: #888; font-size: 0.8rem; z-index: 5; }
        
        .remote-status-indicators { position: absolute; top: 15px; left: 15px; display: flex; flex-direction: column; gap: 8px; z-index: 40; }
        .status-pill { background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 6px; font-size: 0.65rem; color: #fff; display: flex; align-items: center; gap: 6px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); }
        .status-pill.warn { color: #ffb84d; border-color: rgba(255,184,77,0.2); }
        .animate-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        
        .game-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
        .game-card { background: #222; padding: 30px; border-radius: 20px; display: flex; flex-direction: column; align-items: center; gap: 15px; cursor: pointer; border: 1px solid #333; }
        .game-card:hover { border-color: var(--accent-primary); background: #2a2a2a; }

        .settings-list { display: flex; flex-direction: column; gap: 15px; margin-top: 30px; }
        .settings-item { background: #222; padding: 15px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; }
        
        @media (max-width: 900px) {
           .ome-chat-drawer { width: 100%; top: auto; height: 50vh; transform: translateY(100%); border-left: none; border-top: 1px solid #333; }
           .ome-chat-drawer.active { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default App;
