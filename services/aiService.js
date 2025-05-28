const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

exports.analyzeMessages = async (messages = []) => {
  if (messages.length === 0) return { decision: "Skip", sentiment: "Unknown", reply: "" };

  const lastMessage = stripHtml(messages[messages.length - 1]?.content || "");

  const prompt = `
You are a customer-support AI.

Rules (follow strictly):
• If the issue is generic (e.g. slow internet, downtime) and needs no technician or payment action:
  – Decision: Respond
  – Sentiment: Positive, Neutral, or Negative
  – Reply: ONE short paragraph, max 2 sentences.
• If the issue needs installation, payment confirmation, relocation, any attachment, or a field visit:
  – Decision: Skip
  – Sentiment: Positive, Neutral, or Negative
  – Reply: (leave completely blank).
• Never ask the customer for any further information.
• Add at the last line:
  - Thank you for choosing Tizeti Network Limited. <new line> Regards.


Respond exactly:

Decision: <Respond|Skip>
Sentiment: <Positive|Neutral|Negative>
Reply: <blank if Skip>

Customer message:
${lastMessage}
`;

  const result = await model.generateContent(prompt);
  const output = await result.response.text();

  const decision = output.match(/Decision:\s*(.*)/i)?.[1]?.trim() || "Skip";
  const sentiment = output.match(/Sentiment:\s*(.*)/i)?.[1]?.trim() || "Unknown";
  const reply = output.match(/Reply:\s*([\s\S]*)/i)?.[1]?.trim() || "";

  return { decision, sentiment, reply };
};




exports.classifyDepartment = async (subject, message) => {
  const prompt = `
You are a strict classifier. Choose exactly one of the departments / teams below
or output "Unknown" if unsure. RETURN ONLY THE NAME.
Departments / Teams (with duties):
• Customer Service – general customer queries, subscription questions, password resets, downtime issues, relocation
• Hotspot and Fibre – hotspot portal issues, fibre-install complaints, Anything relating to fiber
• Social media – Twitter / Facebook / Instagram complaints, public mentions
• bizdev – partnership proposals, B2B collaboration, vendor outreach
• NOC Team – network outages, latency, routing, equipment down (Network Operations Center)
• Account – billing discrepancies, invoices, refunds, payment failures, payments
• Field Service – on-site repairs, antenna alignment, FSE dispatch
• Retention Team – cancellation threats, churn prevention, downgrades
• Sales Team – new service inquiries, quotes, plan upgrades
• Quality Assurance – service quality audits, internal process feedback, QA reports

Subject: ${subject}
Description: ${message}

Respond with the exact department/team name above, or "Unknown".
If unsure, return "Unknown"
`;
  //console.log(prompt);
  const result = await model.generateContent(prompt);
  //console.log(result);
  const text = (await result.response.text()).trim();
  //console.log(text);
  console.log("Classified department:", text);
  try {
    return text;
  } catch {
    return { department: "unknown" };
  }
};
