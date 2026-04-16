import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createApiApp, warmupDatabase } from "./api/apiApp";

async function startServer() {
  const app = createApiApp();
  const PORT = Number(process.env.PORT) || 3000;

  try {
    await warmupDatabase();
  } catch (err) {
    console.error("Startup DB warmup failed:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    // Serve public directory files (like admin7783.html) BEFORE Vite middleware
    app.use(express.static(path.join(process.cwd(), "public")));
    
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  }).on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${PORT} is already in use.\nRun: netstat -ano | findstr :${PORT}  — then taskkill /PID <pid> /F\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

startServer();