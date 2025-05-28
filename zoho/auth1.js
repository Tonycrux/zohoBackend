const axios = require("axios");
const fs    = require("fs");
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

let ACCESS_TOKEN;
let TOKEN_ISSUED_AT = 0;

exports.getAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  const age = now - TOKEN_ISSUED_AT;

  if (ACCESS_TOKEN && age < 3600 - 60) {
    return ACCESS_TOKEN;
  }

  if (!process.env.REFRESH_TOKEN) {
    throw new Error("Missing REFRESH_TOKEN");
  }

  const { data } = await axios.post(`${process.env.ACCOUNTS_URL}/oauth/v2/token`, null, {
    params: {
      grant_type: "refresh_token",
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: process.env.REFRESH_TOKEN,
    },
  });

  ACCESS_TOKEN = data.access_token;
  TOKEN_ISSUED_AT = now;

  return ACCESS_TOKEN;
};

