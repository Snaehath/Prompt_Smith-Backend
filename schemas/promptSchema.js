// # prompt schema for ai validation
const promptSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    subject: { type: "string" },
    action: { type: "string" },
    style: { type: "string" },
    context: { type: "string" },
    description: { type: "string" },
    prompt: { type: "string" },
  },
  required: ["title", "subject", "action", "style", "context", "description", "prompt"],
};


module.exports = {promptSchema};