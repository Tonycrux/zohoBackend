const axios = require("axios");
const fs    = require("fs");
const path  = require("path");
require("dotenv").config();

const LIFESPAN = 3600;                          // 1 hour
const TOKEN_URL = `${process.env.ACCOUNTS_URL}/oauth/v2/token`;
const ENV_PATH  = path.resolve(__dirname, "../.env");

function setEnv(k,v){
  let lines = fs.readFileSync(ENV_PATH,"utf8").split(/\r?\n/);
  lines = lines.map(l => l.startsWith(k+"=") ? `${k}=${v}` : l);
  if(!lines.find(l=>l.startsWith(k+"="))) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"));
}

exports.getAccessToken = async () => {
  const issued = Number(process.env.TOKEN_ISSUED_AT||0);
  const age    = Math.floor(Date.now()/1000)-issued;

  if (process.env.ACCESS_TOKEN && age < LIFESPAN-60) {
    return process.env.ACCESS_TOKEN;            // still fresh
  }

  if (!process.env.REFRESH_TOKEN) {
    throw new Error("REFRESH_TOKEN missing");
  }

  const { data } = await axios.post(TOKEN_URL, null, {
    params:{
      grant_type   : "refresh_token",
      client_id    : process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: process.env.REFRESH_TOKEN
    }
  });

  setEnv("ACCESS_TOKEN",    data.access_token);
  setEnv("TOKEN_ISSUED_AT", Math.floor(Date.now()/1000));

  return data.access_token;
};
