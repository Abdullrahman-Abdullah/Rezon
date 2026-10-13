import express from "express";
import multer from "multer";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) return cb(new Error("يجب رفع ملف صورة"));
    cb(null, true);
  }
});
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/", (_req, res) => res.json({ status: "ok", service: "Tawazon food estimate endpoint" }));

app.post("/analyze-food", upload.single("image"), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ error: "الخادم غير مهيأ: أضف OPENAI_API_KEY كمتغير بيئة." });
    if (!req.file) return res.status(400).json({ error: "الصورة مطلوبة" });
    const grams = Math.max(1, Math.min(5000, Number(req.body.grams) || 350));
    const mealName = String(req.body.meal_name || "").slice(0, 300);
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const instructions = `You estimate nutrition from food photos. Be conservative and explicit about uncertainty. Estimate edible food shown, and use the provided total grams as the assumed total portion weight if plausible. Do not claim exact measurements from pixels. Return ONLY valid JSON with keys: name (string), grams (number), kcal (number), protein (number grams), carbs (number grams), fat (number grams), confidence (Arabic string: منخفض/متوسط/مرتفع), notes (short Arabic string). Nutrient values must correspond to the entire portion, not per 100g. If multiple foods are visible, estimate the combined meal and state uncertainty in notes. If the image is not food, return a low-confidence estimate with name explaining that and zero macros.`;
    const payload = {
      model: MODEL,
      instructions,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: `Estimate this meal. Approximate total portion weight in grams: ${grams}. User description: ${mealName || "not provided"}. Return only JSON.` },
          { type: "input_image", image_url: dataUrl, detail: "high" }
        ]
      }],
      max_output_tokens: 350
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      console.error("OpenAI API error status:", response.status);
      return res.status(502).json({ error: "تعذر على مزود الذكاء الاصطناعي تحليل الصورة. تحقق من إعدادات الخادم والحساب." });
    }
    const outputText = body.output?.flatMap(item => item.content || []).find(part => part.type === "output_text")?.text;
    if (!outputText) return res.status(502).json({ error: "لم تصل نتيجة قابلة للقراءة من مزود الذكاء الاصطناعي." });
    let result;
    try { result = JSON.parse(outputText.replace(/^```json\s*|\s*```$/g, "")); }
    catch { return res.status(502).json({ error: "صيغة نتيجة التحليل غير صالحة." }); }
    const num = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
    res.json({
      name: String(result.name || "وجبة مصورة").slice(0, 160),
      grams: num(result.grams) || grams,
      kcal: Math.round(num(result.kcal)),
      protein: Math.round(num(result.protein) * 10) / 10,
      carbs: Math.round(num(result.carbs) * 10) / 10,
      fat: Math.round(num(result.fat) * 10) / 10,
      confidence: String(result.confidence || "منخفض").slice(0, 30),
      notes: String(result.notes || "تقدير تقريبي من الصورة").slice(0, 300)
    });
  } catch (error) {
    console.error("Food analysis error:", error?.message || "unknown");
    res.status(500).json({ error: "حدث خطأ داخلي أثناء تحليل الصورة." });
  }
});
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "طلب غير صالح" }));
app.listen(PORT, () => console.log(`Tawazon AI endpoint listening on port ${PORT}`));
