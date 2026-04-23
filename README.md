# VoiceTranslationCallingApp

Real-time voice calling app with live audio, speech translation, translated voice playback, and optional voice cloning.

## Stack

- `client/`: React frontend for Netlify
- `server/`: Express + Socket.IO backend for Railway
- WebRTC for direct audio
- MongoDB for users, contacts, and call history

## Environment Variables

### Backend on Railway

Use [`server/.env.example`](/Users/zotishchandra/Desktop/VoiceTranslationCallingApp/server/.env.example) as the template.

Required:

- `PORT=5000`
- `JWT_SECRET=your_jwt_secret_here`
- `MONGODB_URI=your_mongodb_connection_string`
- `FRONTEND_URL=https://your-netlify-site.netlify.app`

Optional:

- `ELEVENLABS_API_KEY=your_elevenlabs_api_key`

If you need more than one frontend origin, set:

- `FRONTEND_URL=https://site-one.netlify.app,https://site-two.netlify.app`

### Frontend on Netlify

Use [`client/.env.example`](/Users/zotishchandra/Desktop/VoiceTranslationCallingApp/client/.env.example) or [`client/.env.production`](/Users/zotishchandra/Desktop/VoiceTranslationCallingApp/client/.env.production).

Required:

- `REACT_APP_BACKEND_URL=https://your-railway-app.up.railway.app`

## Local Run

Backend:

```bash
cd server
npm install
npm run dev
```

Frontend:

```bash
cd client
npm install
npm start
```

## Manual Test Flow

1. Create two users with different languages.
2. Add each other as contacts.
3. Open the app in two separate browser sessions.
4. Start a call from one side.
5. Allow microphone access on both sides.
6. Accept the call and test live audio plus translated playback.
