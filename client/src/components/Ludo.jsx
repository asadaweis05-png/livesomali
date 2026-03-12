import React, { useState, useEffect } from 'react';
import './Ludo.css';

// --- LUDO STAR FULL BOARD ARCHITECTURE ---
const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47]; // Global path indices that are safe
const PATH_LENGTH = 52;
const HOME_LENGTH = 5;

// Global Path Mapping:
// Red starts at 0. Green starts at 13. Yellow starts at 26. Blue starts at 39.
const COLORS = ['red', 'green', 'yellow', 'blue'];
const OFFSETS = { red: 0, green: 13, yellow: 26, blue: 39 };

const INITIAL_POSITIONS = {
  red: [-1, -1, -1, -1],    // -1 means in base
  green: [-1, -1, -1, -1],
  yellow: [-1, -1, -1, -1],
  blue: [-1, -1, -1, -1]
};

const Ludo = ({ socket, peerId, isInitiator, onDispose }) => {
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [turn, setTurn] = useState('red');
  const [diceRoll, setDiceRoll] = useState(null);
  const [hasRolled, setHasRolled] = useState(false);
  const [logs, setLogs] = useState([]);

  // For P2P duel, Initiative = Red, Receiver = Yellow (opposite ends)
  const myColor = isInitiator ? 'red' : 'yellow';
  const isMyTurn = turn === myColor;

  useEffect(() => {
    if (!socket) return;
    const handleAction = (data) => {
      if (data.action === 'roll') {
        setDiceRoll(data.value);
        setHasRolled(true);
        addLog(`${data.color.toUpperCase()} rolled a ${data.value}`);
      } else if (data.action === 'move') {
        setPositions(data.positions);
        setDiceRoll(null);
        setHasRolled(false);
        setTurn(data.nextTurn);
        addLog(`${data.color.toUpperCase()} moved.`);
      }
    };
    socket.on('game_action', handleAction);
    return () => socket.off('game_action', handleAction);
  }, [socket]);

  const addLog = (msg) => {
    setLogs(prev => [msg, ...prev].slice(0, 4));
  };

  const rollDice = () => {
    if (!isMyTurn || hasRolled) return;
    const val = Math.floor(Math.random() * 6) + 1;
    setDiceRoll(val);
    setHasRolled(true);
    addLog(`You rolled ${val}`);

    // Check if any moves are valid
    let possibleMove = false;
    positions[myColor].forEach(p => {
      if (p === -1 && val === 6) possibleMove = true; // Can leave base
      else if (p >= 0 && p + val <= PATH_LENGTH + HOME_LENGTH + 1) possibleMove = true; // Can move
    });

    if (!possibleMove) {
      setTimeout(() => passTurn(positions), 1000); // Auto pass if completely stuck
    } else {
      socket.emit('game_action', { action: 'roll', value: val, color: myColor });
    }
  };

  const passTurn = (newPositions) => {
    const nextTurn = myColor === 'red' ? 'yellow' : 'red';
    setTurn(nextTurn);
    setDiceRoll(null);
    setHasRolled(false);
    socket.emit('game_action', { action: 'move', positions: newPositions, nextTurn, color: myColor });
  };

  const getGlobalPos = (color, localPos) => {
    if (localPos < 0 || localPos >= PATH_LENGTH) return null; // In base or home column
    return (localPos + OFFSETS[color]) % PATH_LENGTH;
  };

  const movePawn = (index) => {
    if (!isMyTurn || !hasRolled || !diceRoll) return;

    const currentLocalPos = positions[myColor][index];
    const newPositions = JSON.parse(JSON.stringify(positions));
    
    let targetLocalPos = currentLocalPos;

    if (currentLocalPos === -1) {
      if (diceRoll === 6) targetLocalPos = 0; // Exit base to start position
      else return; // Invalid move
    } else {
      targetLocalPos = currentLocalPos + diceRoll;
      if (targetLocalPos > PATH_LENGTH + HOME_LENGTH) return; // Invalid move (overshot finish)
    }

    newPositions[myColor][index] = targetLocalPos;

    let hitOpponent = false;
    const targetGlobal = getGlobalPos(myColor, targetLocalPos);

    if (targetGlobal !== null && !SAFE_ZONES.includes(targetGlobal)) {
      // Check for captures
      COLORS.forEach(c => {
        if (c !== myColor) {
          newPositions[c].forEach((oppLocalPos, i) => {
            if (getGlobalPos(c, oppLocalPos) === targetGlobal) {
              newPositions[c][i] = -1; // Send back to base!
              hitOpponent = true;
              addLog(`Captured ${c.toUpperCase()}!`);
            }
          });
        }
      });
    }

    setPositions(newPositions);

    // If 6 or hit opponent, play again. Else pass turn.
    if (diceRoll === 6 || hitOpponent) {
      setHasRolled(false);
      setDiceRoll(null);
      addLog(`Extra roll!`);
      socket.emit('game_action', { action: 'move', positions: newPositions, nextTurn: myColor, color: myColor });
    } else {
      passTurn(newPositions);
    }
  };

  const getDiceFace = (val) => {
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    return faces[val - 1] || '🎲';
  };

  // Rendering logic for a complex 15x15 grid
  const renderGrid = () => {
    const cells = [];
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        let boxClass = 'ludo-cell';
        let isPath = false;
        let star = false;

        // Identify regions
        if (row < 6 && col < 6) boxClass += ' home-box red-area';
        else if (row < 6 && col > 8) boxClass += ' home-box green-area';
        else if (row > 8 && col < 6) boxClass += ' home-box blue-area';
        else if (row > 8 && col > 8) boxClass += ' home-box yellow-area';
        else if (row >= 6 && row <= 8 && col >= 6 && col <= 8) boxClass += ' center-home';
        else {
          boxClass += ' track-cell';
          isPath = true;

          // Mark colored home paths
          if (row === 7 && col > 0 && col < 6) boxClass += ' path-red';
          if (row === 7 && col > 8 && col < 14) boxClass += ' path-yellow';
          if (col === 7 && row > 0 && row < 6) boxClass += ' path-green';
          if (col === 7 && row > 8 && row < 14) boxClass += ' path-blue';

          // Standard Ludo Star Star Placements
          if ((row === 6 && col === 1) || (row === 1 && col === 8) || (row === 8 && col === 13) || (row === 13 && col === 6)) {
              boxClass += ` dark-${(row===6&&col===1)?'red':(row===1&&col===8)?'green':(row===8&&col===13)?'yellow':'blue'}`;
              star = true;
          }
          
          if ((row === 2 && col === 6) || (row === 6 && col === 12) || (row === 12 && col === 8) || (row === 8 && col === 2)) {
              star = true;
          }
        }

        cells.push(
          <div key={`${row}-${col}`} className={boxClass}>
            {star && <span className="star-icon">★</span>}
            {renderPawnsAtGrid(row, col)}
          </div>
        );
      }
    }
    return cells;
  };

  // Very complex coordinate mapping for standard Ludo track
  const GLOBAL_PATH_COORDS = [
    [6,1], [6,2], [6,3], [6,4], [6,5], // Red start & path
    [5,6], [4,6], [3,6], [2,6], [1,6], [0,6], // Up to Green
    [0,7], // Pivot
    [0,8], [1,8], [2,8], [3,8], [4,8], [5,8], // Down to Yellow
    [6,9], [6,10], [6,11], [6,12], [6,13], [6,14], // Right to Yellow
    [7,14], // Pivot
    [8,14], [8,13], [8,12], [8,11], [8,10], [8,9], // Left to Blue
    [9,8], [10,8], [11,8], [12,8], [13,8], [14,8], // Up to Blue
    [14,7], // Pivot
    [14,6], [13,6], [12,6], [11,6], [10,6], [9,6], // Down to Red
    [8,5], [8,4], [8,3], [8,2], [8,1], [8,0], // Left to Red base
    [7,0] // Final Pivot
  ];

  const HOME_COORDS = {
    red:    [[7,1], [7,2], [7,3], [7,4], [7,5]],
    green:  [[1,7], [2,7], [3,7], [4,7], [5,7]],
    yellow: [[7,13], [7,12], [7,11], [7,10], [7,9]],
    blue:   [[13,7], [12,7], [11,7], [10,7], [9,7]]
  };

  const renderPawnsAtGrid = (r, c) => {
    let pawns = [];
    COLORS.forEach(color => {
      positions[color].forEach((pos, idx) => {
        let pr, pc;
        if (pos === -1) return;
        
        if (pos >= 0 && pos < PATH_LENGTH) {
          let gPos = getGlobalPos(color, pos);
          if (gPos !== null) {
              pr = GLOBAL_PATH_COORDS[gPos][0];
              pc = GLOBAL_PATH_COORDS[gPos][1];
          }
        } else if (pos >= PATH_LENGTH && pos < PATH_LENGTH + HOME_LENGTH) {
          let hPos = pos - PATH_LENGTH;
          pr = HOME_COORDS[color][hPos][0];
          pc = HOME_COORDS[color][hPos][1];
        }

        if (pr === r && pc === c) {
          const isMine = color === myColor;
          pawns.push(
            <div 
              key={`${color}-${idx}`} 
              className={`ls-pawn ls-${color} ${isMine ? 'mine' : ''}`}
              onClick={(e) => { e.stopPropagation(); if(isMine) movePawn(idx); }}
            />
          );
        }
      });
    });

    if (pawns.length > 0) {
      return <div className={`pawn-cluster n${pawns.length}`}>{pawns}</div>;
    }
    return null;
  };

  // Base Pawns
  const renderBasePawns = (color) => {
    return positions[color].map((pos, idx) => {
      if (pos === -1) {
        return (
          <div 
            key={`${color}-base-${idx}`} 
            className={`ls-pawn ls-${color} ${color === myColor ? 'mine' : ''} in-base`}
            onClick={() => { if(color === myColor) movePawn(idx); }}
          />
        );
      }
      return <div key={`${color}-base-empty-${idx}`} className="ls-pawn-empty" />;
    });
  };

  return (
    <div className="game-overlay ls-window glass">
      <button className="close-btn" onClick={onDispose}>✕</button>
      
      <div className="ls-header">
        <h2 style={{margin: 0, color: '#fff', fontSize: '1.2rem'}}>👑 LUDO STAR</h2>
        <div className="ls-players-hud">
           <div className={`ls-hud-pill ${turn === 'red' ? 'active-turn red' : ''}`}>YOU (RED)</div>
           <div className={`ls-hud-pill ${turn === 'yellow' ? 'active-turn yellow' : ''}`}>THEM (YELLOW)</div>
        </div>
      </div>

      <div className="ls-main">
        {/* DICE SECTION */}
        <div className="ls-sidebar">
          <div className={`ls-dice-box ${(isMyTurn && !hasRolled) ? 'shake-ready' : ''}`} onClick={rollDice} style={{ cursor: (!hasRolled && isMyTurn) ? 'pointer' : 'default', opacity: (isMyTurn) ? 1 : 0.6 }}>
            <div className={`ls-dice-val ${hasRolled ? 'rolled-pop' : ''}`}>
              {diceRoll ? getDiceFace(diceRoll) : (isMyTurn ? '🎲' : '⏳')}
            </div>
            <div className="ls-dice-lbl">{isMyTurn ? (hasRolled ? "MOVE PIECE" : "TAP TO ROLL") : "WAITING..."}</div>
          </div>
          <div className="ls-logs glass">
             {logs.map((l, i) => <div key={i} className="ls-log-line">{l}</div>)}
          </div>
        </div>

        {/* BOARD SECTION */}
        <div className="ls-board-container">
          <div className="ls-board">
            {renderGrid()}

            {/* Base Overlays */}
            <div className="ls-base-overlay top-left">
               <div className="ls-base-whitebox">{renderBasePawns('red')}</div>
            </div>
            <div className="ls-base-overlay top-right">
               <div className="ls-base-whitebox">{renderBasePawns('green')}</div>
            </div>
            <div className="ls-base-overlay bottom-left">
               <div className="ls-base-whitebox">{renderBasePawns('blue')}</div>
            </div>
            <div className="ls-base-overlay bottom-right">
               <div className="ls-base-whitebox">{renderBasePawns('yellow')}</div>
            </div>
            
            {/* Center Art */}
            <div className="ls-center-art">
               <div className="ls-center-star">★</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Ludo;

