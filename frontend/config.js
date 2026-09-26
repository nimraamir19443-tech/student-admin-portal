(() => {
	const isLocalDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
	window.API_BASE_URL = isLocalDevelopment ? "" : "https://student-admin-portal-production.up.railway.app";
})();
