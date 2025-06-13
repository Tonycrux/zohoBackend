const axios = require("axios");
const { getAccessToken } = require("../zoho/auth1");
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const cleanRawEmail = require("../utils/cleanEmail");
const pLimit = require("p-limit");

const API_BASE = "https://desk.zoho.com/api/v1";

exports.getAllOpenTickets = async (count = 10) => {
  const token = await getAccessToken();
  // console.log("🔑 Using access token:", token);
  const res = await axios.get(`${API_BASE}/tickets`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: process.env.ORG_ID,
    },
    params: {
      status: "Open",
      limit: parseInt(count),
      include: "departments,contacts,team,assignee"
    }
  });

  const rawTickets = res.data.data;

  return rawTickets.map(ticket => ({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    email: ticket.email || ticket.contact?.email || "N/A",
    webUrl: ticket.webUrl,
    department: ticket.departmentId,
    contacts: ticket.contacts || [],
    team: ticket.team,
  }));
};



exports.getLastTwoMessages = async (ticketId) => {
  const token = await getAccessToken();

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  // -------- fetch thread list --------
  let threads = [];                                        // <- DECLARED up-front
  try {
    const listRes = await axios.get(
      `${API_BASE}/tickets/${ticketId}/threads`,
      { headers }
    );
    threads = listRes.data?.data || [];
    // console.log(` ticket ${ticketId} • total threads:`, threads.length);
  } catch (err) {
    console.warn(`could not fetch thread list for ${ticketId}:`, err.message);
    return [];                                             // return empty, don’t throw
  }

  // keep only customer-visible incoming messages
  const incoming = threads
    .filter(t => t.direction === "in")
    .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  const lastTwo = incoming.slice(-2);                      // 1 or 2 items

  // -------- fetch full content for each --------
  const fullThreads = await Promise.all(
    lastTwo.map(async t => {
      try {
        const detail = await axios.get(
          `${API_BASE}/tickets/${ticketId}/threads/${t.id}`,
          { headers }
        );
        return {
          id         : t.id,
          createdTime: t.createdTime,
          content    : detail.data.content || t.summary || "[no content]"
        };
      } catch (err) {
        console.warn(`thread ${t.id} detail 404/403:`, err.message);
        return null;
      }
    })
  );

  return fullThreads.filter(Boolean).map(t => ({
    content   : t.content || t.summary || "[no content]",
    hasAttach : t.hasAttach || false      // ← new field
  }));                     // remove nulls
};

