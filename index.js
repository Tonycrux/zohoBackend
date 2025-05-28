const { getAccessToken } = require('./zoho/auth1');

(async () => {
  const token = await getAccessToken();
  // console.log("Your access token is:", token);
})();
