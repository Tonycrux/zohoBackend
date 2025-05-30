const express = require("express");
const router = express.Router();
const { getOpenTickets, processOpenTickets, autoAssignTicket, checkDuplicates } = require("../controllers/ticketControllers");


router.get("/tickets", getOpenTickets);
router.get("/tickets/autoreply", processOpenTickets);
router.get("/tickets/autoassign", autoAssignTicket)
router.get("/tickets/checkduplicates", checkDuplicates);


module.exports = router;