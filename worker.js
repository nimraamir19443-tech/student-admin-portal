export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/config.js") {
      return new Response(
        'window.API_BASE_URL = "https://student-admin-portal-production.up.railway.app";',
        { headers: { "Content-Type": "application/javascript; charset=UTF-8" } }
      );
    }

    const pageRoutes = {
      "/": "/",
      "/login": "/login",
      "/signup": "/signup",
      "/admin": "/admin",
      "/student-portal": "/student-portal",
      "/profile": "/profile"
    };

    if (pageRoutes[url.pathname]) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pageRoutes[url.pathname];
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
