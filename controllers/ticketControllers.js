
const { getAllOpenTickets, getLastTwoMessages, sendReplyAndClose, getLastMessage, detectAndCloseDuplicateTickets, closeDuplicatesForEmail, getAllDuplicatesWithDetails, closeTicketsByIds } = require("../services/zohoService");
const { analyzeMessages, classifyDepartment } = require("../services/aiService");
//const log = require("../utils/logger");
const { getAccessToken } = require("../zoho/auth1");
const axios = require("axios");




let csToggle = 0;

const LIVE_MODE = false; 

const AGENT_IDS = {
  cs: ["988907000000774001", "988907000000772035"],
  csDept: "988907000000744735",
  hsDept: "988907000006857049",
  hsAgent: "988907000000777001",
};

// REAL TEAM IDS
const TEAM_IDS = {
  "social media": "988907000006857031",
  "bizdev": "988907000006857007",
  "noc team": "988907000006569047",
  "account": "988907000001187105",
  "field service": "988907000001187019",
  "retention team": "988907000000767492",
  "sales team": "988907000000767478",
  "quality assurance": "988907000000744749",
  "customer service": "988907000000744735"
};

// TEST DETAILS
// const TEAM_IDS = {
//   "account": "1145249000000516001",
//   "customer service": "1145249000000516015"
// }

