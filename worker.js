export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/config.js") {
      return new Response(
        'window.API_BASE_URL = "https://student-admin-portal-production.up.railway.app";',
        {
          headers: {
            "Content-Type": "application/javascript; charset=UTF-8",
            "Cache-Control": "no-store"
          }
        }
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
      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
      const response = new Response(assetResponse.body, assetResponse);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const fallbackResponse = await env.ASSETS.fetch(request);
    const response = new Response(fallbackResponse.body, fallbackResponse);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
};
