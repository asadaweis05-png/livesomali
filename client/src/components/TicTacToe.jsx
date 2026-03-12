import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Trophy, User } from 'lucide-react';

const TicTacToe = ({ socket, peerId, isInitiator, onDispose }) => {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [isMyTurn, setIsMyTurn] = useState(isInitiator);
  const [winner, setWinner] = useState(null);
  const [scores, setScores] = useState({ me: 0, them: 0 });
  const [winningLine, setWinningLine] = useState(null);

  const mySymbol = isInitiator ? 'X' : 'O';
  const peerSymbol = isInitiator ? 'O' : 'X';

  useEffect(() => {
    if (!socket) return;

    const handleAction = ({ type, index, scores: remoteScores }) => {
      if (type === 'move') {
        const newBoard = [...board];
        newBoard[index] = peerSymbol;
        setBoard(newBoard);
        const win = checkWinner(newBoard);
        if (win) {
          setWinner(win.player);
          setWinningLine(win.line);
          if (win.player === peerSymbol) {
             setScores(prev => ({ ...prev, them: prev.them + 1 }));
          }
        } else if (!newBoard.includes(null)) {
          setWinner('Draw');
        }
        setIsMyTurn(true);
      } else if (type === 'rematch') {
        resetGame();
      }
    };

    socket.on('game_action', handleAction);
    return () => socket.off('game_action', handleAction);
  }, [socket, board, peerSymbol]);

  const checkWinner = (squares) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { player: squares[a], line: [a, b, c] };
      }
    }
    return null;
  };

  const handleClick = (index) => {
    if (!isMyTurn || board[index] || winner) return;

    const newBoard = [...board];
    newBoard[index] = mySymbol;
    setBoard(newBoard);
    setIsMyTurn(false);

    const win = checkWinner(newBoard);
    if (win) {
      setWinner(win.player);
      setWinningLine(win.line);
      setScores(prev => ({ ...prev, me: prev.me + 1 }));
    } else if (!newBoard.includes(null)) {
      setWinner('Draw');
    }

    socket.emit('game_action', { type: 'move', index });
  };

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setWinner(null);
    setWinningLine(null);
    setIsMyTurn(isInitiator);
  };

  const requestRematch = () => {
    resetGame();
    socket.emit('game_action', { type: 'rematch' });
  };

  return (
    <div className="game-overlay glass ttt-premium">
      <button className="close-btn" onClick={onDispose}><X size={20} /></button>
      
      <div className="ttt-header">
        <Trophy size={24} color="#FFD700" />
        <h3>TIC TAC TOE</h3>
        <div className="ttt-score">
          <div className="score-pill">
            <User size={14} /> <span>{scores.me}</span>
          </div>
          <div className="score-divider">:</div>
          <div className="score-pill">
            <span>{scores.them}</span> <User size={14} />
          </div>
        </div>
      </div>

      <p className={`ttt-status ${isMyTurn ? 'my-turn' : ''}`}>
        {winner ? (winner === 'Draw' ? "It's a Draw!" : `${winner === mySymbol ? 'You Won!' : 'Peer Won!'}`) : (isMyTurn ? "Your turn ( " + mySymbol + " )" : "Waiting for peer...")}
      </p>

      <div className="ttt-grid">
        {board.map((cell, i) => (
          <div
            key={i}
            className={`ttt-square ${winningLine?.includes(i) ? 'winning-square' : ''} ${cell ? 'filled' : ''}`}
            onClick={() => handleClick(i)}
          >
            {cell && <span className={`ttt-symbol ${cell === 'X' ? 'x-symbol' : 'o-symbol'}`}>{cell}</span>}
          </div>
        ))}
      </div>

      {winner && (
        <button className="btn btn-primary btn-rematch" onClick={requestRematch}>
          <RotateCcw size={18} /> Play Again
        </button>
      )}

      <style>{`
        .ttt-premium {
          max-width: 400px;
          padding: 30px;
          border: 1px solid rgba(255,255,255,0.1);
          text-align: center;
        }
        .ttt-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 15px;
          margin-bottom: 20px;
        }
        .ttt-header h3 { margin: 0; letter-spacing: 2px; font-weight: 800; color: #fff; }
        .ttt-score {
          display: flex;
          align-items: center;
          background: rgba(0,0,0,0.3);
          padding: 5px 15px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .score-pill { display: flex; align-items: center; gap: 8px; font-weight: bold; color: #fff; }
        .score-divider { margin: 0 10px; opacity: 0.5; }
        .ttt-status {
          font-weight: 600;
          margin-bottom: 20px;
          color: rgba(255,255,255,0.6);
          transition: all 0.3s;
        }
        .ttt-status.my-turn { color: #fff; transform: scale(1.1); text-shadow: 0 0 10px rgba(139, 92, 246, 0.5); }
        
        .ttt-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin: 0 auto;
          width: 300px;
          height: 300px;
        }
        .ttt-square {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
        }
        .ttt-square:hover:not(.filled) {
          background: rgba(139, 92, 246, 0.1);
          border-color: rgba(139, 92, 246, 0.3);
        }
        .ttt-symbol {
          font-size: 3.5rem;
          font-weight: 900;
          animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes popIn {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .x-symbol { color: #FF4D4D; text-shadow: 0 0 15px rgba(255, 77, 77, 0.4); }
        .o-symbol { color: #4D94FF; text-shadow: 0 0 15px rgba(77, 148, 255, 0.4); }
        
        .winning-square {
          background: rgba(139, 92, 246, 0.2) !important;
          border-color: #8b5cf6 !important;
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
        }
        .btn-rematch {
          margin-top: 30px;
          width: 100%;
          border-radius: 12px;
          padding: 12px;
        }
      `}</style>
    </div>
  );
};

export default TicTacToe;
