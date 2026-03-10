import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const TicTacToe = ({ socket, peerId, isInitiator, onDispose }) => {
    const [board, setBoard] = useState(Array(9).fill(null));
    const [isMyTurn, setIsMyTurn] = useState(isInitiator);
    const [winner, setWinner] = useState(null);

    const mySymbol = isInitiator ? 'X' : 'O';
    const peerSymbol = isInitiator ? 'O' : 'X';

    useEffect(() => {
        if (!socket) return;

        const handleAction = ({ type, index }) => {
            if (type === 'move') {
                setBoard(prev => {
                    const newBoard = [...prev];
                    newBoard[index] = peerSymbol;
                    checkWinner(newBoard);
                    return newBoard;
                });
                setIsMyTurn(true);
            } else if (type === 'rematch') {
                setBoard(Array(9).fill(null));
                setWinner(null);
                setIsMyTurn(isInitiator);
            }
        };

        socket.on('game_action', handleAction);
        return () => socket.off('game_action', handleAction);
    }, [socket, peerSymbol, isInitiator]);

    const checkWinner = (squares) => {
        const lines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6],
        ];
        for (let i = 0; i < lines.length; i++) {
            const [a, b, c] = lines[i];
            if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
                setWinner(squares[a]);
                return;
            }
        }
        if (!squares.includes(null)) setWinner('Draw');
    };

    const handleClick = (index) => {
        if (!isMyTurn || board[index] || winner) return;

        const newBoard = [...board];
        newBoard[index] = mySymbol;
        setBoard(newBoard);
        setIsMyTurn(false);
        checkWinner(newBoard);

        socket.emit('game_action', { type: 'move', index });
    };

    const requestRematch = () => {
        setBoard(Array(9).fill(null));
        setWinner(null);
        setIsMyTurn(isInitiator);
        socket.emit('game_action', { type: 'rematch' });
    };

    return (
        <div className="game-overlay glass">
            <button className="close-btn" onClick={onDispose}><X size={18} /></button>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Tic Tac Toe</h3>
            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '15px' }}>
                {winner ? (winner === 'Draw' ? "It's a Draw!" : `${winner} Wins!`) : (isMyTurn ? "Your Turn" : "Peer's Turn")}
            </p>
            <div className="ttt-board">
                {board.map((cell, i) => (
                    <div
                        key={i}
                        className={`ttt-cell ${!isMyTurn || cell || winner ? 'disabled' : ''}`}
                        onClick={() => handleClick(i)}
                    >
                        {cell}
                    </div>
                ))}
            </div>
            {winner && (
                <button
                    className="btn btn-primary"
                    style={{ marginTop: '20px', width: '100%', padding: '10px' }}
                    onClick={requestRematch}
                >
                    Rematch
                </button>
            )}
        </div>
    );
};

export default TicTacToe;
