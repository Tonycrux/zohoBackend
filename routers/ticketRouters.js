const express = require("express");
const router = express.Router();
const { getOpenTicketsLimited, getTicketThreadsPreview, processOpenTickets, getAllTeams, autoAssignTicket, checkDuplicates } = require("../controllers/ticketControllers");


router.get("/open-tickets", getOpenTicketsLimited);
router.get("/tickets/:ticketId/threads-preview", getTicketThreadsPreview);
router.get("/tickets/process", processOpenTickets);
router.get("/teams", getAllTeams);
router.get("/auto-assign", autoAssignTicket)
router.get("/check-duplicates", checkDuplicates);


module.exports = router;