import React, { useState, useEffect } from 'react';
import './Ludo.css';

// --- LUDO KING ARCHITECTURE ---
const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];
const PATH_LENGTH = 52;
const HOME_LENGTH = 5;

const COLORS = ['red', 'green', 'yellow', 'blue'];
const OFFSETS = { red: 0, green: 13, yellow: 26, blue: 39 };

const INITIAL_POSITIONS = {
  red: [-1, -1, -1, -1],
  green: [-1, -1, -1, -1],
  yellow: [-1, -1, -1, -1],
  blue: [-1, -1, -1, -1]
};

const Ludo = ({ socket, peerId, isInitiator, onDispose }) => {
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [visualPositions, setVisualPositions] = useState(INITIAL_POSITIONS);
  const [turn, setTurn] = useState('red');
  const [diceRoll, setDiceRoll] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [hasRolled, setHasRolled] = useState(false);
  const [animating, setAnimating] = useState(false);

  const myColor = isInitiator ? 'red' : 'yellow';
  const isMyTurn = turn === myColor;

  useEffect(() => {
    if (!socket) return;
    const handleAction = (data) => {
      if (data.action === 'roll') {
        animateDice(data.value);
      } else if (data.action === 'move') {
        animateMove(data.color, data.from, data.to, data.positions, data.nextTurn, false);
      }
    };
    socket.on('game_action', handleAction);
    return () => socket.off('game_action', handleAction);
  }, [socket, positions]);

  const rollDice = () => {
    if (!isMyTurn || hasRolled || animating || isRolling) return;
    const val = Math.floor(Math.random() * 6) + 1;
    animateDice(val);
    socket.emit('game_action', { action: 'roll', value: val, color: myColor });
  };

  const animateDice = (val) => {
    setIsRolling(true);
    let count = 0;
    const itv = setInterval(() => {
      setDiceRoll(Math.floor(Math.random() * 6) + 1);
      count++;
      if (count > 8) {
        clearInterval(itv);
        setDiceRoll(val);
        setIsRolling(false);
        setHasRolled(true);
        checkValidMoves(val);
      }
    }, 60);
  };

  const checkValidMoves = (val) => {
    let possibleMove = false;
    positions[myColor].forEach(p => {
      if (p === -1 && val === 6) possibleMove = true;
      else if (p >= 0 && p + val <= PATH_LENGTH + HOME_LENGTH) possibleMove = true;
    });
    if (!possibleMove) setTimeout(() => passTurn(positions), 1200);
  };

  const passTurn = (newPositions) => {
    const nextTurn = turn === 'red' ? 'yellow' : 'red';
    setTurn(nextTurn);
    setDiceRoll(null);
    setHasRolled(false);
    socket.emit('game_action', { action: 'move', positions: newPositions, nextTurn, color: myColor });
  };

  const getGlobalPos = (color, localPos) => {
    if (localPos < 0 || localPos >= PATH_LENGTH) return null;
    return (localPos + OFFSETS[color]) % PATH_LENGTH;
  };

  const animateMove = async (color, index, targetPos, finalPositions, nextTurn, isEmit = true) => {
    setAnimating(true);
    const startPos = positions[color][index];
    const updateVisual = (c, idx, pos) => {
      setVisualPositions(prev => {
        const next = { ...prev };
        next[c] = [...next[c]];
        next[c][idx] = pos;
        return next;
      });
    };

    if (startPos === -1) {
      updateVisual(color, index, 0);
      await new Promise(r => setTimeout(r, 200));
    } else {
      for (let i = startPos + 1; i <= targetPos; i++) {
        updateVisual(color, index, i);
        setAnimating(i); // Use for hopping class
        await new Promise(r => setTimeout(r, 200));
      }
    }

    setPositions(finalPositions);
    setVisualPositions(finalPositions);
    if (isEmit) socket.emit('game_action', { action: 'move', positions: finalPositions, nextTurn, color, from: startPos, to: targetPos });
    
    setDiceRoll(null);
    setHasRolled(false);
    setTurn(nextTurn);
    setAnimating(false);
  };

  const movePawn = (index) => {
    if (!isMyTurn || !hasRolled || animating) return;
    const currentLocalPos = positions[myColor][index];
    let targetLocalPos = currentLocalPos;
    if (currentLocalPos === -1) {
      if (diceRoll === 6) targetLocalPos = 0;
      else return;
    } else {
      targetLocalPos = currentLocalPos + diceRoll;
      if (targetLocalPos > PATH_LENGTH + HOME_LENGTH) return;
    }

    const newPositions = JSON.parse(JSON.stringify(positions));
    newPositions[myColor][index] = targetLocalPos;

    let hitOpponent = false;
    const targetGlobal = getGlobalPos(myColor, targetLocalPos);
    if (targetGlobal !== null && !SAFE_ZONES.includes(targetGlobal)) {
      COLORS.forEach(c => {
        if (c !== myColor) {
          newPositions[c].forEach((oppPos, i) => {
            if (getGlobalPos(c, oppPos) === targetGlobal) {
              newPositions[c][i] = -1;
              hitOpponent = true;
            }
          });
        }
      });
    }

    const nextTurn = (diceRoll === 6 || hitOpponent) ? myColor : (myColor === 'red' ? 'yellow' : 'red');
    animateMove(myColor, index, targetLocalPos, newPositions, nextTurn, true);
  };

  const getDiceFace = (val) => {
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    return faces[val - 1] || '🎲';
  };

  // 15x15 Ludo King Layout
  const GLOBAL_PATH_COORDS = [
    [6,1], [6,2], [6,3], [6,4], [6,5],
    [5,6], [4,6], [3,6], [2,6], [1,6], [0,6], [0,7], [0,8],
    [1,8], [2,8], [3,8], [4,8], [5,8], [6,9], [6,10], [6,11], [6,12], [6,13], [6,14], [7,14], [8,14],
    [8,13], [8,12], [8,11], [8,10], [8,9], [9,8], [10,8], [11,8], [12,8], [13,8], [14,8], [14,7], [14,6],
    [13,6], [12,6], [11,6], [10,6], [9,6], [8,5], [8,4], [8,3], [8,2], [8,1], [8,0], [7,0], [6,0]
  ];

  const HOME_COORDS = {
    red:    [[7,1], [7,2], [7,3], [7,4], [7,5]],
    green:  [[1,7], [2,7], [3,7], [4,7], [5,7]],
    yellow: [[7,13], [7,12], [7,11], [7,10], [7,9]],
    blue:   [[13,7], [12,7], [11,7], [10,7], [9,7]]
  };

  const renderGrid = () => {
    const cells = [];
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        let cls = 'ludo-cell';
        let star = false;
        let arrow = null;

        if (r < 6 && c < 6) cls += ' home-box red-area';
        else if (r < 6 && c > 8) cls += ' home-box green-area';
        else if (r > 8 && c < 6) cls += ' home-box blue-area';
        else if (r > 8 && c > 8) cls += ' home-box yellow-area';
        else if (r >= 6 && r <= 8 && c >= 6 && c <= 8) cls += ' center-home';
        else {
          cls += ' track-cell';
          if (r === 7 && c > 0 && c < 6) cls += ' path-red';
          if (r === 7 && c > 8 && c < 14) cls += ' path-yellow';
          if (c === 7 && r > 0 && r < 6) cls += ' path-green';
          if (c === 7 && r > 8 && r < 14) cls += ' path-blue';

          if ((r === 6 && c === 1) || (r === 1 && c === 8) || (r === 8 && c === 13) || (r === 13 && c === 6)) {
              cls += ` dark-${r===6?'red':r===1?'green':r===8?'yellow':'blue'}`;
              arrow = r===6?'→':r===1?'↓':r===8?'←':'↑';
          }
          if ((r === 2 && c === 6) || (r === 6 && c === 12) || (r === 12 && c === 8) || (r === 8 && c === 2)) star = true;
        }

        cells.push(
          <div key={`${r}-${c}`} className={cls}>
            {star && <span className="star-icon">☆</span>}
            {arrow && <span className="board-arrow">{arrow}</span>}
            {renderPawnsAt(r, c)}
          </div>
        );
      }
    }
    return cells;
  };

  const renderPawnsAt = (r, c) => {
    let pawns = [];
    COLORS.forEach(color => {
      visualPositions[color].forEach((pos, idx) => {
        let pr, pc;
        if (pos === -1) return;
        if (pos < PATH_LENGTH) {
          let g = getGlobalPos(color, pos);
          if (g !== null) { pr = GLOBAL_PATH_COORDS[g][0]; pc = GLOBAL_PATH_COORDS[g][1]; }
        } else {
          let h = pos - PATH_LENGTH;
          pr = HOME_COORDS[color][h][0]; pc = HOME_COORDS[color][h][1];
        }
        if (pr === r && pc === c) {
          pawns.push(
            <div key={`${color}-${idx}`} 
              className={`ls-pawn ls-${color} ${animating ? 'ls-hopping' : ''}`}
              onClick={() => color === myColor && movePawn(idx)}
            />
          );
        }
      });
    });
    return pawns;
  };

  const renderBase = (color) => {
    return (
      <div className="ls-base-inner">
        {[0,1,2,3].map(i => (
          <div key={i} className={`parking-spot ls-spot-${color}`}>
            {visualPositions[color][i] === -1 && (
              <div className={`ls-pawn ls-${color}`} onClick={() => color === myColor && movePawn(i)} />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="game-overlay ls-window">
      <button className="close-btn" onClick={onDispose}>✕</button>
      <div className="ls-main">
        <div className="ls-sidebar">
          {/* Top Opponent Dice */}
          <div className={`ls-dice-box ${turn === (myColor==='red'?'yellow':'red') && !hasRolled ? '' : ''}`} style={{opacity: turn === myColor ? 0.3 : 1}}>
             <div className="pawn-indicator" style={{background: myColor==='red'?'#ffeb3b':'#f44336'}} />
             <div className="ls-dice-val">{turn !== myColor && diceRoll ? getDiceFace(diceRoll) : '🎲'}</div>
          </div>

          <div className="ls-logs" style={{height: '100px', pointerEvents: 'none'}}>
             {logs.map((l, i) => <div key={i} className="ls-log-line">{l}</div>)}
          </div>

          {/* Bottom My Dice */}
          <div className={`ls-dice-box ${isMyTurn && !hasRolled ? 'shake-ready' : ''}`} onClick={rollDice} style={{opacity: isMyTurn ? 1 : 0.3}}>
             <div className="pawn-indicator" style={{background: myColor==='red'?'#f44336':'#ffeb3b'}} />
             <div className="ls-dice-val">{isMyTurn && diceRoll ? getDiceFace(diceRoll) : '🎲'}</div>
          </div>
        </div>

        <div className="ls-board-container">
          <div className="ls-board">
            {renderGrid()}
            <div className="ls-base-overlay top-left red-area"><div className="ls-label" style={{top: -25}}>Opponent</div>{renderBase('red')}</div>
            <div className="ls-base-overlay top-right green-area">{renderBase('green')}</div>
            <div className="ls-base-overlay bottom-left blue-area"><div className="ls-label" style={{bottom: -25}}>You</div>{renderBase('blue')}</div>
            <div className="ls-base-overlay bottom-right yellow-area">{renderBase('yellow')}</div>
            
            <div className="ls-center-art">
               <div className="ls-tri ls-tri-top"></div>
               <div className="ls-tri ls-tri-right"></div>
               <div className="ls-tri ls-tri-bottom"></div>
               <div className="ls-tri ls-tri-left"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Ludo;
