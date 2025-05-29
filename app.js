const express = require("express");
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();
const port = process.env.PORT || 3000;

// app.use((req, res, next) => {
//   res.setHeader("X-Powered-By", "ZohoDesk-Backend");
//   res.setHeader("Access-Control-Allow-Origin", "*");
//   res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//   res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
//   next();
// });


// Routers
const ticketRoutes = require("./routers/ticketRouters");
const logRoutes = require("./routers/logRouters");

app.use("/api", ticketRoutes);
//app.use("/api", logRoutes);

app.get("/", (req, res) => res.send("Zoho Desk API Backend"));

// app.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
// });

module.exports = app; // <-- export the app