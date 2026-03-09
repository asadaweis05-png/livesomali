import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { Video, VideoOff, Mic, MicOff, MessageCircle, Gamepad2, SkipForward } from 'lucide-react';
import './App.css';
import TicTacToe from './components/TicTacToe';

// IMPORTANT: Replace this with your deployed backend URL (e.g., on Render or Railway)
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5000'
  : 'https://livesomali-backend.onrender.com'; // Example placeholder

const socket = io(BACKEND_URL);

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

  const myVideo = useRef();
  const remoteVideo = useRef();
  const connectionRef = useRef();

  // 1. Initialize Media Stream once with HD Constraints
  useEffect(() => {
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
        if (myVideo.current) {
          myVideo.current.srcObject = currentStream;
        }
      })
      .catch(err => console.error("Error accessing media devices:", err));
  }, []);

  // 2. Setup Socket Listeners
  useEffect(() => {
    socket.on('match_found', ({ peerId, initiator }) => {
      console.log('Match found:', peerId, 'Initiator:', initiator);
      setPeerId(peerId);
      setIsMatched(true);
      setIsInitiator(initiator);
      setIsGaming(false);
      setMessages([]);

      const peer = new Peer({
        initiator: initiator,
        trickle: false,
        stream: stream,
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
        socket.emit('signal', { peerId, signal: data });
      });

      peer.on('stream', (remoteStream) => {
        setRemoteStream(remoteStream);
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remoteStream;
        }
      });

      connectionRef.current = peer;
    });

    socket.on('signal', (data) => {
      if (connectionRef.current) {
        connectionRef.current.signal(data.signal);
      }
    });

    socket.on('receive_message', ({ message }) => {
      setMessages((prev) => [...prev, { text: message, sent: false }]);
    });

    socket.on('game_action', (data) => {
      if (data.type === 'start_game') {
        setIsGaming(true);
      }
    });

    socket.on('peer_disconnected', () => {
      handleNext();
    });

    return () => {
      socket.off('match_found');
      socket.off('signal');
      socket.off('receive_message');
      socket.off('game_action');
      socket.off('peer_disconnected');
    };
  }, [stream]);

  const handleNext = () => {
    if (connectionRef.current) {
      connectionRef.current.destroy();
      connectionRef.current = null;
    }
    setRemoteStream(null);
    setIsMatched(false);
    setIsGaming(false);
    setPeerId(null);
    socket.emit('find_match');
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputText.trim() && isMatched) {
      socket.emit('send_message', inputText);
      setMessages((prev) => [...prev, { text: inputText, sent: true }]);
      setInputText('');
    }
  };

  const startGame = () => {
    if (isMatched) {
      setIsGaming(true);
      socket.emit('game_action', { type: 'start_game' });
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
        <div className="pulse"></div>
        {isMatched ? 'Connected' : 'Finding match...'}
      </div>

      <div className="video-container">
        <div className="video-wrapper glass">
          <video playsInline muted ref={myVideo} autoPlay />
          <div style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '0.8rem' }}>You</div>
          {!videoEnabled && (
            <div style={{
              position: 'absolute', inset: 0, background: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <VideoOff size={48} color="rgba(255,255,255,0.1)" />
            </div>
          )}
        </div>
        <div className="video-wrapper glass">
          {remoteStream ? (
            <video playsInline ref={remoteVideo} autoPlay />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.3)' }}>
              {isMatched ? 'Connecting...' : 'Waiting for peer...'}
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 10, left: 10, color: '#fff', fontSize: '0.8rem' }}>Stranger</div>
        </div>
      </div>

      <div className="chat-panel glass">
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.sent ? 'sent' : 'received'}`}>
              {msg.text}
            </div>
          ))}
        </div>
        <form className="chat-input" onSubmit={sendMessage}>
          <input
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '8px' }}>
            <MessageCircle size={18} />
          </button>
        </form>
      </div>

      <div className="game-panel glass">
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Live Games</h4>
        <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }} onClick={isMatched ? startGame : undefined}>
          <Gamepad2 size={16} /> Tic Tac Toe
        </button>
      </div>

      {isGaming && isMatched && (
        <TicTacToe
          socket={socket}
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