const stripHtml = (html) => {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

exports.getLastMessage = async (ticketId) => {
  const token = await getAccessToken();

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  let threads = [];
  try {
    const res = await axios.get(`${API_BASE}/tickets/${ticketId}/threads`, { headers });
    threads = res.data?.data || [];
  } catch (err) {
    console.warn(`Could not fetch thread list for ${ticketId}:`, err.message);
    return null;
  }

  const incoming = threads
    .filter(t => t.direction === "in")
    .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  const last = incoming.at(-1); // last incoming message
  if (!last) return null;

  try {
    const detail = await axios.get(
      `${API_BASE}/tickets/${ticketId}/threads/${last.id}`,
      { headers }
    );
    const rawContent = detail.data?.content || last.summary || "[no content]";
    return stripHtml(rawContent);
  } catch (err) {
    console.warn(`Failed to get thread detail for ${last.id}:`, err.message);
    return null;
  }
};

exports.sendReplyAndClose = async (ticketId, replyText, customerEmail) => {
  const token   = await getAccessToken();
  const payload = {
    ticketStatus     : "Closed",
    channel          : "EMAIL",
    contentType      : "plainText",
    content          : replyText,
    fromEmailAddress : process.env.FROM_EMAIL,
    to               : customerEmail
  };

  const headers = {
    Authorization : `Zoho-oauthtoken ${token}`,
    orgId         : process.env.ORG_ID,
    "Content-Type": "application/json"
  };

  //  console.log("📤 POST /tickets/%s/sendReply", ticketId);
  // console.log("🧾 Payload:", JSON.stringify(payload, null, 2));

  try {
    await axios.post(`${API_BASE}/tickets/${ticketId}/sendReply`, payload, { headers });
    return true;
  } catch (err) {
    /* Log full Zoho error payload */
    // if (err.response) {
    //   console.error("Zoho 422 detail:", err.response.data);
    // }
    throw err;   // bubble up so controller records "Error"
  }
};



exports.detectAndCloseDuplicateTickets = async (teamIds = [], timeInSeconds) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };
  const params = {
    status: "Open",
    include: "contacts,assignee",
    // limit: 100,
  };

  if (teamIds.length > 0) {
    params.teamIds = teamIds.join(","); // Join for API format
  }

  const res = await axios.get(`${API_BASE}/tickets`, {
    headers,
    params,
  });

  const tickets = res.data.data;
  const now = Date.now();
  const recentTickets = tickets.filter(
    (t) => (now - new Date(t.createdTime).getTime()) / 1000 <= timeInSeconds
  );

  const limit = pLimit(5);


  const enriched = await Promise.all(
    recentTickets.map(t => limit(async () => ({
      id: t.id,
      subject: t.subject,
      email: t.email || t.contact?.email || "",
      createdTime: new Date(t.createdTime),
      content: await exports.getLastMessage(t.id),
    }))
  )
  );

  enriched.sort((a, b) => a.createdTime - b.createdTime);

  const seenFull = new Map(); // for subject + email + content
  const seenLoose = new Map(); // for email + content
  const duplicates = [];
  const originals = [];

  for (const ticket of enriched) {
    const fullKey = `${ticket.subject}|${ticket.email}|${ticket.content}`;
    const looseKey = `${ticket.email}|${ticket.content}`;

    if (seenFull.has(fullKey)) {
      duplicates.push(ticket);
    } else if (seenLoose.has(looseKey)) {
      // Already seen same email + content but different subject — still a duplicate
      duplicates.push(ticket);
    } else {
      // First time seeing this ticket
      seenFull.set(fullKey, ticket);
      seenLoose.set(looseKey, ticket);
      originals.push(ticket);
    }
  }

  // enriched.sort((a, b) => a.createdTime - b.createdTime);

  // const seen = new Map();
  // const duplicates = [];
  // const originals = [];

  // for (const ticket of enriched) {
  //   const key = `${ticket.subject}|${ticket.email}|${ticket.content}`;
  //   if (seen.has(key)) {
  //     duplicates.push(ticket);
  //   } else {
  //     seen.set(key, ticket);
  //     originals.push(ticket);
  //   }
  // }

  return {
    duplicates,
    headers,
    all: [...originals, ...duplicates]
  };
};


exports.closeDuplicatesForEmail = async ({ timeInSeconds, teamIds }) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
    "Content-Type": "application/json",
  };

  const res = await axios.get(`${API_BASE}/tickets`, {
    headers,
    params: {
      status: "Open",
      teamIds,
      // limit: 100,
      include: "contacts",
    },
  });

  const now = Date.now();
  const recent = res.data.data.filter(
    (t) => (now - new Date(t.createdTime).getTime()) / 1000 <= timeInSeconds
  );

  console.log("Number of tickets checked", recent.length)

  const grouped = {};
  for (const t of recent) {
    const email = t.email || t.contact?.email;
    if (!email) continue;
    if (!grouped[email]) grouped[email] = [];
    grouped[email].push(t);
  }

  const closed = [];
  const kept = [];

  for (const email in grouped) {
    const group = grouped[email].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    const [first, ...rest] = group;

    kept.push(first);
    closed.push(...rest); // just pass the rest, don’t close
  }

  return {
    total: recent.length,
    closed,
    kept,
  };
};




