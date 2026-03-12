import React, { useState, useEffect } from 'react';
import './Ludo.css';

// A simplified 2-player Ludo architecture
// P1 (Initiator) = RED, P2 (Receiver) = BLUE
const PATH_LENGTH = 52;
const HOME_LENGTH = 5;

const INITIAL_STATE = {
  red: [0, 0, 0, 0], // 0 means base. 1-52 means main path. 53-57 means home column. 58 means win.
  blue: [0, 0, 0, 0]
};

const Ludo = ({ socket, peerId, isInitiator, onDispose }) => {
  const [positions, setPositions] = useState(INITIAL_STATE);
  const [turn, setTurn] = useState(isInitiator ? 'red' : 'blue'); // Initiator goes first as Red
  const [diceRoll, setDiceRoll] = useState(null);
  const [hasRolled, setHasRolled] = useState(false);
  const [logs, setLogs] = useState([]);

  const myColor = isInitiator ? 'red' : 'blue';
  const isMyTurn = turn === myColor;

  useEffect(() => {
    if (!socket) return;
    const handleAction = (data) => {
      if (data.action === 'roll') {
        setDiceRoll(data.value);
        setHasRolled(true);
        addLog(`${data.color} rolled a ${data.value}`);
      } else if (data.action === 'move') {
        setPositions(data.positions);
        setDiceRoll(null);
        setHasRolled(false);
        setTurn(data.nextTurn);
        addLog(`${data.color} moved a pawn.`);
        checkWin(data.positions);
      }
    };
    socket.on('game_action', handleAction);
    return () => socket.off('game_action', handleAction);
  }, [socket]);

  const addLog = (msg) => {
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  const rollDice = () => {
    if (!isMyTurn || hasRolled) return;
    const val = Math.floor(Math.random() * 6) + 1;
    setDiceRoll(val);
    setHasRolled(true);
    addLog(`You rolled a ${val}`);
    
    // Check if any move is possible. If not, auto pass turn.
    let canMove = false;
    positions[myColor].forEach(pos => {
      if (pos === 0 && val === 6) canMove = true;
      if (pos > 0 && pos + val <= 58) canMove = true;
    });

    if (!canMove) {
      setTimeout(() => passTurn(val, positions), 1500);
    } else {
      socket.emit('game_action', { action: 'roll', value: val, color: myColor });
    }
  };

  const passTurn = (val, latestPos) => {
    const nextTurn = myColor === 'red' ? 'blue' : 'red';
    setTurn(nextTurn);
    setDiceRoll(null);
    setHasRolled(false);
    socket.emit('game_action', { action: 'move', positions: latestPos, nextTurn, color: myColor });
  };

  const calculateGlobalPos = (color, localPos) => {
    if (localPos === 0 || localPos > 52) return null; // In base or home column
    if (color === 'red') return localPos; // Red starts at 1
    if (color === 'blue') return (localPos + 26) > 52 ? (localPos + 26) - 52 : localPos + 26; // Blue starts opposite
    return localPos;
  };

  const movePawn = (index) => {
    if (!isMyTurn || !hasRolled || !diceRoll) return;

    const currentPos = positions[myColor][index];
    const newPositions = { ...positions };
    const myPawns = [...newPositions[myColor]];
    
    let targetLocal = currentPos;

    if (currentPos === 0) {
      if (diceRoll === 6) targetLocal = 1; // exit base
      else return; // Need 6 to exit
    } else {
      targetLocal = currentPos + diceRoll;
      if (targetLocal > 58) return; // Must roll exact to finish
    }

    myPawns[index] = targetLocal;
    newPositions[myColor] = myPawns;

    // Capture logic (simplified: if landing on same global pos of opponent, send them to 0)
    // Exclude safe zones if building full board, but here we keep it simple pure
    const targetGlobal = calculateGlobalPos(myColor, targetLocal);
    const oppColor = myColor === 'red' ? 'blue' : 'red';
    let hitOpponent = false;

    if (targetGlobal !== null) {
      const oppPawns = [...newPositions[oppColor]];
      for (let i = 0; i < 4; i++) {
        const oppPos = oppPawns[i];
        if (oppPos > 0 && oppPos <= 52) {
          if (calculateGlobalPos(oppColor, oppPos) === targetGlobal) {
            // Safe stars on standard board: 1, 9, 14, 22, 27, 35, 40, 48. Let's add basic safe stars
            const safeStars = [1, 9, 14, 22, 27, 35, 40, 48];
            if (!safeStars.includes(targetGlobal)) {
              oppPawns[i] = 0; // Capture!
              hitOpponent = true;
              addLog(`You captured a ${oppColor} pawn!`);
            }
          }
        }
      }
      newPositions[oppColor] = oppPawns;
    }

    setPositions(newPositions);
    
    // If rolled 6 or hit opponent, get another turn. Otherwise pass.
    if (diceRoll === 6 || hitOpponent) {
      setHasRolled(false);
      setDiceRoll(null);
      addLog(`Extra turn!`);
      socket.emit('game_action', { action: 'move', positions: newPositions, nextTurn: myColor, color: myColor });
    } else {
      setTimeout(() => passTurn(diceRoll, newPositions), 500);
    }
  };

  const checkWin = (posObj) => {
    if (posObj[myColor].every(p => p === 58)) alert("You won standard Ludo duel!");
  };

  // Render the board visually using CSS grid magic
  // For a beautiful aesthetic, we use a simplified track illustration
  return (
    <div className="game-overlay ludo-container glass">
      <button className="close-btn" onClick={onDispose}>✕</button>
      <h2 style={{marginTop: 0, marginBottom: '10px', color: 'var(--accent-primary)', textAlign: 'center'}}>LUDO STAR CLASH</h2>
      
      <div className="ludo-header">
        <div className={`player-badge ${myColor === 'red' ? 'red' : 'blue'}`}>You: {myColor.toUpperCase()}</div>
        <div className="turn-indicator">
          <span className={isMyTurn ? 'pulse-text' : ''}>{isMyTurn ? "YOUR TURN" : "THEIR TURN"}</span>
        </div>
      </div>

      <div className="ludo-board-wrapper">
        <div className="ludo-board-visual">
          {/* Base Red */}
          <div className="base red-base">
            <div className="base-inner">
              {positions.red.map((p, i) => p === 0 && <div key={i} className="pawn red" onClick={() => myColor==='red' && movePawn(i)}/>)}
            </div>
          </div>
          
          {/* Base Blue */}
          <div className="base blue-base">
            <div className="base-inner">
              {positions.blue.map((p, i) => p === 0 && <div key={i} className="pawn blue" onClick={() => myColor==='blue' && movePawn(i)}/>)}
            </div>
          </div>

          {/* Active Track Overlay (Abstracted) */}
          <div className="track-abstract">
            <p style={{opacity: 0.5, fontSize: '0.8rem', textAlign: 'center', margin: '40px 0'}}>
              (Active Pawns Grid)<br/><br/>
              {positions.red.map((p, i) => p > 0 && p < 58 && <span key={`r${i}`} className="pawn red inline" onClick={() => myColor==='red' && movePawn(i)}>R{p}</span>)}
              {positions.blue.map((p, i) => p > 0 && p < 58 && <span key={`b${i}`} className="pawn blue inline" onClick={() => myColor==='blue' && movePawn(i)}>B{p}</span>)}
            </p>
          </div>
          
          {/* Home Area */}
          <div className="center-home">
             <div className="home-zone">
                {positions.red.filter(p=>p===58).length > 0 && <span>🏆 {positions.red.filter(p=>p===58).length}</span>}
                {positions.blue.filter(p=>p===58).length > 0 && <span>🏆 {positions.blue.filter(p=>p===58).length}</span>}
             </div>
          </div>

        </div>
      </div>

      <div className="ludo-controls">
        <button 
          className={`btn dice-btn ${!isMyTurn || hasRolled ? 'disabled' : ''}`} 
          onClick={rollDice}
        >
          🎲 Roll Dice
        </button>
        <div className="dice-result">
          {diceRoll ? <span className="dice-cube val">{diceRoll}</span> : <span className="dice-cube">-</span>}
        </div>
      </div>

      <div className="ludo-logs">
        {logs.map((L, i) => <div key={i} className="log-entry" style={{opacity: 1 - (i*0.2)}}>{L}</div>)}
      </div>

    </div>
  );
};

export default Ludo;
