
const { getOpenTickets, getLastTwoMessages, sendReplyAndClose, getAllTeams, getLastMessage, detectAndCloseDuplicateTickets } = require("../services/zohoService");
const { analyzeMessages, classifyDepartment } = require("../services/aiService");
const log = require("../utils/logger");
const { getAccessToken } = require("../zoho/auth1");
const axios = require("axios");
const pLimit = require('p-limit');






exports.getOpenTicketsLimited = async (req, res) => {
  const count = parseInt(req.query.count || "10");
  try {
    const tickets = await getOpenTickets(count);
    res.json({ success: true, data: tickets });
  } catch (err) {
    // console.error("Failed to fetch tickets:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.getTicketThreadsPreview = async (req, res) => {
  const { ticketId } = req.params;
  try {
    const result = await getLastTwoMessages(ticketId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.processOpenTickets = async (req, res) => {
  try {
    const count   = parseInt(req.query.count || "10");
    log.info("Ticket batch started", { count });

    const tickets = await getOpenTickets(count);
    const results = [];

    for (const ticket of tickets) {
      log.info("Processing ticket", { ticketId: ticket.id, subject: ticket.subject });

      try {
        const messages = await getLastTwoMessages(ticket.id);

        // Skip if any attachment
        if (messages.some(m => m.hasAttach)) {
          log.warn("📎 Attachment detected – skipping", { ticketId: ticket.id });
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

            log.info("Replied & closed", {
              ticketId : ticket.id,
              sentiment: analysis.sentiment
            });

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
            log.error("Zoho sendReply error", {
              ticketId : ticket.id,
              error    : apiErr.message
            });

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
          log.warn("AI decided to Skip", { ticketId: ticket.id });

          results.push({
            ticketId : ticket.id,
            subject  : ticket.subject,
            email    : ticket.email,
            status   : ticket.status,
            decision : "Skip",
            sentiment: analysis.sentiment,
            reply    : ""
          });
        }
      } catch (err) {
        log.error("Ticket processing error", { ticketId: ticket.id, error: err.message });

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

    log.info("Batch complete", { processed: results.length });
    res.json({ success: true, processed: results });
  } catch (err) {
    log.error("Fatal controller error", { error: err.message });
    res.status(500).json({ success: false, message: "Unhandled error", error: err.message });
  }
};


exports.getAllTeams = async (req, res) => {
  try {
    const teams = await getAllTeams();
    res.json({ success: true, data: teams });
  } catch (err) {
    log.error("Failed to fetch teams", { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
}

let csToggle = 0;

const LIVE_MODE = false; // Set to true for real assignment + reply

const AGENT_IDS = {
  cs: ["988907000000774001", "988907000000772035"],
  csDept: "988907000000744735",
  hsDept: "988907000006857049",
  hsAgent: "988907000000777001",
};

const TEAM_IDS = {
  "social media": "988907000006857031",
  "bizdev": "988907000006857007",
  "noc team": "988907000006569047",
  "account": "988907000001187105",
  "field service": "988907000001187019",
  "retention team": "988907000000767492",
  "sales team": "988907000000767478",
  "quality assurance": "988907000000744749",
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
    console.log(`🎯 Fetched ${tickets.length} unassigned open tickets`);
  } catch (err) {
    log.error(err);
    return res.status(500).json({ success: false, message: "Failed to fetch tickets." });
  }

  const results = [];
  console.log(`Found ${tickets.length} unassigned open tickets.`);
  for (const t of tickets) {
    try {
      const subject = t.subject || "";
      const message = await getLastMessage(t.id);

      const resteam = await classifyDepartment(subject, message);
      const team = resteam?.toLowerCase()

      //const dept = ai.department?.toLowerCase();
      console.log("here is the respose here", team);
      console.log(`🔍 Ticket ${t.id} classified as:`, team);
      if (!team || team === "unknown" || (!TEAM_IDS[team] && team !== "customer service" && team !== "hotspot and fibre")) {
        log.warn("Skipping unclassified ticket", { ticketId: t.id });
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
        direction: "out",
        sendImmediately: true
      };

      const assignPayload = {};

      if (team === "customer service") {
        const agent = AGENT_IDS.cs[csToggle++ % 2];
        assignPayload.departmentId = AGENT_IDS.csDept;
        assignPayload.assigneeId = agent;
      } else if (team === "hotspot and fibre") {
        assignPayload.departmentId = AGENT_IDS.hsDept;
        assignPayload.assigneeId = AGENT_IDS.hsAgent;
      } else {
        assignPayload.departmentId = TEAM_IDS[team];
      }

      if (LIVE_MODE) {
        await axios.post(`https://desk.zoho.com/api/v1/tickets/${t.id}/threads`, replyPayload, { headers });
        await axios.put(`https://desk.zoho.com/api/v1/tickets/${t.id}`, assignPayload, { headers });
        log.info("Assigned ticket", { ticketId: t.id, to: team });
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
          teamId: assignPayload.departmentId,
          decision: "Test Only"
        });
      }

    } catch (err) {
      log.error("Error processing ticket", { ticketId: t.id, err: err.message });
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