exports.getAllDuplicatesWithDetails = async (teamIds = []) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  const baseParams = {
    status: "Open",
    include: "contacts,assignee",
    limit: 100,
  };

  if (teamIds.length > 0) {
    baseParams.teamIds = teamIds.join(",");
  }

  // Paginated ticket fetch
  const allTickets = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const params = { ...baseParams, from };
    console.log(`Fetching tickets from index ${from}...`);

    const res = await axios.get(`${API_BASE}/tickets`, { headers, params });
    const tickets = res.data.data || [];

    console.log(`Fetched ${tickets.length} tickets`);
    allTickets.push(...tickets);

    hasMore = tickets.length === 100;
    from += 100;
  }

  console.log(`Total tickets fetched: ${allTickets.length}`);

  // Enrich with messages
  const limit = pLimit(5);
  const enriched = await Promise.all(
    allTickets.map(t =>
      limit(async () => {
        const allContent = await exports.getAllTicketContent(t.id);

        const combinedContent = allContent
          .filter(msg => msg.type === "Customer Message")
          .map(msg => msg.content)
          .join(" ")
          .toLowerCase()
          .trim();

        return {
          id: t.id,
          subject: t.subject,
          email: t.email || t.contact?.email || "",
          createdTime: new Date(t.createdTime),
          content: combinedContent,
          messages: allContent,
        };
      })
    )
  );

  enriched.sort((a, b) => a.createdTime - b.createdTime);

  // Group by email + content
  const grouped = new Map();
  for (const ticket of enriched) {
    const key = `${ticket.email}|${ticket.content}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ticket);
  }

  // Build duplicate groups
  const duplicateGroups = [];

  for (const group of grouped.values()) {
    if (group.length > 1) {
      const sortedGroup = group.sort((a, b) => a.createdTime - b.createdTime);
      const original = sortedGroup[0];
      const potentialDuplicates = sortedGroup.slice(1);

      const duplicates = potentialDuplicates
        .filter(dup => dup.id !== original.id)
        .map(dup => ({
          ...dup,
          subject: dup.subject.includes("[DUP]") ? dup.subject : `[DUP] ${dup.subject}`,
          isDuplicate: true,
        }));

      if (duplicates.length > 0) {
        duplicateGroups.push({
          original: { ...original, isDuplicate: false },
          duplicates,
          email: original.email,
          totalInGroup: 1 + duplicates.length,
        });
      }
    }
  }

  return {
    duplicateGroups,
    headers,
  };
};



exports.getAllTicketContent = async (ticketId) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  let threads = [];
  try {
    const res = await axios.get(`${API_BASE}/tickets/${ticketId}/threads`, { headers });
    threads = res.data?.data || [];
  } catch (err) {
    console.warn(`Could not fetch thread list for ${ticketId}:`, err.message);
    return [];
  }

  if (threads.length === 0) return [];

  // Get all threads (incoming and outgoing), sorted by creation time
  const allThreads = threads
    .filter(t => t.channel !== "SYSTEM") // Only remove system messages
    .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  // Use pLimit to control concurrent requests for thread details
  const threadLimit = pLimit(3); // Lower limit for thread detail requests

  const contentPromises = allThreads.map(thread => threadLimit(async () => {
    try {
      const detail = await axios.get(
        `${API_BASE}/tickets/${ticketId}/threads/${thread.id}`,
        { headers }
      );
      const rawContent = detail.data?.content || thread.summary || "";
      const stripQuotedText = (text) => {
        return text.split(/(on\s+\w{3},\s+\d{1,2}\s+\w{3,9}\s+\d{4},?.*wrote:)/i)[0]
                  .split(/----\s+on\s+/i)[0]
                  .split(/forwarded message:/i)[0]
                  .trim();
      };

      const cleanContent = stripQuotedText(stripHtml(rawContent).trim());
      
      if (!cleanContent) return null;
      
      return {
        type: thread.direction === "in" ? "Customer Message" : "Tizeti Reply",
        timestamp: thread.createdTime,
        content: cleanContent
      };
    } catch (err) {
      console.warn(`Failed to get thread detail for ${thread.id} and ticketId: ${ticketId}:`, err.message);
      const fallbackContent = thread.summary || "";
      
      if (!fallbackContent) return null;
      
      return {
        type: thread.direction === "in" ? "Customer Message" : "Tizeti Reply",
        timestamp: thread.createdTime,
        content: fallbackContent.trim()
      };
    }
  }));

  try {
    const contents = await Promise.all(contentPromises);
    // Filter out null values and return the structured array
    return contents.filter(c => c !== null);
  } catch (err) {
    console.warn(`Error processing thread contents for ${ticketId}:`, err.message);
    return [];
  }
};


exports.closeTicketsByIds = async (ticketIds) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  const results = {
    successful: [],
    failed: [],
    total: ticketIds.length
  };

  const limit = pLimit(5); // Limit concurrent requests

  await Promise.all(
    ticketIds.map(ticketId => limit(async () => {
      try {
        await axios.patch(
          `${API_BASE}/tickets/${ticketId}`,
          { status: "Closed" },
          { headers }
        );
        results.successful.push(ticketId);
      } catch (error) {
        console.error(`Failed to close ticket ${ticketId}:`, error.message);
        results.failed.push({
          ticketId,
          error: error.message
        });
      }
    }))
  );

  return results;
};