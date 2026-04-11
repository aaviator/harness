import { api, fetchJson } from "./api.js";

export async function checkAuth() {
  try {
    const status = await fetchJson(api.authStatus());
    if (!status.authenticated && !window.location.pathname.endsWith("login.html")) {
      window.location.href = "/login.html";
      return false;
    }
    return status.authenticated;
  } catch {
    if (!window.location.pathname.endsWith("login.html")) {
      window.location.href = "/login.html";
    }
    return false;
  }
}

export async function login(username, password) {
  const res = await fetch(api.authLogin(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Login failed");
  }
  return true;
}

export async function logout() {
  await fetch(api.authLogout(), { method: "POST" }).catch(() => {});
  window.location.href = "/login.html";
}
