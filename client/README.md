# VoiceTranslate Frontend

React frontend for the VoiceTranslationCallingApp.

## Environment

Create `client/.env` locally or set the same value in Netlify:

```env
REACT_APP_BACKEND_URL=https://your-railway-app.up.railway.app
```

If `REACT_APP_BACKEND_URL` is missing, the app attempts local backend auto-detection on `:5001` and `:5000`.

## Scripts

### `npm start`

Runs the frontend locally.

### `npm run build`

Builds the production bundle for Netlify.

### `npm test`

Runs the frontend test suite once.

## Netlify Settings

- Base directory: `client`
- Build command: `npm run build`
- Publish directory: `build`
