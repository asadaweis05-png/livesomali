import React, { useState, useEffect } from 'react';
import { X, Hand, Scissors, Square, RotateCcw, Zap } from 'lucide-react';

const choices = [
  { id: 'rock', icon: Square, label: 'Rock', color: '#8b5cf6' },
  { id: 'paper', icon: Hand, label: 'Paper', color: '#10b981' },
  { id: 'scissors', icon: Scissors, label: 'Scissors', color: '#ec4899' }
];

const RPS = ({ socket, peerId, isInitiator, onDispose }) => {
  const [myChoice, setMyChoice] = useState(null);
  const [peerChoice, setPeerChoice] = useState(null);
  const [result, setResult] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [scores, setScores] = useState({ me: 0, them: 0 });

  useEffect(() => {
    if (!socket) return;

    const handleAction = ({ type, choice }) => {
      if (type === 'rps_choice') {
        setPeerChoice(choice);
      } else if (type === 'rps_rematch') {
        resetGame();
      }
    };

    socket.on('game_action', handleAction);
    return () => socket.off('game_action', handleAction);
  }, [socket]);

  useEffect(() => {
    if (myChoice && peerChoice) {
      calculateResult();
    }
  }, [myChoice, peerChoice]);

  const calculateResult = () => {
    if (myChoice === peerChoice) {
      setResult('Draw');
    } else if (
      (myChoice === 'rock' && peerChoice === 'scissors') ||
      (myChoice === 'paper' && peerChoice === 'rock') ||
      (myChoice === 'scissors' && peerChoice === 'paper')
    ) {
      setResult('You Win!');
      setScores(prev => ({ ...prev, me: prev.me + 1 }));
    } else {
      setResult('You Lose!');
      setScores(prev => ({ ...prev, them: prev.them + 1 }));
    }
  };

  const makeChoice = (id) => {
    if (myChoice || countdown) return;
    setMyChoice(id);
    socket.emit('game_action', { type: 'rps_choice', choice: id });
  };

  const resetGame = () => {
    setMyChoice(null);
    setPeerChoice(null);
    setResult(null);
    setCountdown(null);
  };

  const requestRematch = () => {
    resetGame();
    socket.emit('game_action', { type: 'rps_rematch' });
  };

  return (
    <div className="game-overlay glass rps-premium">
      <button className="close-btn" onClick={onDispose}><X size={20} /></button>

      <div className="rps-header">
        <Zap size={24} color="#FBBF24" />
        <h3>ROCK PAPER SCISSORS</h3>
        <div className="rps-score">
           <span>{scores.me}</span> : <span>{scores.them}</span>
        </div>
      </div>

      <div className="rps-arena">
        <div className="rps-player">
          <div className="player-label">YOU</div>
          <div className={`choice-display ${myChoice ? 'selected' : ''}`}>
             {myChoice ? (
               <div className="choice-icon-wrap" style={{ color: choices.find(c => c.id === myChoice).color }}>
                 {React.createElement(choices.find(c => c.id === myChoice).icon, { size: 48 })}
                 <div className="choice-label">{myChoice.toUpperCase()}</div>
               </div>
             ) : '❓'}
          </div>
        </div>

        <div className="rps-vs">VS</div>

        <div className="rps-player">
          <div className="player-label">PEER</div>
          <div className={`choice-display ${peerChoice && result ? 'selected' : ''}`}>
             {result ? (
               <div className="choice-icon-wrap" style={{ color: choices.find(c => c.id === peerChoice).color }}>
                 {React.createElement(choices.find(c => c.id === peerChoice).icon, { size: 48 })}
                 <div className="choice-label">{peerChoice.toUpperCase()}</div>
               </div>
             ) : (peerChoice ? 'READY' : '...')}
          </div>
        </div>
      </div>

      {result ? (
        <div className="rps-result-panel">
          <h2 className={result === 'You Win!' ? 'win' : result === 'You Lose!' ? 'lose' : ''}>{result}</h2>
          <button className="btn btn-primary" onClick={requestRematch}>
            <RotateCcw size={18} /> Play Again
          </button>
        </div>
      ) : (
        <div className="rps-controls">
          <p>{myChoice ? "Waiting for peer..." : "Choose your weapon:"}</p>
          <div className="choice-buttons">
            {choices.map(c => (
              <button 
                key={c.id} 
                className={`choice-btn ${myChoice === c.id ? 'active' : ''} ${myChoice ? 'disabled' : ''}`}
                onClick={() => makeChoice(c.id)}
              >
                <c.icon size={28} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .rps-premium {
          max-width: 500px;
          padding: 30px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .rps-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 30px;
        }
        .rps-header h3 { margin: 0; font-size: 1.1rem; letter-spacing: 1px; color: #fff; }
        .rps-score {
          background: rgba(255,255,255,0.05);
          padding: 5px 15px;
          border-radius: 15px;
          font-weight: 800;
          font-family: monospace;
          font-size: 1.2rem;
          color: #fff;
        }
        .rps-arena {
          display: flex;
          align-items: center;
          justify-content: space-around;
          margin-bottom: 40px;
        }
        .rps-player { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .player-label { font-size: 0.7rem; font-weight: 800; opacity: 0.5; letter-spacing: 2px; }
        .choice-display {
          width: 120px;
          height: 120px;
          background: rgba(255,255,255,0.03);
          border: 2px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          transition: all 0.3s;
        }
        .choice-display.selected {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.2);
          box-shadow: 0 0 30px rgba(0,0,0,0.3);
        }
        .choice-icon-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .choice-label { font-size: 0.7rem; font-weight: 900; letter-spacing: 1px; }
        .rps-vs { font-size: 1.5rem; font-weight: 900; opacity: 0.2; transform: scale(1.5); }
        
        .rps-controls p { font-size: 0.9rem; opacity: 0.6; margin-bottom: 15px; }
        .choice-buttons { display: flex; gap: 15px; justify-content: center; }
        .choice-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 20px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
        }
        .choice-btn:hover:not(.disabled) { background: rgba(255,255,255,0.08); transform: translateY(-3px); border-color: rgba(255,255,255,0.2); }
        .choice-btn.active { background: rgba(139, 92, 246, 0.1); border-color: #8b5cf6; box-shadow: 0 0 20px rgba(139, 92, 246, 0.2); }
        .choice-btn.disabled { opacity: 0.3; cursor: not-allowed; }
        .choice-btn span { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; }
        
        .rps-result-panel h2 { margin-bottom: 20px; letter-spacing: 2px; }
        .rps-result-panel .win { color: #10b981; text-shadow: 0 0 20px rgba(16,185,129,0.4); }
        .rps-result-panel .lose { color: #ef4444; text-shadow: 0 0 20px rgba(239,68,68,0.4); }

        @keyframes popIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default RPS;
