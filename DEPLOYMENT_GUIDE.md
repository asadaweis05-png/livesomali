# OmeTV Clone - Deployment Guide (Serverless)

Good news! You **no longer need** to host a separate backend server. The entire app now runs using **Supabase Realtime**.

## 1. Supabase Configuration (Already Done)
I have already connected your Supabase project (`qvjwnpcwerdfupduqxmb`) using the API key you provided. 

**IMPORTANT**: Make sure **Realtime** is enabled for your project in the Supabase Dashboard:
- Go to **Database > Replication**.
- Ensure the `supabase_realtime` publication has the tables you need (though for Presence/Broadcast, this is usually enabled by default on the project).

## 2. Frontend Deployment (Vercel)
The project is optimized for Vercel. 
- Just push the code to your GitHub repo.
- Vercel will build everything automatically using the `vercel.json` file I created.
- **Root Directory**: Keep it as `./` (the root of your repo).

## 3. How to Use
- **Matchmaking**: Click "Next" to find a stranger. 
- **Live Video**: Requires HTTPS (Vercel provides this) or Localhost.
- **HD Video**: Now enabled by default for better quality.
- **Games**: Once matched, click "Tic Tac Toe" to play together.

## 4. Troubleshooting Mobile
- **Camera Access**: Phones will only allow camera access if the site is served over **HTTPS** (e.g., your Vercel URL).
- **Auto-play**: I've added fixes to ensure the remote video starts playing automatically on mobile devices.
- **Connection**: If the status says "Finding match..." for a long time, it means you are the only one online. Open the link on a second phone to test the matching!
