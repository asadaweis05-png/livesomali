import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const TicTacToe = ({ channel, peerId, isInitiator, onDispose }) => {
    const [board, setBoard] = useState(Array(9).fill(null));
    const [isMyTurn, setIsMyTurn] = useState(isInitiator);
    const [winner, setWinner] = useState(null);

    const mySymbol = isInitiator ? 'X' : 'O';
    const peerSymbol = isInitiator ? 'O' : 'X';

    useEffect(() => {
        const sub = channel.on('broadcast', { event: 'game_move' }, ({ payload }) => {
            if (payload.to === 'all' || payload.to === channel.presenceState()[Object.keys(channel.presenceState())[0]][0].presence_ref) {
                // Simplify for now: if message is received and it's move type
            }
            if (payload.type === 'move') {
                const newBoard = [...board];
                newBoard[payload.index] = peerSymbol;
                setBoard(newBoard);
                setIsMyTurn(true);
                checkWinner(newBoard);
            }
        });

        return () => { }; // Supabase handles cleanup via App.jsx channel ref
    }, [board]);

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

        channel.send({
            type: 'broadcast',
            event: 'game_move',
            payload: { to: peerId, type: 'move', index }
        });
    };

    return (
        <div className="game-overlay glass">
            <button className="close-btn" onClick={onDispose}><X size={18} /></button>
            <h3 style={{ margin: '0 0 10px 0' }}>Tic Tac Toe</h3>
            <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                {winner ? (winner === 'Draw' ? "It's a Draw!" : `${winner} Wins!`) : (isMyTurn ? "Your Turn" : "Peer's Turn")}
            </p>
            <div className="ttt-board">
                {board.map((cell, i) => (
                    <div
                        key={i}
                        className={`ttt-cell ${!isMyTurn || cell ? 'disabled' : ''}`}
                        onClick={() => handleClick(i)}
                    >
                        {cell}
                    </div>
                ))}
            </div>
            {winner && (
                <button
                    className="btn btn-primary"
                    style={{ marginTop: '20px', width: '100%' }}
                    onClick={() => {
                        setBoard(Array(9).fill(null));
                        setWinner(null);
                        setIsMyTurn(isInitiator);
                    }}
                >
                    Rematch
                </button>
            )}
        </div>
    );
};

export default TicTacToe;
