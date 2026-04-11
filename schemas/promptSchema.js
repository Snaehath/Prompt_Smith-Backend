// # prompt schema for ai validation
const promptSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    artist: { type: "string" },
    year: { type: "string" },
    description: { type: "string" },
    style: { type: "string" },
    subject: { type: "string" },
    composition: { type: "string" },
    prompt: { type: "string" },
  },
  required: ["title", "artist", "year", "description", "style", "subject", "composition", "prompt"],
};


module.exports = {promptSchema};