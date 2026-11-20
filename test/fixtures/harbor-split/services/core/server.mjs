import express from "express";

const app = express();
app.get("/api/status", (_request, response) => response.json({ ok: true, origin: process.env.CORS_ORIGIN }));
app.listen(Number(process.env.CORE_PORT ?? 7070), "127.0.0.1");
