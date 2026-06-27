/**
 * 月詠み占い — Firebase Cloud Functions
 * Firebase project: uranai-f98c6
 *
 * getFortune: Gemini 1.5 Flash を呼び出して陰陽師ミカゲの鑑定文を生成する。
 * エンドポイント: https://asia-northeast1-uranai-f98c6.cloudfunctions.net/getFortune
 * Method: POST  Body: { character, moon, elem, name }
 */

const functions = require('firebase-functions');

/* ── 月相・五行のマッピング ─────────────────────────────── */
const MOON_ICON = { '新月': '🌑', '三日月': '🌒', '半月': '🌓', '満月': '🌕' };
const ELEM_ICON = { '木': '🌿', '火': '🔥', '土': '🌍', '金': '✨', '水': '💧' };
const MOON_EN   = { '新月': 'New Moon', '三日月': 'Crescent', '半月': 'Half Moon', '満月': 'Full Moon' };
const ELEM_EN   = { '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water' };

/* ── 相性テーブル（MIKAGE_PATTERNS から抽出・固定値） ────── */
const COMPAT_TABLE = {
  '新月×木':   { moon: '満月',   elem: '火' },
  '新月×火':   { moon: '三日月', elem: '水' },
  '新月×土':   { moon: '満月',   elem: '水' },
  '新月×金':   { moon: '三日月', elem: '木' },
  '新月×水':   { moon: '半月',   elem: '土' },
  '三日月×木': { moon: '満月',   elem: '土' },
  '三日月×火': { moon: '新月',   elem: '土' },
  '三日月×土': { moon: '三日月', elem: '火' },
  '三日月×金': { moon: '半月',   elem: '水' },
  '三日月×水': { moon: '満月',   elem: '木' },
  '半月×木':   { moon: '新月',   elem: '火' },
  '半月×火':   { moon: '半月',   elem: '土' },
  '半月×土':   { moon: '満月',   elem: '火' },
  '半月×金':   { moon: '新月',   elem: '水' },
  '半月×水':   { moon: '三日月', elem: '木' },
  '満月×木':   { moon: '新月',   elem: '金' },
  '満月×火':   { moon: '半月',   elem: '水' },
  '満月×土':   { moon: '三日月', elem: '金' },
  '満月×金':   { moon: '満月',   elem: '木' },
  '満月×水':   { moon: '新月',   elem: '土' },
};

/* ── Gemini プロンプト生成 ───────────────────────────────── */
function buildMikagePrompt(moon, elem, name, compatMoon, compatElem) {
  return `あなたは「陰陽師ミカゲ」という占い師キャラクターです。五行思想（木・火・土・金・水）と月相（新月・三日月・半月・満月）の交差から、ユーザーの深層心理と運命を読み解く性格鑑定を行います。

【鑑定対象】
名前: ${name}
月相 × 五行: ${moon} × ${elem}

【文体・スタイル】
・「あなたは〜」という語りかけ形式
・読者が「なぜ自分のことがわかるの？」と感じる具体的な行動・思考パターンの描写
・詩的で核心を突く。段落の最後は希望や気づきで締める
・personality / destiny は各段落を \\n\\n で区切る（HTMLタグ不要）

【相性の良い相手（固定）】
月相: ${compatMoon} / 五行: ${compatElem}

以下のJSON形式のみ出力してください。前置き・後書き・コードブロック記号は不要です。

{
  "title": "${moon}と${elem}の組み合わせを表す詩的な鑑定タイトル（8〜16文字）",
  "catchLabel": "「〇〇な人」形式のキャッチフレーズ（鍵括弧含め12〜24文字）",
  "catchCopy": "読者の心に刺さる核心的な一行メッセージ（25〜55文字）",
  "personality": "性格分析。3段落を\\n\\nで区切る。各段落80〜150文字。ユーザーの内面の矛盾・行動パターン・他者から見た像を描写する。計280〜400文字。",
  "destiny": "「あなたの人生のテーマは〇〇です。」で始まる。3段落を\\n\\nで区切る。過去の経験→現在の課題→未来への展望の流れ。計240〜360文字。",
  "phaseStatus": "「〇〇の時期」形式（鍵括弧含め10〜18文字）",
  "phaseBody": "現在の運気の流れを具体的かつ希望を込めて描写（70〜120文字）",
  "compat": {
    "type": "${compatMoon}と${compatElem}の気を持つ人の特徴（20〜45文字）",
    "detail": "この相手との関わり方・なぜ相性が良いかの具体的説明（60〜100文字）"
  }
}`;
}

/* ── Cloud Function ──────────────────────────────────────── */
exports.getFortune = functions
  .region('asia-northeast1')
  .runWith({
    secrets: ['GEMINI_API_KEY'],
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req, res) => {
    // CORS ヘッダー
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { moon, elem, name } = req.body || {};

    if (!moon || !elem) {
      res.status(400).json({ error: 'moon and elem are required' });
      return;
    }

    // 相性テーブルから固定値を取得
    const compatKey = `${moon}×${elem}`;
    const compat = COMPAT_TABLE[compatKey] || { moon: '満月', elem: '火' };

    // Gemini プロンプト構築
    const prompt = buildMikagePrompt(moon, elem, name || 'あなた', compat.moon, compat.elem);
    const apiKey = process.env.GEMINI_API_KEY;

    let geminiJson;
    try {
      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.88,
              maxOutputTokens: 1024,
            },
          }),
        }
      );

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        console.error('Gemini API error:', geminiResp.status, errText);
        res.status(502).json({ error: 'Gemini API error', status: geminiResp.status });
        return;
      }

      geminiJson = await geminiResp.json();
    } catch (err) {
      console.error('Gemini fetch failed:', err);
      res.status(502).json({ error: 'Gemini fetch failed' });
      return;
    }

    // レスポンスからテキスト抽出
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error('Empty Gemini response:', JSON.stringify(geminiJson));
      res.status(502).json({ error: 'Empty Gemini response' });
      return;
    }

    // JSON パース
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error('JSON parse failed. Raw text:', rawText);
      res.status(502).json({ error: 'JSON parse failed', raw: rawText.slice(0, 300) });
      return;
    }

    // 固定フィールドをセット（Geminiに任せない値）
    parsed.moon      = moon;
    parsed.elem      = elem;
    parsed.moonIcon  = MOON_ICON[moon]  || '🌙';
    parsed.elemIcon  = ELEM_ICON[elem]  || '✦';
    parsed.titleEn   = `${MOON_EN[moon] || moon} · ${ELEM_EN[elem] || elem}`;
    parsed.catchNote = `${moon}と${elem}の気が重なるあなたへ`;
    parsed.compat           = parsed.compat || {};
    parsed.compat.moon      = compat.moon;
    parsed.compat.elem      = compat.elem;
    parsed.compat.moonIcon  = MOON_ICON[compat.moon] || '🌙';
    parsed.compat.elemIcon  = ELEM_ICON[compat.elem] || '✦';

    res.json(parsed);
  });
