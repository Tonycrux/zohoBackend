const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const ENV_PATH = path.resolve(__dirname, "../.env");
const TOKEN_URL = `${process.env.ACCOUNTS_URL}/oauth/v2/token`;
const TOKEN_LIFESPAN = 3600; // seconds

function updateEnvVariable(key, value) {
  const envContent = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  const newContent = envContent.map((line) =>
    line.startsWith(`${key}=`) ? `${key}=${value}` : line
  );

  if (!newContent.some((line) => line.startsWith(`${key}=`))) {
    newContent.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, newContent.join("\n"));
}

function isTokenExpired() {
  const issuedAt = Number(process.env.TOKEN_ISSUED_AT);
  if (!issuedAt || isNaN(issuedAt)) return true;

  const now = Math.floor(Date.now() / 1000);
  const age = now - issuedAt;

  return age >= TOKEN_LIFESPAN;
}

async function getAccessToken() {
  const token = process.env.ACCESS_TOKEN;
  const tokenValid = token && token.length > 20 && !isTokenExpired();

  if (tokenValid) {
    console.log("✅ Using valid cached access token");
    return token;
  }

  try {
    const res = await axios.post(TOKEN_URL, null, {
      params: {
        grant_type: "authorization_code",
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code: process.env.AUTHORIZATION_CODE,
        redirect_uri: process.env.REDIRECT_URI,
      },
    });

    console.log("🔓 AUTH_CODE response:", res.data);

    const access = res.data.access_token;
    const refresh = res.data.refresh_token;
    const now = Math.floor(Date.now() / 1000);

    if (!access) {
      console.error("❌ No access_token in AUTH_CODE response.");
      return null;
    }

    updateEnvVariable("ACCESS_TOKEN", access);
    updateEnvVariable("REFRESH_TOKEN", refresh);
    updateEnvVariable("TOKEN_ISSUED_AT", now);

    return access;

  } catch (error) {
    const errCode = error.response?.data?.error;
    console.warn("⚠️ AUTH_CODE error:", errCode);

    if (errCode === "invalid_code" || errCode === "invalid_grant") {
      return await refreshAccessToken();
    }

    console.error("❌ Unknown auth error:", error.response?.data || error.message);
    return null;
  }
}


async function refreshAccessToken() {
  const refresh = process.env.REFRESH_TOKEN;

  if (!refresh || refresh.length < 10) {
    throw new Error("❌ No refresh token in .env");
  }

  const res = await axios.post(TOKEN_URL, null, {
    params: {
      grant_type: "refresh_token",
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: refresh,
    },
  });

  const newAccess = res.data.access_token;
  const now = Math.floor(Date.now() / 1000);

  updateEnvVariable("ACCESS_TOKEN", newAccess);
  updateEnvVariable("TOKEN_ISSUED_AT", now);

  console.log("🔁 Access token refreshed");
  return newAccess;
}

module.exports = { getAccessToken };
