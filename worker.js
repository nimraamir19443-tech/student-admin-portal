export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pageRoutes = {
      "/": "/index.html",
      "/login": "/login.html",
      "/signup": "/signup.html",
      "/admin": "/admin.html",
      "/student-portal": "/student-portal.html",
      "/profile": "/profile.html"
    };

    if (pageRoutes[url.pathname]) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pageRoutes[url.pathname];
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
