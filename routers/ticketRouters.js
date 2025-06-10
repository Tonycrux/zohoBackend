const express = require("express");
const router = express.Router();
const { getOpenTickets, processOpenTickets, autoAssignTicket, checkDuplicates, checkDuplicatesByTeam } = require("../controllers/ticketControllers");


router.get("/tickets", getOpenTickets);
// router.get("/tickets/autoreply", processOpenTickets);
// router.get("/tickets/autoassign", autoAssignTicket)
router.get("/tickets/checkduplicates", checkDuplicates);
router.get("/tickets/checkduplicatesbyteam", checkDuplicatesByTeam)


module.exports = router;