exports.getOpenTickets = async (req, res) => {
  const count = parseInt(req.query.count || "10");
  try {
    const tickets = await getAllOpenTickets(count);
    res.json({ success: true, data: tickets });
  } catch (err) {
    // console.error("Failed to fetch tickets:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.processOpenTickets = async (req, res) => {
  // console.log("Processing open tickets...");
  try {
    const count   = parseInt(req.query.count || "10");
    // log.info("Ticket batch started", { count });

    const tickets = await getAllOpenTickets(count);
    const results = [];

    for (const ticket of tickets) {
      //log.info("Processing ticket", { ticketId: ticket.id, subject: ticket.subject });
      //  if (ticket.email.toLowerCase() !== "tmetiko@gmail.com") {
      //   results.push({
      //     ticketId : ticket.id,
      //     subject  : ticket.subject,
      //     email    : ticket.email,
      //     status   : ticket.status,
      //     decision : "Skipped – Not target email",
      //     sentiment: "N/A",
      //     reply    : ""
      //   });
      //   continue;
      // }

      try {
        const messages = await getLastTwoMessages(ticket.id);

        // Skip if any attachment
        if (messages.some(m => m.hasAttach)) {
          //log.warn("📎 Attachment detected – skipping", { ticketId: ticket.id });
          results.push({
            ticketId : ticket.id,
            subject  : ticket.subject,
            email    : ticket.email,
            status   : ticket.status,
            decision : "Skip",
            sentiment: "Unknown",
            reply    : "",
            reason   : "Attachment present"
          });
          continue;
        }

        /* ---------- AI analysis ---------- */
        const analysis = await analyzeMessages(messages);

        if (analysis.decision.toLowerCase() === "respond") {
          // Try to send reply + close
          try {
            await sendReplyAndClose(ticket.id, analysis.reply, ticket.email);

            // log.info("Replied & closed", {
            //   ticketId : ticket.id,
            //   sentiment: analysis.sentiment
            // });

            results.push({
              ticketId : ticket.id,
              subject  : ticket.subject,
              email    : ticket.email,
              status   : "Closed",
              decision : "Replied",
              sentiment: analysis.sentiment,
              reply    : analysis.reply
            });
          } catch (apiErr) {
            // log.error("Zoho sendReply error", {
            //   ticketId : ticket.id,
            //   error    : apiErr.message
            // });

            results.push({
              ticketId : ticket.id,
              subject  : ticket.subject,
              email    : ticket.email,
              status   : ticket.status,
              decision : "Error",
              sentiment: analysis.sentiment,
              reply    : analysis.reply,
              error    : apiErr.message
            });
          }
        } else {
          // Decision = Skip by AI
         // log.warn("AI decided to Skip", { ticketId: ticket.id });

          results.push({
            ticketId : ticket.id,
            subject  : ticket.subject,
            email    : ticket.email,
            status   : ticket.status,
            decision : "Skip",
            sentiment: analysis.sentiment,
            reply    : "",
            reason   : "AI decided to Skip"
          });
        }
      } catch (err) {
        //log.error("Ticket processing error", { ticketId: ticket.id, error: err.message });

        results.push({
          ticketId : ticket.id,
          subject  : ticket.subject,
          email    : ticket.email,
          status   : ticket.status,
          decision : "Error",
          sentiment: "Unknown",
          reply    : "",
          error    : err.message
        });
      }
    }

    //log.info("Batch complete", { processed: results.length });
    res.json({ success: true, processed: results });
  } catch (err) {
   // log.error("Fatal controller error", { error: err.message });
    res.status(500).json({ success: false, message: "Unhandled error", error: err.message });
  }
};


exports.autoAssignTicket = async (req, res) => {
  const count = parseInt(req.query.count || "10");
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
    "Content-Type": "application/json"
  };

  let tickets = [];

  // Step 1: Fetch unassigned open tickets
  try {
    const resp = await axios.get(`https://desk.zoho.com/api/v1/tickets`, {
      headers,
      params: {
        status: "Open",
        limit: parseInt(count),
        include: "contacts,assignee"
      }
    });
    tickets = (resp.data.data || []).filter(t => !t.assigneeId);
    // console.log(`🎯 Fetched ${tickets.length} unassigned open tickets`);
  } catch (err) {
    //log.error(err);
    return res.status(500).json({ success: false, message: "Failed to fetch tickets." });
  }

  const results = [];
  // console.log(`Found ${tickets.length} unassigned open tickets.`);
  for (const t of tickets) {
    // const email = t?.contact?.email || "";
    // if (email.toLowerCase() !== "tmetiko@gmail.com"){
    //   results.push({
    //     ticketId: t.id,
    //     subject : t.subject,
    //     email,
    //     decision: "Skipped: Not target email"
    //   });
    //   continue;
    // }
    try {
      const subject = t.subject || "";
      const message = await getLastMessage(t.id);

      const resteam = await classifyDepartment(subject, message);
      const team = resteam?.toLowerCase()

      //const dept = ai.department?.toLowerCase();
      // console.log("here is the respose here", team);
      // console.log(`🔍 Ticket ${t.id} classified as:`, team);
      if (!team || team === "unknown" || (!TEAM_IDS[team] && team !== "customer service" && team !== "hotspot and fibre")) {
        //log.warn("Skipping unclassified ticket", { ticketId: t.id });
        results.push({
          ticketId: t.id,
          subject,
          message,
          assignee: t.assignee,
          decision: "Skip",
          reason: "Unclear classification"
        });
        continue;
      }

      const replyPayload = {
        content: `Thank you for reaching out. We have forwarded your message to the appropriate department.\n\nRegards,\nTizeti Support`,
        channel: "EMAIL",
        contentType: "plainText",
        fromEmailAddress: process.env.FROM_EMAIL,
        to: t.contact.email,
        direction: "out"
      };

      const assignPayload = {};

      if (team === "customer service") {
        const agent = AGENT_IDS.cs[csToggle++ % 2];
        assignPayload.teamId = AGENT_IDS.csDept;
        assignPayload.assigneeId = agent;
      } else if (team === "hotspot and fibre") {
        assignPayload.teamId = AGENT_IDS.hsDept;
        assignPayload.assigneeId = AGENT_IDS.hsAgent;
      } else {
        assignPayload.teamId = TEAM_IDS[team];
      }

      if (LIVE_MODE) {
        await axios.patch(`https://desk.zoho.com/api/v1/tickets/${t.id}`, assignPayload, { headers });
        await axios.post(`https://desk.zoho.com/api/v1/tickets/${t.id}/sendReply`, replyPayload, { headers });
        
        //log.info("Assigned ticket", { ticketId: t.id, to: team });
        results.push({
          ticketId: t.id,
          subject,
          assignedTo: team,
          status: "Assigned"
        });

      } else {
        // Testing mode: log what would happen
        results.push({
          ticketId: t.id,
          subject,
          wouldAssignTo: team,
          message,
          assigneeId: assignPayload.assigneeId || "No assignee coz not CS or HS",
          teamId: assignPayload.teamId,
          decision: "Test Only"
        });
      }

    } catch (err) {
      //log.error("Error processing ticket", { ticketId: t.id, err: err.message });
      // console.log("Error processing ticket", { ticketId: t.id, err: err.message });
      results.push({
        ticketId: t.id,
        subject: t.subject,
        decision: "Error",
        error: err.message
      });
    }
  }

  res.json({ success: true, processed: results.length, results });
};


