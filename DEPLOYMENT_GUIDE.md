# OmeTV Clone - Deployment Guide (Socket.io)

Your architecture has been upgraded to a dedicated **Socket.io** signaling server for maximum global reliability.

## 1. Signaling Server Deployment
Deploy the contents of the `server/` folder to a service that supports persistent WebSockets (e.g., **Railway**, **Render**, **DigitalOcean**, or your own **Node.js VPS**).

- **Folder**: `server/`
- **Build Command**: `npm install`
- **Start Command**: `npm start` (Runs `node server.js`)
- **Port**: The server uses `process.env.PORT` or defaults to `5000`.

## 2. Frontend Deployment (Vercel)
The client remains optimized for Vercel. 
- **IMPORTANT**: Open `client/src/App.jsx` and update `SOCKET_URL` (line 38) with your newly deployed server URL.
- Push the code to your GitHub repo.
- Vercel will build the frontend automatically.

## 3. Why the change?
- **OmeTV Stability**: Dedicated WebSockets avoid the overhead of Supabase Realtime, leading to faster matchmaking.
- **Global Relay (TURN)**: We still use the **OpenRelay** bridge, which bridges users on different networks (WiFi/4G).
- **Auto-Play Fix**: remote videos are optimized for mobile auto-play.

## 4. Local Testing
1. In `server/`: Run `node server.js`
2. In `client/`: Run `npm run dev`
3. Enjoy!
