export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
