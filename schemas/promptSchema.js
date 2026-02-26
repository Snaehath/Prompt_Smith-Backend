const promptSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    artist: { type: "string" },
    year: { type: "string" },
    description: { type: "string" },
    style: { type: "string" },
    prompt: { type: "string" },
  },
  required: ["title", "artist", "year", "description", "style","prompt"],
};


module.exports = {promptSchema};