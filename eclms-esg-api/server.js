const path = require("path");
const express = require("express");
const { Pool, types } = require("pg");
const createCvmRouter = require("./cvm-routes");
const createMetaRouter = require("./meta-routes");
const createRubricRouter = require("./routes/rubric-routes");
const createCvmLookupRouter = require("./routes/cvm-lookup-routes");
const createSectionWeightRouter = require("./routes/section-weight-routes");
const { HttpError } = createCvmRouter;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Example: postgresql://USER:PASSWORD@localhost:5432/eclms_esg");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const WEB_ROOT = path.resolve(__dirname, "../eclms-esg-web");

// DATE columns come back as plain YYYY-MM-DD strings, so the browser never shifts them by a timezone.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(WEB_ROOT));
app.use("/api/admin/cvm", createCvmRouter(pool));
app.use("/api/meta/forms", createMetaRouter(pool));
app.use("/api/admin/rubric", createRubricRouter(pool));
app.use("/api/admin/section-weights", createSectionWeightRouter(pool));
app.use("/api/cvm", createCvmLookupRouter(pool));

app.use("/api", (req, res) => {
  res.status(404).json({ message: "Endpoint not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON." });
  }
  switch (err.code) {
    case "23505":
      return res.status(409).json({ message: "This code already exists in the category." });
    case "23503":
      return res.status(400).json({ message: "Referenced category was not found." });
    case "23514":
      return res.status(400).json({ message: "One of the values breaks a database rule." });
    default:
      console.error(err);
      return res.status(500).json({ message: "Unexpected server error." });
  }
});

const server = app.listen(PORT, () => {
  console.log(`ECLMS ESG API and web app on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
