# OmeTV Architecture - Final Production Deployment

Your platform is now configured for a professional, global rollout with a dedicated **Railway** backend and **Vercel** frontend.

## 1. Backend (Railway)
The `server/` folder is designed for instant deployment.

- **URL**: `https://livesomali-production.up.railway.app`
- **Root Directory**: Set this to `/server` in Railway settings (or just deploy the whole repo).
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Port**: Handled automatically by Railway via `process.env.PORT`.

## 2. Frontend (Vercel)
The `client/` folder is ready to connect to your Railway URL.

1. I have updated `client/src/App.jsx` with your Railway URL.
2. Push your code to GitHub.
3. Vercel will build the frontend automatically.

## 3. Global Connection Proofing
- **NAT Traversal**: We use the **OpenRelay** community bridge to ensure users on different ISPs (Cellular vs WiFi) can connect.
- **Bitrate Limit**: Capped at **500kbps** to prevent lag on mobile networks.
- **Codec**: Forced **VP8** for universal compatibility on all phones and browsers.
- **Auto-Play**: Includes detection and manual play recovery for mobile browsers.

## 4. Troubleshooting
- If the screen is black, look for the **"Tap to Start Video"** button.
- If it says **"Searching..."**, you are waiting for another user to join the lobby.
- Check the **Railway Logs** in your dashboard to see real-time matching activity.
