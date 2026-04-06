
export const runtime = "nodejs";

export default async function handler(req, res) {
  res.status(200).json({
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    databaseUrlPreview: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.slice(0, 40) + "..."
      : null
  });
}
