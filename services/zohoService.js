const axios = require("axios");
const { getAccessToken } = require("../zoho/auth1");
require("dotenv").config();
const cleanRawEmail = require("../utils/cleanEmail");
const { default: pLimit } = require("p-limit");

const API_BASE = "https://desk.zoho.com/api/v1";

exports.getAllTicketsFromZoho = async () => {
  const token = await getAccessToken();
  console.log("🔑 Using access token:", token);
  const response = await axios.get(`${API_BASE}/tickets`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: process.env.ORG_ID,
    },
    params: {
      include: "contacts",
    },
  });

  const rawTickets = response.data.data;

  const simplifiedTickets = rawTickets.map(ticket => ({
     id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    email: ticket.email || ticket.contact?.email || "N/A",
    webUrl: ticket.webUrl,
    // DepartmentId: ticket.departmentIds,
    TeamId: "N/A",
  }));

  return simplifiedTickets;
};



exports.getFilteredTickets = async (status, limit, page) => {
  const token = await getAccessToken();

  const res = await axios.get(`${API_BASE}/tickets`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: process.env.ORG_ID,
    },
    params: {
      include: "contacts",
      limit: parseInt(limit),
      from: (page - 1) * limit,
      ...(status && { status })
    }
  });

  const rawTickets = res.data.data;

  return rawTickets.map(ticket => ({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    email: ticket.email || ticket.contact?.email || "N/A",
    webUrl: ticket.webUrl
  }));
};



exports.getTicketWithThreads = async (ticketId) => {
  const token = await getAccessToken();

  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  // Step 1: Fetch ticket metadata
  const ticketRes = await axios.get(`${API_BASE}/tickets/${ticketId}`, { headers });

  // Step 2: Fetch thread list
  const threadsListRes = await axios.get(`${API_BASE}/tickets/${ticketId}/threads`, { headers });

  const threadSummaries = threadsListRes.data.data;

  // Step 3: For each thread, get full content by threadId
  const fullThreads = await Promise.all(
  threadSummaries.map(async (thread) => {
    try {
      const threadDetailRes = await axios.get(
        `${API_BASE}/tickets/${ticketId}/threads/${thread.id}`,
        { headers }
      );

      const fullContent = threadDetailRes.data.content;

      return {
        id: thread.id,
        direction: thread.direction,
        isPublic: thread.isPublic,
        createdTime: thread.createdTime,
        from: thread.fromEmailAddress,
        to: thread.to,
        channel: thread.channel,
        content: fullContent || thread.summary || "[No content]"
      };
    } catch (err) {
      console.warn(`⚠️ Failed to fetch thread ${thread.id}`, err.message);
      return null;
    }
  })
);

};




exports.getOpenTickets = async (count = 10) => {
  const token = await getAccessToken();
  console.log("🔑 Using access token:", token);
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

  console.log("📤 POST /tickets/%s/sendReply", ticketId);
  console.log("🧾 Payload:", JSON.stringify(payload, null, 2));

  try {
    await axios.post(`${API_BASE}/tickets/${ticketId}/sendReply`, payload, { headers });
    return true;
  } catch (err) {
    /* Log full Zoho error payload */
    if (err.response) {
      console.error("Zoho 422 detail:", err.response.data);
    }
    throw err;   // bubble up so controller records "Error"
  }
};



exports.getAllTeams = async () => {
  const token = await getAccessToken();
  const res = await axios.get(`${API_BASE}/teams`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: process.env.ORG_ID,
    }
  });

  return res.data.data.map(team => ({
    id: team.id,
    name: team.name,
    description: team.description || "No description"
  }));
}


exports.getOriginalEmailContent = async (ticketId, threadId) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  try {
    const res = await axios.get(
      `https://desk.zoho.com/api/v1/tickets/${ticketId}/threads/${threadId}/originalContent`,
      { headers }
    );

    const full = res.data.content || "";
    // Strip out headers + HTML
    const plain = cleanRawEmail(full);

    return plain || "[no clean content]";
  } catch (err) {
    console.warn(`⚠️ Failed to fetch original content for ${ticketId}/${threadId}`, err.message);
    return "[failed to retrieve content]";
  }
};



exports.detectAndCloseDuplicateTickets = async (timeInSeconds) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Zoho-oauthtoken ${token}`,
    orgId: process.env.ORG_ID,
  };

  const res = await axios.get(`${API_BASE}/tickets`, {
    headers,
    params: {
      status: "Open",
      include: "contacts,assignee",
      limit: 100,
    },
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

  const seen = new Map();
  const duplicates = [];
  const originals = [];

  for (const ticket of enriched) {
    const key = `${ticket.subject}|${ticket.email}|${ticket.content}`;
    if (seen.has(key)) {
      duplicates.push(ticket);
    } else {
      seen.set(key, ticket);
      originals.push(ticket);
    }
  }

  return {
    duplicates,
    headers,
    all: [...originals, ...duplicates]
  };
};