exports.checkDuplicates = async (req, res) => {
  try {
    const timeInSeconds = parseInt(req.query.time);
    if (isNaN(timeInSeconds)) {
      return res.status(400).json({ success: false, message: "Invalid time parameter" });
    }

    const { all, headers } = await detectAndCloseDuplicateTickets(timeInSeconds);

    // Send to only a target email
    // const targetEmail = "tmetiko@gmail.com";
    // const filteredTickets = all.filter(ticket => ticket.email.toLowerCase() === targetEmail.toLowerCase());

    // Step 1: Group by unique key (subject + email + content)
    const grouped = new Map();

    for (const ticket of all) {
      const key = `${ticket.subject}|${ticket.email}|${ticket.content}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          subject: ticket.subject,
          email: ticket.email,
          all: [],
        });
      }
      grouped.get(key).all.push(ticket);
    }

    // Step 2: Process each group into original + duplicates
    const groupedDuplicates = [];

    for (const [_, group] of grouped.entries()) {
      const sorted = group.all.sort((a, b) => a.createdTime - b.createdTime);
      const original = sorted[0];
      const dupsOnly = sorted.slice(1); // exclude the original

      if (dupsOnly.length > 0) {
        groupedDuplicates.push({
          subject: group.subject,
          email: group.email,
          originalTicketId: original.id,
          originalCreatedTime: original.createdTime,
          duplicates: dupsOnly.map(d => ({
            id: d.id,
            createdTime: d.createdTime,
          })),
          duplicateCount: dupsOnly.length
        });

        // Only close in live mode if duplicates exist
        if (LIVE_MODE) {
          for (const dup of dupsOnly) {
            await axios.patch(`https://desk.zoho.com/api/v1/tickets/${dup.id}`, { status: "Closed" }, { headers });
          }
        }
      }
    }

    // Step 4: Build time range from all ticket times
    const allTimes = all.map(d => d.createdTime.getTime());
    const timeRange = allTimes.length
      ? {
          earliest: new Date(Math.min(...allTimes)).toISOString(),
          latest: new Date(Math.max(...allTimes)).toISOString()
        }
      : { earliest: null, latest: null };

    // Step 5: Build final result
    const result = {
      success: true,
      mode: LIVE_MODE ? "live" : "test",
      totalDuplicateTickets: groupedDuplicates.reduce((sum, g) => sum + g.duplicateCount, 0),
      duplicatesTimeRange: timeRange,
      groupedDuplicates,
      closed: LIVE_MODE
        ? groupedDuplicates.flatMap(g => g.duplicates.map(d => d.id))
        : []
    };

    return res.json(result);

  } catch (err) {
    console.error("Duplicate check error:", err);
    res.status(500).json({ success: false, message: "Internal error", error: err.message });
  }
};



exports.checkDuplicatesByTeam = async (req, res) => {
  try {
    const timeInSeconds = parseInt(req.query.time);
    const team = req.query.team?.toLowerCase();

    if (isNaN(timeInSeconds)) {
      return res.status(400).json({ success: false, message: "Invalid time parameter" });
    }

    if (!team || !TEAM_IDS[team]) {
      return res.status(400).json({ success: false, message: "Invalid or missing team" });
    }

    const teamId = TEAM_IDS[team];
    console.log("TeamId is: ", teamId);
    const { all, headers } = await detectAndCloseDuplicateTickets([teamId], timeInSeconds );

    // Step 1: Group by unique key (subject + email + content)
    const grouped = new Map();
    for (const ticket of all) {
      const key = `${ticket.subject}|${ticket.email}|${ticket.content}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          subject: ticket.subject,
          email: ticket.email,
          all: [],
        });
      }
      grouped.get(key).all.push(ticket);
    }

    // Step 2: Process each group into original + duplicates
    const groupedDuplicates = [];
    for (const [_, group] of grouped.entries()) {
      const sorted = group.all.sort((a, b) => a.createdTime - b.createdTime);
      const original = sorted[0];
      const dupsOnly = sorted.slice(1); // exclude the original

      if (dupsOnly.length > 0) {
        groupedDuplicates.push({
          subject: group.subject,
          email: group.email,
          originalTicketId: original.id,
          originalCreatedTime: original.createdTime,
          duplicates: dupsOnly.map(d => ({
            id: d.id,
            createdTime: d.createdTime,
          })),
          duplicateCount: dupsOnly.length
        });

        if (LIVE_MODE) {
          for (const dup of dupsOnly) {
            await axios.patch(`https://desk.zoho.com/api/v1/tickets/${dup.id}`, { status: "Closed" }, { headers });
          }
        }
      }
    }

    // Step 3: Build time range from all ticket times
    const allTimes = all.map(d => d.createdTime.getTime());
    const timeRange = allTimes.length
      ? {
          earliest: new Date(Math.min(...allTimes)).toISOString(),
          latest: new Date(Math.max(...allTimes)).toISOString()
        }
      : { earliest: null, latest: null };

    // Step 4: Build final result
    const result = {
      success: true,
      team,
      teamId,
      mode: LIVE_MODE ? "live" : "test",
      totalDuplicateTickets: groupedDuplicates.reduce((sum, g) => sum + g.duplicateCount, 0),
      duplicatesTimeRange: timeRange,
      groupedDuplicates,
      closed: LIVE_MODE
        ? groupedDuplicates.flatMap(g => g.duplicates.map(d => d.id))
        : []
    };

    return res.json(result);

  } catch (err) {
    console.error("checkDuplicatesByTeam error:", err);
    res.status(500).json({ success: false, message: "Internal error", error: err.message });
  }
};



