require('dotenv').config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const promptRoute = require("./routes/aiRoute");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// routes
app.use("/api", promptRoute);

app.get("/", (req, res) => {
    res.send("PromptGen backend is running");
})

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});