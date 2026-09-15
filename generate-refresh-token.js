const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

const redirectUri = "http://localhost:5000/oauth2callback";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);

  if (url.pathname !== "/oauth2callback") {
    res.end("Waiting for Google OAuth callback...");
    return;
  }

  const code = url.searchParams.get("code");

  if (!code) {
    res.end("Authorization failed.");
    return;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    const tokens = await response.json();

    if (!tokens.refresh_token) {
      console.log(tokens);
      throw new Error("No refresh token returned.");
    }

    console.log("\n========================================");
    console.log("GOOGLE REFRESH TOKEN:");
    console.log(tokens.refresh_token);
    console.log("========================================\n");

    res.end("Success! Refresh token generated. Check your PowerShell window.");
    server.close();
  } catch (error) {
    console.error("Token exchange failed:", error.message);
    res.end("Token generation failed. Check PowerShell.");
    server.close();
  }
});

server.listen(5050, () => {
  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for Google authorization...\n");
});
