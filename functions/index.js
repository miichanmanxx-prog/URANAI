/**
 * 月詠み占い — Firebase Cloud Functions
 * Firebase project: uranai-f98c6
 *
 * getFortune: Gemini 1.5 Flash を呼び出して占い師の鑑定文を生成する。
 * エンドポイント: https://asia-northeast1-uranai-f98c6.cloudfunctions.net/getFortune
 * Method: POST  Body: { character, ... }
 *   character='mikage': { moon, elem, name }
 *   character='stella': { phase, month, name, ld1, ld2, cd1 }
 *   character='luna':   { arcana, moon, elem, keywords, name }
 */

const functions = require('firebase-functions');

/* ── 月相・五行のマッピング ─────────────────────────────── */
const MOON_ICON = { '新月': '🌑', '三日月': '🌒', '半月': '🌓', '満月': '🌕' };
const ELEM_ICON = { '木': '🌿', '火': '🔥', '土': '🌍', '金': '✨', '水': '💧' };
const MOON_EN   = { '新月': 'New Moon', '三日月': 'Crescent', '半月': 'Half Moon', '満月': 'Full Moon' };
const ELEM_EN   = { '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water' };

/* ── 相性テーブル（ミカゲ用） ────── */
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

/* ── ミカゲ プロンプト ───────────────────────────────── */
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

/* ── ステラ プロンプト ───────────────────────────────── */
function buildStellaPrompt(phase, month, name, ld1, ld2, cd1) {
  return `あなたは「星詠みのステラ」という占い師キャラクターです。関西弁で語る古い星読みの案内人で、ズバリと核心を突く物言いが特徴です。月相と星の動きから今月の運命を読み解きます。

【鑑定対象】
名前: ${name}
今月の月相フェーズ: ${phase}
月: ${month}月
強運日: ${ld1}日・${ld2}日
注意日: ${cd1}日

【文体・スタイル】
・関西弁（「〜や」「〜やで」「〜やろ」「あんた」など）
・「あんた」または「${name}」への語りかけ形式
・具体的な行動・思考パターンの描写
・flow / obaMsg は各段落を \\n\\n で区切る（HTMLタグ不要）

以下のJSON形式のみ出力してください。前置き・後書き・コードブロック記号は不要です。

{
  "theme": "${phase}のエネルギーを表す詩的な今月のテーマ（8〜16文字）",
  "themeMsg": "テーマの補足メッセージ（30〜60文字、関西弁）",
  "flow": "今月の流れ。3段落を\\n\\nで区切る。各段落80〜120文字。${phase}のエネルギー・人間関係の変化・月末の展望の流れ。関西弁。計260〜380文字。",
  "luckyMsg1": "${month}月${ld1}日（強運日1）のメッセージ（25〜50文字、関西弁）",
  "luckyMsg2": "${month}月${ld2}日（強運日2）のメッセージ（25〜50文字、関西弁）",
  "cautionMsg": "${month}月${cd1}日（注意日）のメッセージ（25〜50文字、関西弁）",
  "obaMsg": "ステラから${name}への個人メッセージ。2段落を\\n\\nで区切る。1段落目：${name}が今抱えていることへの共感と気づき。2段落目：今月の星からの具体的なアドバイス。合計150〜220文字。関西弁で語りかける。"
}`;
}

/* ── ルナ プロンプト ────────────────────────────────── */
function buildLunaPrompt(arcana, moon, elem, keywords, name) {
  const kwStr = Array.isArray(keywords) ? keywords.join('・') : keywords;
  return `あなたは「タロット女子ルナ」という占い師キャラクターです。月相とタロットの大アルカナを組み合わせた神秘的な鑑定を行います。詩的で落ち着いた語り口が特徴です。

【引かれたカード】
大アルカナ: ${arcana}
月相: ${moon}
五行: ${elem}
キーワード: ${kwStr}

【鑑定対象】
名前: ${name}

【文体・スタイル】
・静かで詩的、神秘的な語り口
・「${name}さん」への語りかけ形式
・月とカードのシンボルを絡めた描写
・lunaMessage の段落は \\n\\n で区切る（HTMLタグ不要）

以下のJSON形式のみ出力してください。前置き・後書き・コードブロック記号は不要です。

{
  "msg": "「${arcana}」が伝えるメッセージ詩。2〜4行、詩的な短文。改行は\\nで区切る。",
  "situation": "今の現状分析。${arcana}と${moon}のエネルギーから読み解く${name}さんの現在の状況（60〜100文字）",
  "advice": "開運アドバイス。「${kwStr}」のキーワードを踏まえた具体的な行動の示唆（60〜100文字）",
  "loveReading": "恋愛の読み解き。${arcana}が映す恋愛・人間関係の流れ（50〜80文字）",
  "lunaMessage": "ルナから${name}さんへのメッセージ。3段落を\\n\\nで区切る。1段落目：カードとの出会いの必然性。2段落目：${arcana}と${moon}が今の${name}さんに伝えること。3段落目：これから先への希望と問いかけ。合計200〜300文字。"
}`;
}

/* ── Gemini 呼び出し共通処理 ─────────────────────────── */
async function callGemini(prompt, apiKey) {
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
    throw Object.assign(new Error('Gemini API error'), { status: geminiResp.status, body: errText });
  }
  const geminiJson = await geminiResp.json();
  const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty Gemini response');
  return JSON.parse(rawText);
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
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const apiKey = process.env.GEMINI_API_KEY;
    const body = req.body || {};
    const character = body.character || 'mikage';

    try {
      /* ── ミカゲ ── */
      if (character === 'mikage') {
        const { moon, elem, name } = body;
        if (!moon || !elem) { res.status(400).json({ error: 'moon and elem are required' }); return; }
        const compatKey = `${moon}×${elem}`;
        const compat = COMPAT_TABLE[compatKey] || { moon: '満月', elem: '火' };
        const prompt = buildMikagePrompt(moon, elem, name || 'あなた', compat.moon, compat.elem);
        const parsed = await callGemini(prompt, apiKey);
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

      /* ── ステラ ── */
      } else if (character === 'stella') {
        const { phase, month, name, ld1, ld2, cd1 } = body;
        if (!phase || !month) { res.status(400).json({ error: 'phase and month are required' }); return; }
        const prompt = buildStellaPrompt(phase, month, name || 'あなた', ld1, ld2, cd1);
        const parsed = await callGemini(prompt, apiKey);
        parsed.phase = phase;
        parsed.month = month;
        res.json(parsed);

      /* ── ルナ ── */
      } else if (character === 'luna') {
        const { arcana, moon, elem, keywords, name } = body;
        if (!arcana) { res.status(400).json({ error: 'arcana is required' }); return; }
        const prompt = buildLunaPrompt(arcana, moon, elem, keywords, name || 'あなた');
        const parsed = await callGemini(prompt, apiKey);
        parsed.arcana   = arcana;
        parsed.moon     = moon;
        parsed.elem     = elem;
        parsed.keywords = keywords;
        res.json(parsed);

      } else {
        res.status(400).json({ error: 'Unknown character' });
      }
    } catch (err) {
      console.error('getFortune error:', err);
      if (err.status) {
        res.status(502).json({ error: 'Gemini API error', status: err.status });
      } else {
        res.status(502).json({ error: err.message || 'Internal error' });
      }
    }
  });
