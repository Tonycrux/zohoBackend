const express = require("express");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Routers
const ticketRoutes = require("./routers/ticketRouters");
const logRoutes = require("./routers/logRouters");

app.use("/api", ticketRoutes);
//app.use("/api", logRoutes);

app.get("/", (req, res) => res.send("Zoho Desk API Backend"));

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
