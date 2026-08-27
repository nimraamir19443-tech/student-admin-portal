# CampusDesk Frontend

This folder is deployed as a static site on Cloudflare Pages.

## Cloudflare Pages settings

- Production branch: `main`
- Root directory: `frontend`
- Build command: leave empty
- Build output directory: `.`

Before deploying, edit `config.js` and set `API_BASE_URL` to the public Railway backend URL, for example:

```js
window.API_BASE_URL = "https://your-app.up.railway.app";
```

The Railway backend must allow requests from the Cloudflare Pages domain. The backend already enables CORS.