exports.closeAccountDuplicates = async (req, res) => {
  const timeInSeconds = parseInt(req.query.time);
  if (isNaN(timeInSeconds) || timeInSeconds <= 0) {
    return res.status(400).json({ error: "time is required" });
  }

  try {
    const result = await closeDuplicatesForEmail({
      timeInSeconds,
      teamIds: "988907000001187105",
    });

    const closed = [];

    if (!LIVE_MODE) {
      for (const t of result.closed) {
        console.log(`[TEST] Would close ticket ${t.id} (${t.email})`);
        closed.push(t);
      }
    } else {
      for (const t of result.closed) {
        try {
          await axios.patch(`${API_BASE}/tickets/${t.id}`, {
            status: "Closed",
          }, {
            headers: {
              Authorization: `Zoho-oauthtoken ${await getAccessToken()}`,
              orgId: process.env.ORG_ID,
              "Content-Type": "application/json",
            }
          });

          closed.push(t);
        } catch (err) {
          console.warn(`Failed to close ticket ${t.id} (${t.email}):`, err.message);
        }
      }
    }

    res.status(200).json({
      status: LIVE_MODE ? "success" : "test",
      simulate: !LIVE_MODE,
      totalReviewed: result.total,
      kept: result.kept.map(t => ({ id: t.id, email: t.email, subject: t.subject, time: new Date(t.createdTime).toLocaleString() })),
      closed: closed.map(t => ({ id: t.id, email: t.email, subject: t.subject, time: new Date(t.createdTime).toLocaleString() })),
    });
  } catch (err) {
    console.error("Something went wrong:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
};


exports.getAllDuplicates = async (req, res) => {
  try {
    const team = req.query.team?.toLowerCase();

    if (!team || !TEAM_IDS[team]) {
      return res.status(400).json({ success: false, message: "Invalid or missing team" });
    }

    const teamId = TEAM_IDS[team];
    console.log("TeamId is: ", teamId);

    const { duplicateGroups } = await getAllDuplicatesWithDetails([teamId]);

    // Flatten all tickets from duplicateGroups (original + duplicates)
    const allTickets = duplicateGroups.flatMap(group => [
      group.original,
      ...group.duplicates
    ]);

    // Extract all duplicate ticket IDs (excluding originals)
    const duplicateTicketIds = allTickets
      .filter(ticket => ticket.isDuplicate)
      .map(ticket => ticket.id);

    // Compute earliest and latest createdTime among all tickets
    const allTimes = allTickets.map(t => new Date(t.createdTime).getTime());
    const timeRange = allTimes.length
      ? {
          earliest: new Date(Math.min(...allTimes)).toISOString(),
          latest: new Date(Math.max(...allTimes)).toISOString()
        }
      : { earliest: null, latest: null };

    // Build response
    const result = {
      success: true,
      team,
      teamId,
      totalGroups: duplicateGroups.length,
      totalDuplicateTickets: duplicateTicketIds.length,
      totalTicketsReturned: allTickets.length,
      duplicatesTimeRange: timeRange,
      duplicateGroups,
      duplicateTicketIds
    };

    return res.json(result);

  } catch (err) {
    console.error("getAllDuplicates error:", err);
    return res.status(500).json({ success: false, message: "Internal error", error: err.message });
  }
};




exports.closeSelectedTickets = async (req, res) => {
  try {
    const { ticketIds } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ticketIds must be a non-empty array"
      });
    }

    const invalidIds = ticketIds.filter(id => !id || (typeof id !== 'string' && typeof id !== 'number'));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: "All ticket IDs must be valid strings or numbers"
      });
    }

    console.log(`Received ${ticketIds.length} tickets. LIVE_MODE=${LIVE_MODE}`);

    if (!LIVE_MODE) {
      return res.json({
        success: true,
        mode: "dry-run",
        message: "These tickets would have been closed",
        tickets: ticketIds
      });
    }

    const { successful, failed, total } = await closeTicketsByIds(ticketIds);

    if (successful.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to close any tickets",
        failed
      });
    }

    return res.json({
      success: true,
      message: `Closed ${successful.length} out of ${total} tickets`,
      closed: successful,
      ...(failed.length > 0 && { failed })
    });

  } catch (err) {
    console.error("closeSelectedTickets error:", err);
    res.status(500).json({ success: false, message: "Internal error", error: err.message });
  }
};
