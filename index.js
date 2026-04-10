require("dotenv").config();
const express = require("express");
const cors = require("cors");


const promptRoute = require("./routes/promptRoute");

const app = express();
const port = process.env.PORT || 5000;

// # middleware
app.use(cors());
app.use(express.json());

// # routes
app.use("/api/prompts", promptRoute);

app.get("/", (req, res) => {
  res.send("PromptGen backend is running");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
