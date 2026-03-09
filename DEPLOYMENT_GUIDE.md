# OmeTV Clone - Deployment Guide

This guide will help you get your live video chat and gaming website running for real users.

## 1. Backend Deployment (Required)
Vercel only hosts the frontend. For the "Live" features to work, you MUST host the folder `server` on a platform like **Render**, **Railway**, or **Heroku**.

### Steps for Render:
1. Create a new "Web Service" on Render.
2. Connect your GitHub repository.
3. Set the **Root Directory** to `server`.
4. Build Command: `npm install`
5. Start Command: `node index.js`
6. Once deployed, copy your Render URL (e.g., `https://my-ome-clone.onrender.com`).

## 2. Update Frontend URL
Open `client/src/App.jsx` and replace the placeholder URL with your backend URL:

```javascript
const BACKEND_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : 'https://your-backend-url.onrender.com'; // <--- Update this!
```

## 3. Frontend Deployment (Vercel)
The project is already configured for Vercel. 
- Ensure the **Root Directory** in Vercel is set to `./` (the root of the repo).
- The `vercel.json` in the root will handle building the `client` folder automatically.

## 4. Connectivity (WebRTC)
I have added **Google STUN Servers** to ensure users can connect across different home and mobile networks. For even better reliability, you may consider adding a **TURN server** (like Twilio or Metered.ca) in the future.

## 5. HD Video
Video is now set to **1280x720 (HD)** by default. Users will see each other in high definition if their cameras support it.
